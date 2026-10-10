import fs from 'node:fs';
import {HISTORY_LIMITS,withCleanupHistoryLease,readCleanupHistory,cleanupCapacity,rotateCleanupHistory} from './cleanup-history.mjs';
import {isSandboxScopeKey} from './sandbox-scope.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {RUNTIME_FAILURES} from './runtime-env.mjs';

export const CLEANUP_EVIDENCE_SCHEMA='agi-cleanup-evidence/v1';
export const CLEANUP_EVIDENCE_DIRECTORY='cleanup-evidence';
export const CLEANUP_EVIDENCE_LIMITS=Object.freeze({attempts:4096,bytes:16*1024*1024,fileBytes:8192,containerIDs:64,elapsedMs:3600000,timeoutMs:300000});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const results=new Set(['PASS','FAIL','UNKNOWN','NOT_RUN']);
const inventoryStatuses=new Set(['CAPTURED','UNAVAILABLE','NOT_REQUESTED']);
const triggers=new Set(['preflight','before-collect','finalize','legacy-generate']);
const signals=new Set(Object.keys(os.constants.signals));
const failureCodes=new Set([...RUNTIME_FAILURES,'COMPUTE_CLI_OUTPUT_LIMIT','COMPUTE_CLI_UNAVAILABLE','COMPUTE_CLI_CANCELLED','COMPUTE_CLI_TIMEOUT','COMPUTE_CLI_RESPONSE_INVALID','COMPUTE_CLI_TERMINATION_UNCONFIRMED','COMPUTE_INFERENCE_FAILED','COMPUTE_SANDBOX_CLEANUP_FAILED','COMPUTE_CLEANUP_SCOPE_REQUIRED','COMPUTE_CLEANUP_INVENTORY_FAILED','COMPUTE_CLEANUP_POSTCONDITION_FAILED','COMPUTE_OBSERVER_FINALIZE_FAILED','COMPUTE_WORKSPACE_REMOVE_FAILED','COMPUTE_CLEANUP_EVIDENCE_FAILED','COMPUTE_CLEANUP_INTERRUPTED','CLEANUP_FAILURE_UNCLASSIFIED']);
const issueCodes=new Set(['COMPUTE_CLEANUP_HISTORY_INVALID','COMPUTE_CLEANUP_LEGACY_SCOPE_UNVERIFIED','COMPUTE_CLEANUP_EVIDENCE_INVALID','COMPUTE_CLEANUP_EVIDENCE_UNREADABLE','COMPUTE_CLEANUP_EVIDENCE_LIMIT','COMPUTE_CLEANUP_INTERRUPTED','COMPUTE_SANDBOX_CLEANUP_FAILED']);
const schema=CLEANUP_EVIDENCE_SCHEMA,limits=CLEANUP_EVIDENCE_LIMITS;
const need=(condition,code='COMPUTE_CLEANUP_EVIDENCE_INVALID')=>{if(!condition)throw Error(code);};
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const same=(a,b)=>stable(a)===stable(b);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
const boolean=value=>typeof value==='boolean'?value:null;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));

function context(value){
 const {requestId,sessionId,agent,phase,stage,target}=value??{};
 need(typeof requestId==='string'&&uuid.test(requestId));
 need(['agi-creator','agi-reviewer'].includes(agent)&&sessionId===`agent:${agent}:agi-work-${requestId}`);
 need(['pre-run','post-run'].includes(phase));
 need(stage==='sandbox-recreate'&&['base','browser'].includes(target)||stage==='observer-finalize'&&target==='observer'||stage==='workspace-remove'&&target==='workspace');
 const trigger=value.trigger??(phase==='pre-run'?'preflight':'finalize');need(triggers.has(trigger));
 if(value.sandboxScopeKey!==undefined)need(isSandboxScopeKey(value.sandboxScopeKey,sessionId));
 const commandClassification=stage==='sandbox-recreate'?`openclaw-sandbox-recreate-${target}`:stage;
 return {requestId,sessionId,...(value.sandboxScopeKey===undefined?{}:{sandboxScopeKey:value.sandboxScopeKey}),agent,phase,stage,target,trigger,commandClass:stage==='sandbox-recreate'?'openclaw-sandbox-recreate':stage,commandClassification};
}
function inventory(value){
 if(!value)return {status:'NOT_REQUESTED',containerIDs:[]};
 const valid=inventoryStatuses.has(value.status)&&Array.isArray(value.containerIDs)&&value.containerIDs.length<=limits.containerIDs&&value.containerIDs.every(id=>typeof id==='string'&&hex.test(id))&&new Set(value.containerIDs).size===value.containerIDs.length;
 if(!valid||value.status!=='CAPTURED'&&value.containerIDs.length)return {status:'UNAVAILABLE',containerIDs:[]};
 return {status:value.status,containerIDs:[...value.containerIDs].sort()};
}
function outcome(value={}){
 const result=results.has(value.result)?value.result:'UNKNOWN';
 const commandResult=results.has(value.commandResult)?value.commandResult:'UNKNOWN';
 const postcondition=results.has(value.postcondition)?value.postcondition:'UNKNOWN';
 const failureCode=value.failureCode==null&&result==='PASS'?null:failureCodes.has(value.failureCode)?value.failureCode:'CLEANUP_FAILURE_UNCLASSIFIED';
 return {result,commandResult,postcondition,exitStatus:integer(value.exitStatus,255),signal:signals.has(value.signal)?value.signal:null,elapsedMs:integer(value.elapsedMs,limits.elapsedMs),timeoutMs:integer(value.timeoutMs,limits.timeoutMs),timedOut:boolean(value.timedOut),started:boolean(value.started),processTerminationConfirmed:boolean(value.processTerminationConfirmed),failureCode,failureCodeSource:failureCode===null?null:'wrapper-allowlist',openclawFailureCode:null,dockerBefore:inventory(value.dockerBefore),dockerAfter:inventory(value.dockerAfter),stopReason:value.stopReason==null?null:failureCodes.has(value.stopReason)?value.stopReason:'CLEANUP_FAILURE_UNCLASSIFIED',stopMarker:['PRESENT','NOT_REQUIRED','WRITE_FAILED','UNKNOWN'].includes(value.stopMarker)?value.stopMarker:'UNKNOWN'};
}
function cleanStart(value){
 need(value?.schema===schema&&value.event==='start'&&typeof value.attemptId==='string'&&uuid.test(value.attemptId)&&timestamp(value.startedAt));
 return {schema,event:'start',attemptId:value.attemptId,...context(value),startedAt:value.startedAt};
}
function cleanFinish(value){
 need(value?.schema===schema&&value.event==='finish'&&typeof value.attemptId==='string'&&uuid.test(value.attemptId)&&typeof value.startSha256==='string'&&hex.test(value.startSha256)&&timestamp(value.finishedAt));
 return {schema,event:'finish',attemptId:value.attemptId,startSha256:value.startSha256,finishedAt:value.finishedAt,outcome:outcome(value.outcome)};
}
function complete(start,finish){return {...start,event:'complete',finishedAt:finish.finishedAt,...finish.outcome};}
function cleanComplete(value){
 const start=cleanStart({...value,event:'start'});need(value.event==='complete'&&timestamp(value.finishedAt)&&Date.parse(value.finishedAt)>=Date.parse(value.startedAt));
 return {...start,event:'complete',finishedAt:value.finishedAt,...outcome(value)};
}

function noSymlinkChain(directory){
 need(typeof directory==='string'&&path.isAbsolute(directory));
 let current=path.resolve(directory);
 for(;;){const stat=fs.lstatSync(current);need(stat.isDirectory()&&!stat.isSymbolicLink());const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
function privateObject(file,directory=false){
 const stat=fs.lstatSync(file);
 need(!stat.isSymbolicLink()&&(!process.getuid||stat.uid===process.getuid())&&!(stat.mode&0o077)&&(directory?stat.isDirectory():stat.isFile()&&stat.nlink===1));return stat;
}
function syncDirectory(directory){
 const before=privateObject(directory,true),fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd);need(opened.dev===before.dev&&opened.ino===before.ino);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function rootFor(profileDir,{create=false}={}){
 noSymlinkChain(profileDir);const parent=privateObject(profileDir,true),root=path.join(profileDir,CLEANUP_EVIDENCE_DIRECTORY);
 if(create){try{fs.mkdirSync(root,{mode:0o700});syncDirectory(profileDir);}catch(error){if(error.code!=='EEXIST')throw error;}}
 const stat=privateObject(root,true),after=privateObject(profileDir,true);need(parent.dev===after.dev&&parent.ino===after.ino);return {root,stat};
}
function verifyRoot(root,expected,{unchanged=false}={}){noSymlinkChain(root);const stat=privateObject(root,true);need(stat.dev===expected.dev&&stat.ino===expected.ino&&(!unchanged||stat.mtimeMs===expected.mtimeMs&&stat.ctimeMs===expected.ctimeMs));}
function safeRead(root,name){
 const file=path.join(root,name),before=privateObject(file);need(before.size>0&&before.size<=limits.fileBytes);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;
 try{
  const opened=fs.fstatSync(fd);need(opened.dev===before.dev&&opened.ino===before.ino&&opened.uid===before.uid&&opened.mode===before.mode&&opened.nlink===1&&opened.size===before.size);
  bytes=Buffer.alloc(before.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);need(n>0);offset+=n;}
  const after=fs.fstatSync(fd);need(after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&after.nlink===1&&after.uid===before.uid&&after.mode===before.mode);
 }finally{fs.closeSync(fd);}
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{need(false);}return {value,bytes};
}
function append(root,expected,name,value){
 verifyRoot(root,expected);const bytes=Buffer.from(stable(value)+'\n');need(bytes.length<=limits.fileBytes,'COMPUTE_CLEANUP_EVIDENCE_LIMIT');
 const file=path.join(root,name),temporary=file+'.writing';let fd;
 try{fs.lstatSync(file);need(false);}catch(error){if(error.code!=='ENOENT')throw error;}
 // An interrupted staging file deliberately makes inventory fail closed. The
 // hard-link commit is atomic and refuses to replace an existing event.
 try{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
 verifyRoot(root,expected);fs.linkSync(temporary,file);fs.unlinkSync(temporary);syncDirectory(root);verifyRoot(root,expected);const read=safeRead(root,name);need(read.bytes.equals(bytes));return read;
}
function listing(root){
 const names=[];let bytes=0;const directory=fs.opendirSync(root);
 try{let entry;while((entry=directory.readSync())){need(names.length<limits.attempts*2,'COMPUTE_CLEANUP_EVIDENCE_LIMIT');need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(start|finish)\.json$/.test(entry.name));const stat=privateObject(path.join(root,entry.name));need(stat.size>0&&stat.size<=limits.fileBytes);bytes+=stat.size;need(bytes<=limits.bytes,'COMPUTE_CLEANUP_EVIDENCE_LIMIT');names.push(entry.name);}}finally{directory.closeSync();}
 return {names,bytes};
}
function failureSummary(status,code){return {schema,status,records:[],pending:[],issues:[code],attemptCount:0,bytes:0,retention:'append-only-no-pruning',valuesIncluded:false};}
function verifiedPass(record){
 if(record.result!=='PASS'||record.failureCode!==null||record.stopReason!==null||record.stopMarker!=='NOT_REQUIRED'||record.postcondition!=='PASS')return false;
 if(record.stage!=='sandbox-recreate')return record.commandResult==='NOT_RUN';
 return isSandboxScopeKey(record.sandboxScopeKey,record.sessionId)&&record.commandResult==='PASS'&&record.processTerminationConfirmed===true&&record.started===true&&record.exitStatus===0&&record.signal===null&&record.timedOut===false&&record.dockerBefore.status==='CAPTURED'&&record.dockerAfter.status==='CAPTURED'&&record.dockerAfter.containerIDs.length===0;
}
function summarize(records,pending,bytes){
 const failures=records.some(record=>!verifiedPass(record)),unconfirmedPass=records.some(record=>record.result==='PASS'&&!verifiedPass(record));
 const legacy=records.some(record=>record.stage==='sandbox-recreate'&&record.result==='PASS'&&record.sandboxScopeKey===undefined);
 const issues=[...(legacy?['COMPUTE_CLEANUP_LEGACY_SCOPE_UNVERIFIED']:[]),...(pending.length?['COMPUTE_CLEANUP_INTERRUPTED']:[]),...(failures?['COMPUTE_SANDBOX_CLEANUP_FAILED']:[]),...(unconfirmedPass?['COMPUTE_CLEANUP_EVIDENCE_INVALID']:[])];
 return {schema,status:issues.length?'BLOCKED':'PASS',records,pending,issues,attemptCount:records.length+pending.length,bytes,retention:'append-only-no-pruning',valuesIncluded:false};
}

function beginEvidence(c,value){
 try{
  const start={schema,event:'start',attemptId:crypto.randomUUID(),...context(value),startedAt:new Date().toISOString()};
  const {root,stat}=rootFor(c.profileDir,{create:true}),{names,bytes}=listing(root),starts=names.filter(name=>name.endsWith('.start.json')).length,finishes=names.length-starts;
  need(starts<limits.attempts&&bytes+(Math.max(0,starts-finishes)+2)*limits.fileBytes<=limits.bytes,'COMPUTE_CLEANUP_EVIDENCE_LIMIT');
  append(root,stat,start.attemptId+'.start.json',start);return Object.freeze(start);
 }catch(error){throw Error(error?.message==='COMPUTE_CLEANUP_EVIDENCE_LIMIT'?error.message:'COMPUTE_CLEANUP_EVIDENCE_FAILED');}
}

function finishEvidence(c,attempt,value){
 try{
  const expected=cleanStart(attempt),{root,stat}=rootFor(c.profileDir),read=safeRead(root,expected.attemptId+'.start.json'),start=cleanStart(read.value);
  need(same(start,read.value)&&same(expected,start));
  const finish={schema,event:'finish',attemptId:start.attemptId,startSha256:sha(read.bytes),finishedAt:new Date().toISOString(),outcome:outcome(value)};
  need(Date.parse(finish.finishedAt)>=Date.parse(start.startedAt));append(root,stat,start.attemptId+'.finish.json',finish);return complete(start,finish);
 }catch{throw Error('COMPUTE_CLEANUP_EVIDENCE_FAILED');}
}

export function readCleanupDirectory(root){
 try{
  noSymlinkChain(root);const stat=privateObject(root,true),{names,bytes}=listing(root),starts=new Map(),finishes=new Map();
  for(const name of names){const read=safeRead(root,name),isStart=name.endsWith('.start.json'),value=isStart?cleanStart(read.value):cleanFinish(read.value);need(same(value,read.value)&&name===value.attemptId+(isStart?'.start.json':'.finish.json'));(isStart?starts:finishes).set(value.attemptId,{value,bytes:read.bytes});}
  need(starts.size<=limits.attempts);for(const id of finishes.keys())need(starts.has(id));
  const records=[],pending=[];
  for(const [id,start]of starts){const finish=finishes.get(id);if(!finish){pending.push(start.value);continue;}need(finish.value.startSha256===sha(start.bytes)&&Date.parse(finish.value.finishedAt)>=Date.parse(start.value.startedAt));records.push(complete(start.value,finish.value));}
  verifyRoot(root,stat,{unchanged:true});records.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.attemptId.localeCompare(b.attemptId));pending.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.attemptId.localeCompare(b.attemptId));return summarize(records,pending,bytes);
 }catch(error){const status=error?.message==='COMPUTE_CLEANUP_EVIDENCE_LIMIT'?'LIMIT':error?.message==='COMPUTE_CLEANUP_EVIDENCE_INVALID'?'CORRUPT':'UNREADABLE';return failureSummary(status,status==='LIMIT'?'COMPUTE_CLEANUP_EVIDENCE_LIMIT':status==='CORRUPT'?'COMPUTE_CLEANUP_EVIDENCE_INVALID':'COMPUTE_CLEANUP_EVIDENCE_UNREADABLE');}
}

export function readCleanupEvidence(profileDir){
 try{
  noSymlinkChain(profileDir);privateObject(profileDir,true);
  const history=readCleanupHistory(profileDir,readCleanupDirectory),root=path.join(profileDir,CLEANUP_EVIDENCE_DIRECTORY);
  let active;try{fs.lstatSync(root);active=readCleanupDirectory(root);}catch(error){if(error.code!=='ENOENT')throw error;need(history.sequence===0);active={...failureSummary('ABSENT','COMPUTE_CLEANUP_EVIDENCE_INVALID'),issues:[]};}
  need(same(history,readCleanupHistory(profileDir,readCleanupDirectory)));return {...active,capacity:cleanupCapacity(profileDir,active,history)};
 }catch{return failureSummary('CORRUPT','COMPUTE_CLEANUP_HISTORY_INVALID');}
}
export function beginCleanupEvidence(c,value){
 // Validate scope before creating any ledger/control files.
 try{context(value);}catch{throw Error('COMPUTE_CLEANUP_EVIDENCE_FAILED');}
 return withCleanupHistoryLease(c.profileDir,()=>{
  const summary=readCleanupEvidence(c.profileDir);
  need(!summary.issues.includes('COMPUTE_CLEANUP_HISTORY_INVALID'),'COMPUTE_CLEANUP_EVIDENCE_FAILED');
  need(summary.capacity?.freeBytes===null||summary.capacity?.freeBytes>=HISTORY_LIMITS.minimumFreeBytes,'COMPUTE_CLEANUP_EVIDENCE_LIMIT');
  if(summary.status==='PASS'&&(summary.attemptCount>=HISTORY_LIMITS.rotateAttempts||summary.bytes>=HISTORY_LIMITS.rotateBytes))rotateCleanupHistory(c.profileDir,readCleanupDirectory);
  return beginEvidence(c,value);
 });
}
export function finishCleanupEvidence(c,attempt,value){return withCleanupHistoryLease(c.profileDir,()=>finishEvidence(c,attempt,value));}
export function archiveCleanupEvidence(profileDir,options={}){rotateCleanupHistory(profileDir,readCleanupDirectory,options);return readCleanupEvidence(profileDir);}

export function safeCleanupEvidence(value){
 try{
  need(value?.schema===schema&&['ABSENT','PASS','BLOCKED','CORRUPT','UNREADABLE','LIMIT'].includes(value.status)&&Array.isArray(value.records)&&Array.isArray(value.pending)&&value.records.length+value.pending.length<=limits.attempts);
  const records=value.records.map(cleanComplete),pending=value.pending.map(cleanStart);need(new Set([...records,...pending].map(record=>record.attemptId)).size===records.length+pending.length);
  const bytes=integer(value.bytes,limits.bytes)??0,summary=summarize(records,pending,bytes);
  if(value.status==='ABSENT'){need(!records.length&&!pending.length);summary.status='ABSENT';}
  else if(['CORRUPT','UNREADABLE','LIMIT'].includes(value.status))summary.status=value.status;
  else if(value.status==='BLOCKED')summary.status='BLOCKED';
  const extra=Array.isArray(value.issues)?value.issues.filter(code=>issueCodes.has(code)):[];summary.issues=[...new Set([...summary.issues,...extra])];
  if(summary.issues.length&&summary.status==='PASS')summary.status='BLOCKED';if(value.capacity)summary.capacity=safeCleanupCapacity(value.capacity);return summary;
 }catch{return failureSummary('CORRUPT','COMPUTE_CLEANUP_EVIDENCE_INVALID');}
}

export function evidenceBlocksWork(summary){const safe=safeCleanupEvidence(summary);return !['ABSENT','PASS'].includes(safe.status)||safe.pending.length>0||safe.issues.length>0;}

export function safeCleanupCapacity(v){
 const fields=['activeAttempts','activeBytes','remainingAttempts','remainingBytes','archivedAttempts','archivedBytes','archiveSegments','maximumSegments','freeBytes','minimumFreeBytes'];
 need(v?.schema==='agi-cleanup-capacity/v1'&&fields.every(k=>k==='freeBytes'&&v[k]===null||Number.isSafeInteger(v[k])&&v[k]>=0));
 need(v.archiveHeadSha256===null||hex.test(v.archiveHeadSha256));
 need(['NONE','DISK_CAPACITY_UNKNOWN','DISK_SPACE_LOW','HISTORY_CAPACITY_REACHED','HISTORY_CAPACITY_LOW','ROTATION_DUE'].includes(v.warning));
 return {schema:v.schema,...Object.fromEntries(fields.map(k=>[k,v[k]])),archiveHeadSha256:v.archiveHeadSha256,warning:v.warning,retention:'all-events-preserved'};
}
