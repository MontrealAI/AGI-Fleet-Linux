import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const HISTORY_DIRECTORY='cleanup-history';
export const HISTORY_LIMITS=Object.freeze({segments:4096,metadataBytes:2*1024*1024,minimumFreeBytes:64*1024*1024,rotateAttempts:3072,rotateBytes:12*1024*1024});
const anchorName='cleanup-archive-head.json';
const schema='agi-cleanup-history/v1',digest=/^[a-f0-9]{64}$/;
const need=ok=>{if(!ok)throw Error('COMPUTE_CLEANUP_HISTORY_INVALID');};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
const initial=()=>({schema,sequence:0,headSha256:null,attemptCount:0,bytes:0});
const cache=new Map(),leases=new Set();
function owned(file,directory=false,links=1){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&(!process.getuid||s.uid===process.getuid())&&!(s.mode&0o077)&&(directory?s.isDirectory():s.isFile()&&s.nlink===links));return s;}
function chain(file){let p=path.resolve(file);for(;;){const s=fs.lstatSync(p);need(s.isDirectory()&&!s.isSymbolicLink());const up=path.dirname(p);if(up===p)break;p=up;}}
function sync(root){const s=owned(root,true),fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{need(fs.fstatSync(fd).ino===s.ino);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function rootFor(profile,{create=false}={}){chain(profile);owned(profile,true);const root=path.join(profile,HISTORY_DIRECTORY);if(create){try{fs.mkdirSync(root,{mode:0o700});sync(profile);}catch(e){if(e.code!=='EEXIST')throw e;}}owned(root,true);return root;}
function read(file,max=HISTORY_LIMITS.metadataBytes,links=1){const before=owned(file,false,links);need(before.size>0&&before.size<=max);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);need(s.dev===before.dev&&s.ino===before.ino&&s.size===before.size&&s.mode===before.mode&&s.uid===before.uid&&s.nlink===links);const b=fs.readFileSync(fd),after=fs.fstatSync(fd);need(b.length===s.size&&s.ctimeMs===after.ctimeMs&&s.mtimeMs===after.mtimeMs&&after.nlink===links&&after.mode===s.mode);return {bytes:b,value:JSON.parse(b)};}finally{fs.closeSync(fd);}}
function write(root,name,value,{replace=false}={}){
 const file=path.join(root,name),temporary=file+'.writing',b=bytes(value);need(b.length<=HISTORY_LIMITS.metadataBytes);
 if(exists(temporary)&&exists(file)){
  const a=fs.lstatSync(temporary),z=fs.lstatSync(file);
  if(a.dev===z.dev&&a.ino===z.ino){need(!replace&&read(file,HISTORY_LIMITS.metadataBytes,2).bytes.equals(b));owned(temporary,false,2);fs.unlinkSync(temporary);sync(root);return;}
 }
 let fd;
 try{
  if(exists(temporary)){need(read(temporary).bytes.equals(b));fd=fs.openSync(temporary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}
  else{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,b);}
  fs.fsyncSync(fd);
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 if(replace){owned(file);fs.renameSync(temporary,file);}else{fs.linkSync(temporary,file);fs.unlinkSync(temporary);}
 sync(root);need(read(file).bytes.equals(b));
}

function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
const number=n=>Number.isSafeInteger(n)&&n>=0;
function headValue(v){need(v?.schema===schema&&number(v.sequence)&&v.sequence<=HISTORY_LIMITS.segments&&number(v.attemptCount)&&number(v.bytes)&&(v.sequence?digest.test(v.headSha256):v.headSha256===null&&v.attemptCount===0&&v.bytes===0));need(Object.keys(v).sort().join(',')==='attemptCount,bytes,headSha256,schema,sequence');return v;}
function head(root){return exists(path.join(root,'HEAD.json'))?headValue(read(path.join(root,'HEAD.json'),2048).value):initial();}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function segmentName(sequence){return String(sequence).padStart(6,'0');}
function fileInventory(directory){owned(directory,true);const names=fs.readdirSync(directory).sort();need(names.length>0&&names.length<=8192);return names.map(name=>{need(/^[a-f0-9-]{36}\.(start|finish)\.json$/.test(name));const r=read(path.join(directory,name),8192);return {name,sha256:hash(r.bytes),bytes:r.bytes.length};});}
function validateSegment(v){need(v?.schema===schema&&number(v.sequence)&&v.sequence>0&&v.sequence<=HISTORY_LIMITS.segments&&(v.previousSha256===null||digest.test(v.previousSha256))&&number(v.attemptCount)&&v.attemptCount>0&&number(v.bytes)&&Array.isArray(v.files)&&v.files.length===v.attemptCount*2&&v.files.length<=8192);need(Object.keys(v).sort().join(',')==='attemptCount,bytes,files,previousSha256,schema,sequence');need(v.files.every(f=>f&&Object.keys(f).sort().join(',')==='bytes,name,sha256'&&/^[a-f0-9-]{36}\.(start|finish)\.json$/.test(f.name)&&digest.test(f.sha256)&&number(f.bytes)&&f.bytes>0&&f.bytes<=8192));need(new Set(v.files.map(f=>f.name)).size===v.files.length&&v.files.reduce((n,f)=>n+f.bytes,0)===v.bytes);return v;}
function signature(directory,files){const d=owned(directory,true);return hash([d.dev,d.ino,d.ctimeMs,...files.flatMap(f=>{const s=owned(path.join(directory,f.name));return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode,s.uid,s.nlink];})].join(':'));}
function verifySegment(root,value,reader){const name=segmentName(value.sequence),directory=path.join(root,name),sig=signature(directory,value.files),key=directory+':'+hash(bytes(value));if(cache.get(key)===sig)return;need(same(fileInventory(directory),value.files));const summary=reader(directory);need(summary.status==='PASS'&&summary.pending.length===0&&summary.attemptCount===value.attemptCount&&summary.bytes===value.bytes);need(signature(directory,value.files)===sig);cache.set(key,sig);if(cache.size>HISTORY_LIMITS.segments)cache.delete(cache.keys().next().value);}

// An OS-released SQLite transaction serializes append and rotation across
// processes. The lock contains no wallet, OAuth, job or provider material.
export function withCleanupHistoryLease(profile,operation){if(leases.has(profile))return operation();const root=rootFor(profile,{create:true}),file=path.join(root,'lease.sqlite');if(!exists(file)){let fd;try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);}catch(e){if(e.code!=='EEXIST')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}for(const suffix of ['-journal','-wal','-shm'])if(exists(file+suffix))owned(file+suffix);const before=owned(file);let db;try{db=new DatabaseSync(file);const opened=owned(file);need(opened.dev===before.dev&&opened.ino===before.ino);db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY);');leases.add(profile);return operation();}catch(e){if(e?.code==='ERR_SQLITE_ERROR'&&/locked|busy/i.test(e.message))throw Error('COMPUTE_CLEANUP_HISTORY_BUSY');throw e;}finally{leases.delete(profile);try{db?.exec('ROLLBACK');}catch{}db?.close();}}

export function readCleanupHistory(profile,reader){
 let root;try{root=rootFor(profile);}catch(e){if(e.code==='ENOENT'){need(!exists(path.join(profile,anchorName)));return {...initial(),status:'ABSENT'};}throw e;}
 need(!exists(path.join(root,'ROTATION_PENDING.json')));const first=head(root),expected=new Set(['lease.sqlite','lease.sqlite-journal','HEAD.json']);let previous=null,count=0,total=0;
 for(let sequence=1;sequence<=first.sequence;sequence++){const name=segmentName(sequence);expected.add(name);expected.add(name+'.json');const r=read(path.join(root,name+'.json')),v=validateSegment(r.value);need(v.sequence===sequence&&v.previousSha256===previous);verifySegment(root,v,reader);previous=hash(r.bytes);count+=v.attemptCount;total+=v.bytes;}
 for(const name of fs.readdirSync(root)){need(expected.has(name));if(!/^\d{6}$/.test(name))owned(path.join(root,name));}
 need(previous===first.headSha256&&count===first.attemptCount&&total===first.bytes&&same(first,head(root)));if(first.sequence)need(same(headValue(read(path.join(profile,anchorName),2048).value),first));else need(!exists(path.join(profile,anchorName)));return {...first,status:'PASS'};
}
export function cleanupCapacity(profile,active,history){
 let freeBytes=null;try{const s=fs.statfsSync(profile);freeBytes=Math.min(Number.MAX_SAFE_INTEGER,s.bavail*s.bsize);}catch{}
 const remainingAttempts=Math.max(0,4096-active.attemptCount),remainingBytes=Math.max(0,16*1024*1024-active.bytes),warning=freeBytes===null?'DISK_CAPACITY_UNKNOWN':freeBytes<HISTORY_LIMITS.minimumFreeBytes?'DISK_SPACE_LOW':history.sequence>=HISTORY_LIMITS.segments?'HISTORY_CAPACITY_REACHED':history.sequence>=HISTORY_LIMITS.segments-16?'HISTORY_CAPACITY_LOW':active.attemptCount>=HISTORY_LIMITS.rotateAttempts||active.bytes>=HISTORY_LIMITS.rotateBytes?'ROTATION_DUE':'NONE';
 return {schema:'agi-cleanup-capacity/v1',activeAttempts:active.attemptCount,activeBytes:active.bytes,remainingAttempts,remainingBytes,archivedAttempts:history.attemptCount,archivedBytes:history.bytes,archiveSegments:history.sequence,archiveHeadSha256:history.headSha256,maximumSegments:HISTORY_LIMITS.segments,freeBytes,minimumFreeBytes:HISTORY_LIMITS.minimumFreeBytes,warning,retention:'all-events-preserved'};
}
function finishRotation(profile,reader){
 const root=rootFor(profile),intentFile=path.join(root,'ROTATION_PENDING.json'),intent=read(intentFile).value;need(intent?.schema==='agi-cleanup-rotation/v1'&&Object.keys(intent).sort().join(',')==='previousHead,schema,segment');const previous=headValue(intent.previousHead),segment=validateSegment(intent.segment);need(segment.sequence===previous.sequence+1&&segment.previousSha256===previous.headSha256);
 const name=segmentName(segment.sequence),active=path.join(profile,'cleanup-evidence'),destination=path.join(root,name),next={schema,sequence:segment.sequence,headSha256:hash(bytes(segment)),attemptCount:previous.attemptCount+segment.attemptCount,bytes:previous.bytes+segment.bytes};if(exists(path.join(root,'HEAD.json.writing'))&&exists(path.join(root,'HEAD.json'))&&fs.lstatSync(path.join(root,'HEAD.json')).nlink===2)write(root,'HEAD.json',next);const current=head(root);need(same(current,previous)||same(current,next));
 if(!exists(destination)){need(same(current,previous)&&same(fileInventory(active),segment.files));const summary=reader(active);need(summary.status==='PASS'&&summary.pending.length===0);fs.renameSync(active,destination);sync(profile);sync(root);}
 verifySegment(root,segment,reader);
 const receipt=path.join(root,name+'.json');if(!exists(receipt))write(root,name+'.json',segment);else if(exists(receipt+'.writing'))write(root,name+'.json',segment);else need(read(receipt).bytes.equals(bytes(segment)));
 if(!same(current,next))write(root,'HEAD.json',next,{replace:exists(path.join(root,'HEAD.json'))});
const anchor=path.join(profile,anchorName);if(exists(anchor+'.writing')&&exists(anchor)&&fs.lstatSync(anchor).nlink===2)write(profile,anchorName,next);if(!exists(anchor)||!same(read(anchor,2048).value,next))write(profile,anchorName,next,{replace:exists(anchor)});
 if(!exists(active)){fs.mkdirSync(active,{mode:0o700});sync(profile);}else{owned(active,true);need(fs.readdirSync(active).length===0);}
 // Only the completed transaction intent is removed. Event bytes and the
 // immutable segment receipt remain in their entirety.
 fs.unlinkSync(intentFile);sync(root);return readCleanupHistory(profile,reader);
}
export function rotateCleanupHistory(profile,reader,{resume=false}={}){
 return withCleanupHistoryLease(profile,()=>{
  const root=rootFor(profile);if(resume&&exists(path.join(root,'ROTATION_PENDING.json'))&&exists(path.join(root,'ROTATION_PENDING.json.writing'))&&fs.lstatSync(path.join(root,'ROTATION_PENDING.json')).nlink===2){const intent=read(path.join(root,'ROTATION_PENDING.json'),HISTORY_LIMITS.metadataBytes,2).value;write(root,'ROTATION_PENDING.json',intent);}
  if(resume&&!exists(path.join(root,'ROTATION_PENDING.json'))&&exists(path.join(root,'ROTATION_PENDING.json.writing'))){const intent=read(path.join(root,'ROTATION_PENDING.json.writing')).value;need(intent?.schema==='agi-cleanup-rotation/v1');headValue(intent.previousHead);validateSegment(intent.segment);write(root,'ROTATION_PENDING.json',intent);}
  const pending=exists(path.join(root,'ROTATION_PENDING.json'));
  if(pending){need(resume);return finishRotation(profile,reader);}
  need(!resume);
  const history=readCleanupHistory(profile,reader),active=path.join(profile,'cleanup-evidence'),summary=reader(active);need(summary.status==='PASS'&&summary.pending.length===0&&summary.attemptCount>0&&history.sequence<HISTORY_LIMITS.segments);
  const files=fileInventory(active),segment={schema,sequence:history.sequence+1,previousSha256:history.headSha256,attemptCount:summary.attemptCount,bytes:summary.bytes,files};validateSegment(segment);
  write(root,'ROTATION_PENDING.json',{schema:'agi-cleanup-rotation/v1',previousHead:head(root),segment});return finishRotation(profile,reader);
 });
}
