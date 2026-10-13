import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWrite} from '../util.mjs';

// Only application-owned recovery state. Never archive activation, process locks,
// OS credentials, unrelated files or another application's profile.
const MiB=1024*1024,MAX_FILES=4096,MAX_BYTES=32*MiB,MAX_FILE=14*MiB;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ensure=(ok,code)=>{if(!ok)throw Error(code);};
const scopes={
 agent:{trees:['data/admission','work-studio'],files:['pilot.json','commissioning.json']},
 node:{trees:['data/admission','work-studio'],files:['pilot.json','commissioning.json']},
 fleet:{trees:['funding'],files:[]},
};
function scope(kind){ensure(Object.hasOwn(scopes,kind),'BACKUP_STATE_FORMAT');return scopes[kind];}
function safePath(name,kind){
 const s=scope(kind);
 ensure(typeof name==='string'&&name.length<=512&&name.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(p)&&p!=='.'&&p!=='..'),'BACKUP_STATE_PATH');
 ensure(s.files.includes(name)||s.trees.some(root=>name.startsWith(root+'/')),'BACKUP_STATE_PATH');
 return name;
}
export function captureOperational({home,dataDir=path.join(home,'data'),kind,excludeStudio=false}){
 ensure(typeof excludeStudio==='boolean'&&(!excludeStudio||['agent','node'].includes(kind)),'BACKUP_STATE_FORMAT');
 const s=scope(kind),files=[];let bytes=0,nodes=0;
 for(const base of new Set([home,...(kind==='fleet'?[]:[dataDir])])){
  const stat=fs.lstatSync(base);ensure(stat.isDirectory()&&!stat.isSymbolicLink(),'BACKUP_STATE_UNSAFE_FILE');
 }
 function walk(file,name,depth=0){
  ensure(depth<=12,'BACKUP_STATE_PATH');
  ensure(++nodes<=8192,'BACKUP_TOO_LARGE');
  if(depth>0)safePath(name,kind);
  let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT'&&depth===0)return;throw e;}
  ensure(!stat.isSymbolicLink(),'BACKUP_STATE_UNSAFE_FILE');
  if(stat.isDirectory()){
   ensure(!s.files.includes(name),'BACKUP_STATE_UNSAFE_FILE');
   for(const child of fs.readdirSync(file).sort())walk(path.join(file,child),name+'/'+child,depth+1);
   return;
  }
  safePath(name,kind);
  ensure(stat.isFile()&&stat.nlink===1,'BACKUP_STATE_UNSAFE_FILE');
  ensure(files.length<MAX_FILES&&stat.size<=MAX_FILE&&bytes+stat.size<=MAX_BYTES,name.startsWith('work-studio/')?'BACKUP_STUDIO_EXPORT_REQUIRED':'BACKUP_TOO_LARGE');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let content;
  try{
   const before=fs.fstatSync(fd);
   ensure(before.isFile()&&before.nlink===1&&before.ino===stat.ino&&before.dev===stat.dev&&before.size===stat.size,'BACKUP_STATE_CHANGED');
   content=fs.readFileSync(fd);const after=fs.fstatSync(fd);
   ensure(content.length===stat.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'BACKUP_STATE_CHANGED');
  }finally{fs.closeSync(fd);}
  bytes+=content.length;files.push({path:name,size:content.length,sha256:digest(content),data:content.toString('base64')});
 }
 for(const name of [...s.trees,...s.files].filter(name=>!excludeStudio||name!=='work-studio'))walk(name.startsWith('data/')?path.join(dataDir,name.slice(5)):path.join(home,name),name);
 const result={schema:'agi-operational-state/v1',kind,bytes,files,...(excludeStudio?{excludedTrees:['work-studio']}: {})};
 validateOperational(result,kind);return result;
}
export function validateOperational(value,kind){
 scope(kind);
 ensure(value&&value.schema==='agi-operational-state/v1'&&value.kind===kind&&Array.isArray(value.files)&&value.files.length<=MAX_FILES,'BACKUP_STATE_FORMAT');
 const excluded=Object.hasOwn(value,'excludedTrees')?value.excludedTrees:[];
 ensure(Array.isArray(excluded)&&(excluded.length===0||(['agent','node'].includes(kind)&&excluded.length===1&&excluded[0]==='work-studio')),'BACKUP_STATE_FORMAT');
 ensure(!excluded.length||value.files.every(entry=>typeof entry?.path==='string'&&!entry.path.startsWith('work-studio/')),'BACKUP_STATE_FORMAT');
 const seen=new Set();let bytes=0;
 const decoded=value.files.map(entry=>{
  ensure(entry&&typeof entry==='object','BACKUP_STATE_FORMAT');safePath(entry.path,kind);
  const key=entry.path.toLowerCase();ensure(!seen.has(key),'BACKUP_STATE_DUPLICATE');seen.add(key);
  ensure(Number.isSafeInteger(entry.size)&&entry.size>=0&&entry.size<=MAX_FILE&&typeof entry.data==='string'&&entry.data.length===4*Math.ceil(entry.size/3),'BACKUP_STATE_FORMAT');
  bytes+=entry.size;ensure(bytes<=MAX_BYTES,'BACKUP_TOO_LARGE');
  const content=Buffer.from(entry.data,'base64');
  ensure(content.length===entry.size&&content.toString('base64')===entry.data&&digest(content)===entry.sha256,'BACKUP_STATE_INTEGRITY');
  return {path:entry.path,content};
 });
 for(const name of seen){const parts=name.split('/');while(parts.length>1){parts.pop();ensure(!seen.has(parts.join('/')),'BACKUP_STATE_PATH');}}
 ensure(bytes===value.bytes,'BACKUP_STATE_INTEGRITY');return decoded;
}
export function stageOperational(directory,value,kind){
 // Validate the entire manifest before writing any file. directory is a private,
 // newly created staging directory; it is never the live application home.
 const decoded=validateOperational(value,kind);
 for(const {path:name,content} of decoded){
  const target=path.join(directory,name==='commissioning.json'?'recovered-commissioning.json':name);
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  ensure(!fs.existsSync(target),'BACKUP_STATE_DUPLICATE');
  atomicWrite(target,content);
 }
 return {files:decoded.length,bytes:value.bytes};
}
export function checkBackupSize(value){
 // Base64 adds one third to the encrypted request. Leave room below the 64 MiB
 // HTTP restore limit so every backup produced here is accepted by that route.
 ensure(Buffer.byteLength(JSON.stringify(value))<=46*MiB,'BACKUP_TOO_LARGE');
 return value;
}
