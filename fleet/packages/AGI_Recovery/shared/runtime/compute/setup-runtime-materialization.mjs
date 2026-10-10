import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha256} from '../src/util.mjs';
import {runtimeArtifactLock} from './runtime-artifacts.mjs';
const need=(ok)=>{if(!ok)throw Error('SETUP_RUNTIME_MATERIALIZATION_INVALID');};
const raw=fs.readFileSync(new URL('./openclaw-2026.9.5.inventory.json',import.meta.url));
need(sha256(raw)===runtimeArtifactLock.openclaw.inventorySHA256);
const inventory=JSON.parse(raw);
const relative='dist/control-ui/asset-manifest.json';
function owned(file,directory=false){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&s.uid===process.getuid()&&(directory?s.isDirectory():s.isFile()&&s.nlink===1)&&!(s.mode&0o077));return s;}
function stable(file){const s=owned(file),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const o=fs.fstatSync(fd);need(o.ino===s.ino&&o.dev===s.dev);const data=fs.readFileSync(fd),end=fs.lstatSync(file);need(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>end[k]===s[k]));return data;}finally{fs.closeSync(fd);}}
/** Package inventory binds the manifest and every browser-executable asset.
 * A self-consistent cache manifest alone is never provenance. */
export function pinnedControlUIManifest(packageRoot){
 const file=path.join(packageRoot,relative),s=fs.lstatSync(file),data=fs.readFileSync(file),record=inventory.files[relative];
 need(!s.isSymbolicLink()&&s.isFile()&&record&&data.length===record.bytes&&sha256(data)===record.sha256);
 const manifest=JSON.parse(data);need(manifest.version===1&&/^[a-f0-9]{64}$/.test(manifest.generation)&&Array.isArray(manifest.assets)&&manifest.assets.length>0&&manifest.assets.length<=8192);
 const lines=manifest.assets.map(a=>{need(a.path.startsWith('assets/')&&!a.path.includes('\\')&&path.posix.normalize(a.path)===a.path&&!a.path.split('/').some(p=>p==='..'||!p));const r=inventory.files['dist/control-ui/'+a.path];need(r&&r.bytes===a.size&&r.sha256===a.sha256);return a.path+'\0'+a.size+'\0'+a.sha256+'\n';});need(sha256(lines.join(''))===manifest.generation&&new Set(manifest.assets.map(a=>a.path)).size===manifest.assets.length);
 return manifest;
}
/** Materialize the pinned runtime's exact retained generation BEFORE review.
 * It then remains immutable; startup only touches directory timestamps. */
export function preparePinnedControlUICache(root,packageRoot){
 const manifest=pinnedControlUIManifest(packageRoot),base='cache/control-ui-assets/'+manifest.generation,artifacts=[];
 const mkdir=rel=>{const target=path.join(root,rel);if(!fs.existsSync(target))fs.mkdirSync(target,{mode:0o700});need((owned(target,true).mode&0o777)===0o700);artifacts.push([rel,'directory',0o700]);};
 mkdir('cache');mkdir('cache/control-ui-assets');mkdir(base);const parents=new Set();
 for(const asset of manifest.assets){const rel=base+'/'+asset.path;let dir=path.posix.dirname(rel);const chain=[];while(dir!==base){chain.unshift(dir);dir=path.posix.dirname(dir);}for(const parent of chain)if(!parents.has(parent)){mkdir(parent);parents.add(parent);}const src=path.join(packageRoot,'dist/control-ui',asset.path),st=fs.lstatSync(src);need(st.isFile()&&!st.isSymbolicLink());const data=fs.readFileSync(src);need(data.length===asset.size&&sha256(data)===asset.sha256);const dest=path.join(root,rel);if(fs.existsSync(dest))need(stable(dest).equals(data));else fs.writeFileSync(dest,data,{flag:'wx',mode:0o600});artifacts.push([rel,'file',0o600,asset.sha256]);}
 const rel=base+'/asset-manifest.json',data=Buffer.from(JSON.stringify(manifest)+'\n'),dest=path.join(root,rel);if(fs.existsSync(dest))need(stable(dest).equals(data));else fs.writeFileSync(dest,data,{flag:'wx',mode:0o600});artifacts.push([rel,'file',0o600,sha256(data)]);
 validatePinnedControlUICache(root,packageRoot);return artifacts;
}
export function validatePinnedControlUICache(root,packageRoot,{optional=false}={}){
 const top=path.join(root,'cache');if(!fs.existsSync(top)){need(optional);return [];}
 const manifest=pinnedControlUIManifest(packageRoot),base='cache/control-ui-assets/'+manifest.generation,allowed=new Map(manifest.assets.map(a=>[base+'/'+a.path,a.sha256]));allowed.set(base+'/asset-manifest.json',sha256(JSON.stringify(manifest)+'\n'));
 const directories=new Set(['cache','cache/control-ui-assets',base]);for(const rel of allowed.keys()){let dir=path.posix.dirname(rel);while(dir!=='.'){directories.add(dir);dir=path.posix.dirname(dir);}}
 const entries=[];function walk(dir,rel){owned(dir,true);entries.push([rel,'directory']);for(const name of fs.readdirSync(dir).sort()){const p=rel+'/'+name,file=path.join(root,p),s=fs.lstatSync(file);if(s.isDirectory()){need(directories.has(p));walk(file,p);}else{need(allowed.has(p)&&!(owned(file).mode&0o111));const hash=sha256(stable(file));need(hash===allowed.get(p));entries.push([p,'file',false,hash]);}}}walk(top,'cache');
 need(entries.length===directories.size+allowed.size);return entries;
}
