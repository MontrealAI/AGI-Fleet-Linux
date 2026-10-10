// Shipped 1.18.2 transfer and filesystem helpers; imports redirected only. Synthetic test use only.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {classifyLaunchctlPrint} from '../compute/service-stop.mjs';import {publicBrowserRuntimeSocketPath} from '../compute/public-browser-runtime.mjs';
import {VERSION} from '../src/version.mjs';import {canonical} from '../src/util.mjs';
import {computeProfile} from '../compute/profile.mjs';import {makePublicBrowserPolicy,applyPublicBrowserProfile} from '../compute/public-browser-config.mjs';
import {assertAuthorizedOAuthChanges} from '../compute/setup-oauth-delta.mjs';import {sqliteSchemaPreflight,sqliteSecurityProjection} from '../compute/setup-runtime-sqlite.mjs';import {SQLiteSnapshots} from '../compute/setup-sqlite.mjs';
const CODE='CLEAN_INSTALL_OAUTH_RESUME_UNAVAILABLE';const need=ok=>{if(!ok)throw Error(CODE);};const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const same=(a,b)=>canonical(a)===canonical(b);
const reportFiles=['clean-install-intent.json','genesis-setup-progress.json','machine-preflight.json','setup-diagnostics.json','setup-result.html','desktop-diagnostics.json'];
function owned(file,uid,dir=false,privateMode=true){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&s.uid===uid&&(dir?s.isDirectory():s.isFile()&&s.nlink===1)&&!(s.mode&(privateMode?0o077:0o022)));return s;}
function bytes(file,uid,privateMode=true){const before=owned(file,uid,false,privateMode);need(before.size<=128*1024*1024);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd);need(opened.dev===before.dev&&opened.ino===before.ino);const data=fs.readFileSync(fd),after=fs.lstatSync(file);need(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>after[k]===before[k]));return data;}finally{fs.closeSync(fd);}}
function json(file,uid){try{return JSON.parse(bytes(file,uid));}catch{throw Error(CODE);}}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,data){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function tree(root,uid){const rows=[];let total=0;function walk(dir,rel=''){owned(dir,uid,true,false);for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),relative=rel?rel+'/'+name:name,s=fs.lstatSync(file);need(rows.length<8192);if(s.isSymbolicLink()){need(relative.startsWith('candidate/plugin-skills/')&&s.uid===uid);rows.push({path:relative,kind:'symlink',sha256:sha(fs.readlinkSync(file)),mode:s.mode&0o777});}else if(s.isDirectory()){owned(file,uid,true,false);rows.push({path:relative,kind:'directory',mode:s.mode&0o777});walk(file,relative);}else{const data=bytes(file,uid,false);total+=data.length;need(total<=512*1024*1024);rows.push({path:relative,kind:'file',bytes:data.length,sha256:sha(data),mode:s.mode&0o777});}}}walk(root);return {rows,sha256:sha(canonical(rows))};}
export function seedFreshOAuthRoles(continuation,candidate,profileDir){
 owned(candidate,continuation.fileUID,true);need(path.isAbsolute(candidate)&&fs.realpathSync(candidate)===candidate);
 const source=path.join(continuation.archive,'transaction');need(tree(source,continuation.fileUID).sha256===continuation.sourceIdentity);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'agi-fresh-oauth-copy-'));fs.chmodSync(temp,0o700);const prepared=[];
 try{for(const role of continuation.roles){
  const relative='agents/'+role+'/agent/openclaw-agent.sqlite',original=path.join(source,'candidate',relative),copy=path.join(temp,relative);fs.mkdirSync(path.dirname(copy),{recursive:true,mode:0o700});
  for(const suffix of ['','-wal','-shm','-journal'])if(fs.lstatSync(original+suffix,{throwIfNoEntry:false}))write(copy+suffix,bytes(original+suffix,continuation.fileUID));
  sqliteSchemaPreflight(copy,{root:temp,profileDir,relative});sqliteSecurityProjection(copy,{root:temp,profileDir,relative});
  const db=new DatabaseSync(copy,{readOnly:true});try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');const rows=db.prepare('SELECT store_json FROM auth_profile_store').all();need(rows.length===1);const data=JSON.parse(rows[0].store_json),credential=data.profiles?.['openai:agi-compute-pro'];need(credential?.provider==='openai'&&credential.type==='oauth'&&typeof credential.access==='string'&&credential.access.length>0&&typeof credential.refresh==='string'&&credential.refresh.length>0);}finally{db.close();}
  const snapshots=new SQLiteSnapshots();try{const data=snapshots.initial(copy);snapshots.assertStable();prepared.push({relative,data});}finally{snapshots.close();}
 }
 need(tree(source,continuation.fileUID).sha256===continuation.sourceIdentity);
 // Validate every existing destination parent before creating any role file.
 for(const {relative} of prepared){let dir=candidate;for(const part of relative.split('/').slice(0,-1)){dir=path.join(dir,part);if(fs.lstatSync(dir,{throwIfNoEntry:false}))owned(dir,continuation.fileUID,true);}need(!fs.lstatSync(path.join(candidate,relative),{throwIfNoEntry:false}));}
 for(const {relative,data} of prepared){let dir=candidate;for(const part of relative.split('/').slice(0,-1)){dir=path.join(dir,part);if(!fs.lstatSync(dir,{throwIfNoEntry:false}))fs.mkdirSync(dir,{mode:0o700});owned(dir,continuation.fileUID,true);}write(path.join(candidate,relative),data);sync(dir);}
 return {...continuation.receipt,roleStoresPreserved:prepared.length,committedWALIncluded:true};
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
