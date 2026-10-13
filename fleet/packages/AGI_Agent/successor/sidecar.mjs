import fs from 'node:fs';
import {validateReceiptBinding} from './receipt.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fail,keys,parseStrict,canonical} from './vendor/manager/site/assets/successor/safe.mjs';
import {inspectCapsule,restoreCapsule,exportCapsule} from './vendor/manager/site/assets/successor/model.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const LIMIT=192*1024*1024,FILE_LIMIT=96*1024*1024;
function safe(name){fail(typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.\/-]{0,239}$/.test(name)&&name.split('/').length<=12&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.startsWith('.')),'FLEET_ARTIFACT_PATH');return name;}
function directory(p){const s=fs.lstatSync(p);fail(s.isDirectory()&&!s.isSymbolicLink(),'FLEET_SIDECAR_PATH');}
function checkedFile(root,name){safe(name);directory(root);let p=root;for(const part of name.split('/').slice(0,-1)){p=path.join(p,part);directory(p);}return path.join(root,name);}
function bytes(file,max){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);fail(s.isFile()&&s.nlink===1&&s.size<=max,'FLEET_SIDECAR_FILE');const b=fs.readFileSync(fd);fail(b.length===s.size,'FLEET_SIDECAR_CHANGED');return b;}finally{fs.closeSync(fd);}}
export function inspectSidecar(root){
  const manifest=parseStrict(bytes(checkedFile(root,'manifest.json'),100000).toString(),100000);
  keys(manifest,['schema','files','totalBytes','walletBackup','authority','sha256'],'FLEET_SIDECAR_FIELDS');
  const {sha256,...body}=manifest;fail(manifest.schema==='agi-fleet/successor-sidecar/v1'&&sha256===hash(canonical(body))&&manifest.authority==='none'&&manifest.walletBackup==='excluded','FLEET_SIDECAR_MANIFEST');
  fail(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=68,'FLEET_SIDECAR_COUNT');
  let total=0;const seen=new Set();
  for(const entry of manifest.files){keys(entry,['path','bytes','sha256','mediaType','role'],'FLEET_SIDECAR_ENTRY');safe(entry.path);fail(!seen.has(entry.path.toLowerCase()),'FLEET_SIDECAR_DUPLICATE');seen.add(entry.path.toLowerCase());fail(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&entry.bytes<=FILE_LIMIT&&/^[a-f0-9]{64}$/.test(entry.sha256),'FLEET_SIDECAR_LIMIT');total+=entry.bytes;fail(total<=LIMIT,'FLEET_SIDECAR_LIMIT');
    const file=checkedFile(root,entry.path),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const st=fs.fstatSync(fd);fail(st.isFile()&&st.nlink===1&&st.size===entry.bytes,'FLEET_SIDECAR_MISSING');const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);let count=0,n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0){count+=n;fail(count<=entry.bytes,'FLEET_SIDECAR_CHANGED');digest.update(buffer.subarray(0,n));}fail(count===entry.bytes&&digest.digest('hex')===entry.sha256,'FLEET_SIDECAR_CHANGED');}finally{fs.closeSync(fd);}}
  fail(total===manifest.totalBytes,'FLEET_SIDECAR_LIMIT');
  const actual=[];function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){fail(!e.isSymbolicLink(),'FLEET_SIDECAR_PATH');const name=prefix+e.name;if(e.isDirectory())walk(path.join(dir,e.name),name+'/');else actual.push(name);}}
  walk(root);fail(actual.length===manifest.files.length+1&&actual.every(n=>n==='manifest.json'||seen.has(n.toLowerCase())),'FLEET_SIDECAR_EXTRA');
  if(seen.has('handoff.json')||seen.has('receipt.json')){fail(seen.has('handoff.json')&&seen.has('receipt.json'),'FLEET_SIDECAR_MISSING');validateReceiptBinding(parseStrict(bytes(checkedFile(root,'handoff.json'),FILE_LIMIT).toString(),FILE_LIMIT),parseStrict(bytes(checkedFile(root,'receipt.json'),1000000).toString(),1000000));}
  return manifest;
}
export async function exportSidecar(destination,capsule,handoff,receipt,studioAPI){
  await inspectCapsule(capsule);studioAPI.validateHandoff(handoff);validateReceiptBinding(handoff,receipt);
  const {files}=studioAPI.validateBundle(handoff.specification,Buffer.from(handoff.delivery));
  fail(!fs.existsSync(destination),'OUTPUT_EXISTS');directory(path.dirname(path.resolve(destination)));
  const temporary=path.resolve(destination)+'.partial-'+crypto.randomUUID();fs.mkdirSync(temporary,{mode:0o700});const rows=[];
  try{function write(name,content,mediaType,role){safe(name);const data=Buffer.isBuffer(content)?content:Buffer.from(content);fail(data.length<=FILE_LIMIT,'FLEET_SIDECAR_LIMIT');const p=path.join(temporary,name);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,data,{flag:'wx',mode:0o600});rows.push({path:name,bytes:data.length,sha256:hash(data),mediaType,role});}
    write('capsule.json',capsule,'application/json','portable-project');write('handoff.json',canonical(handoff),'application/json','exact-review-handoff');write('receipt.json',canonical(receipt),'application/json','historical-evidence');
    for(const [name,data] of files)write('artifacts/'+name,data,handoff.specification.outputs.find(f=>f.name===name).mediaType,'deliverable');
    const body={schema:'agi-fleet/successor-sidecar/v1',files:rows,totalBytes:rows.reduce((s,r)=>s+r.bytes,0),walletBackup:'excluded',authority:'none'};
    fs.writeFileSync(path.join(temporary,'manifest.json'),canonical({...body,sha256:hash(canonical(body))})+'\n',{flag:'wx',mode:0o600});inspectSidecar(temporary);fs.renameSync(temporary,destination);return inspectSidecar(destination);
  }catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
}
export async function restoreSidecar(source,destination,confirmed){
  const manifest=inspectSidecar(source),raw=bytes(checkedFile(source,'capsule.json'),4000000).toString();const inspected=await inspectCapsule(raw);
  if(confirmed!==true)return {manifest,summary:inspected.summary,requiresConfirmation:true,authority:'none'};
  fail(!fs.existsSync(destination),'OUTPUT_EXISTS');const temporary=path.resolve(destination)+'.partial-'+crypto.randomUUID();fs.mkdirSync(temporary,{mode:0o700});const original=path.join(temporary,'original-pack');fs.mkdirSync(original,{mode:0o700});
  try{for(const row of manifest.files){const target=path.join(original,row.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.copyFileSync(checkedFile(source,row.path),target,fs.constants.COPYFILE_EXCL);}fs.copyFileSync(checkedFile(source,'manifest.json'),path.join(original,'manifest.json'),fs.constants.COPYFILE_EXCL);inspectSidecar(original);
    const restored=await exportCapsule(await restoreCapsule(inspected,true),inspected.capsule.payload.sourceManifest);
    fs.writeFileSync(path.join(temporary,'RESTORED-CAPSULE.json'),restored,{flag:'wx',mode:0o600});
    fs.renameSync(temporary,destination);return {directory:destination,capsule:'RESTORED-CAPSULE.json',authority:'none',qualification:'NOT_RUN',originalPackUnchanged:true};
  }catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
}
