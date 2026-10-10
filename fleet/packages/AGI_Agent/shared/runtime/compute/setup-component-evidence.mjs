import {ALL_OAUTH_ROLES} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {runtimeSQLiteSecurityTableNames} from './setup-runtime-sqlite.mjs';
import {canonical,sha256} from '../src/util.mjs';

const need=(ok,code='SETUP_COMPONENT_EVIDENCE_INVALID')=>{if(!ok)throw Error(code);};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const schema='agi-setup-complete-components/v1';
const directoryName='component-evidence';
const limit=32*1024*1024;
const phases=new Set(['before-managed-service-install','after-managed-service-install','reviewed-before-approval','sealed-before-readiness','completion-after-readiness','failure-observation','rollback-before-restore','rollback-current','rollback-restored']);
const databases=new Set(['state/openclaw.sqlite',...ALL_OAUTH_ROLES.map(role=>`agents/${role}/agent/openclaw-agent.sqlite`)]);
const validRelative=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!path.isAbsolute(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..');
function privateObject(file,directory=false){
 const stat=fs.lstatSync(file);need(!stat.isSymbolicLink()&&(!process.getuid||stat.uid===process.getuid())&&!(stat.mode&0o077)&&(directory?stat.isDirectory():stat.isFile()&&stat.nlink===1));return stat;
}
function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function evidenceRoot(directory,{create=false}={}){
 privateObject(directory,true);need(fs.realpathSync(directory)===path.resolve(directory));
 const root=path.join(directory,directoryName);if(create){try{fs.mkdirSync(root,{mode:0o700});syncDirectory(directory);}catch(error){if(error.code!=='EEXIST')throw error;}}
 privateObject(root,true);return root;
}
function identitySummary(identity){return {version:identity.version,digest:identity.digest,immutableDigest:identity.immutableDigest,sqliteSecurityDigests:identity.sqliteSecurityDigests,contract:identity.contract};}
/** Full hashes from one coherent security capture. The SQLite aggregate retains
 * its existing raw-projection definition: table/record hashes are not claimed
 * to be its preimage. Their provenance is bound by this artifact's SHA and the
 * approval, while immutable and top-level aggregates are recomputed here. */
export function validateCompleteComponents(captured){
 const {identity,components}=captured??{};
 need(identity?.version===1&&hex(identity.digest)&&hex(identity.immutableDigest)&&identity.contract?.version===1&&components&&Array.isArray(components.immutableEntries));
 need(components.immutableEntries.length<=100000,'SETUP_COMPONENT_EVIDENCE_LIMIT');
 const entries=components.immutableEntries;
 need(entries.every(entry=>Array.isArray(entry)&&validRelative(entry[0])&&(entry.length===2&&entry[1]==='directory'||entry.length===4&&entry[1]==='file'&&typeof entry[2]==='boolean'&&hex(entry[3])))&&new Set(entries.map(entry=>entry[0])).size===entries.length);
 need(sha256(canonical([...entries].sort((a,b)=>a[0].localeCompare(b[0]))))===identity.immutableDigest);
 need(identity.sqliteSecurityDigests&&components.sqlite&&canonical(Object.keys(identity.sqliteSecurityDigests).sort())===canonical(Object.keys(components.sqlite).sort()));
 for(const [relative,digest]of Object.entries(identity.sqliteSecurityDigests)){
  const item=components.sqlite[relative];need(databases.has(relative)&&hex(digest)&&item?.schema==='agi-runtime-sqlite-diagnostic/v1'&&item.aggregateSha256===digest&&item.tableDigests&&typeof item.tableDigests==='object');
  need(canonical(Object.keys(item.tableDigests).sort())===canonical(runtimeSQLiteSecurityTableNames(relative)));
  const tables=Object.entries(item.tableDigests);need(tables.length<=1000,'SETUP_COMPONENT_EVIDENCE_LIMIT');let total=0;
  for(const [table,entry]of tables){need(/^[a-zA-Z0-9_]+$/.test(table)&&hex(entry?.sha256)&&Number.isSafeInteger(entry.recordCount)&&entry.recordCount>=0&&Array.isArray(entry.records)&&entry.recordsTruncated===false&&entry.records.length===entry.recordCount);total+=entry.recordCount;need(total<=100000,'SETUP_COMPONENT_EVIDENCE_LIMIT');need(entry.records.every(row=>row&&hex(row.keySha256)&&hex(row.sha256)&&Object.keys(row).every(key=>['keySha256','sha256','logicalRecord'].includes(key))&&(row.logicalRecord===undefined||typeof row.logicalRecord==='string'&&row.logicalRecord.length<=100)));}
 }
 need(identity.digest===sha256(canonical({contract:identity.contract,immutableDigest:identity.immutableDigest,sqliteSecurityDigests:identity.sqliteSecurityDigests})));
 return true;
}
export function validateComponentReference(ref,{transactionId,phase,identityDigest}={}){
 need(ref&&ref.schema===schema&&hex(ref.sha256)&&ref.file===`${directoryName}/${ref.sha256}.json`&&typeof ref.transactionId==='string'&&phases.has(ref.phase)&&hex(ref.identityDigest)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=limit);
 need((transactionId===undefined||ref.transactionId===transactionId)&&(phase===undefined||ref.phase===phase)&&(identityDigest===undefined||ref.identityDigest===identityDigest));return ref;
}
function readEvidence(directory,ref,expected={}){
 validateComponentReference(ref,expected);const root=evidenceRoot(directory),file=path.join(directory,ref.file),before=privateObject(file);
 need(path.dirname(file)===root&&before.size===ref.bytes&&before.size<=limit);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;
 try{const opened=fs.fstatSync(fd);need(opened.dev===before.dev&&opened.ino===before.ino&&opened.uid===before.uid&&opened.mode===before.mode&&opened.nlink===1);bytes=fs.readFileSync(fd);const after=fs.fstatSync(fd);need(after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&after.nlink===1&&after.uid===before.uid&&after.mode===before.mode);}finally{fs.closeSync(fd);}
 need(sha256(bytes)===ref.sha256);let value;try{value=JSON.parse(bytes);}catch{need(false);}
 need(value.schema===schema&&value.transactionId===ref.transactionId&&value.phase===ref.phase&&value.identity.digest===ref.identityDigest&&typeof value.capturedAt==='string'&&Number.isFinite(Date.parse(value.capturedAt))&&value.captureComplete===true&&value.valuesIncluded===false);
 validateCompleteComponents(value);return value;
}
export function readComponentEvidence(directory,ref,expected={}){
 try{return readEvidence(directory,ref,expected);}catch(error){if(/^SETUP_COMPONENT_EVIDENCE_/.test(error?.message))throw error;throw Error('SETUP_COMPONENT_EVIDENCE_INVALID',{cause:error});}
}
export function persistComponentEvidence(directory,{transactionId,phase,captured}){
 need(typeof transactionId==='string'&&/^[a-f0-9-]{36}$/.test(transactionId)&&phases.has(phase));validateCompleteComponents(captured);
 const value={schema,transactionId,phase,capturedAt:new Date().toISOString(),captureComplete:true,valuesIncluded:false,identity:identitySummary(captured.identity),components:captured.components};
 const bytes=Buffer.from(canonical(value)+'\n');need(bytes.length<=limit,'SETUP_COMPONENT_EVIDENCE_LIMIT');
 const hash=sha256(bytes),ref={schema,transactionId,phase,identityDigest:captured.identity.digest,file:`${directoryName}/${hash}.json`,sha256:hash,bytes:bytes.length},root=evidenceRoot(directory,{create:true}),file=path.join(root,hash+'.json');
 let fd;try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch(error){if(error.code!=='EEXIST')throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}
 syncDirectory(root);readComponentEvidence(directory,ref,{transactionId,phase,identityDigest:captured.identity.digest});return ref;
}

/** Public diagnostic boundary: artifact commitments only, never private tuples,
 * SQLite values, profile locations, or contents of the evidence artifacts. */
export function safeComponentEvidenceSummary(state){
 if(state?.schema==='agi-setup-component-evidence-summary/v1'){const value=state,restore=ref=>ref&&{...ref,schema,transactionId:value.transactionId};state={installationTrack:'clean-install',componentEvidenceVersion:1,id:value.transactionId,componentEvidence:{reviewed:restore(value.reviewed),sealed:restore(value.sealed),observations:Array.isArray(value.observations)?value.observations.slice(0,32).map(restore):[]},componentEvidenceFailureCode:value.failureCode};}
 if(!['clean-install','clean-maintenance'].includes(state?.installationTrack)||state.componentEvidenceVersion!==1)return null;
 const safe=ref=>{try{validateComponentReference(ref,{transactionId:state.id});return {phase:ref.phase,file:ref.file,sha256:ref.sha256,bytes:ref.bytes,identityDigest:ref.identityDigest};}catch{return null;}};
 const evidence=state.componentEvidence??{};
 return {schema:'agi-setup-component-evidence-summary/v1',transactionId:/^[a-f0-9-]{36}$/.test(state.id??'')?state.id:null,reviewed:safe(evidence.reviewed),sealed:safe(evidence.sealed),observations:Array.isArray(evidence.observations)?evidence.observations.slice(0,32).map(safe).filter(Boolean):[],failureCode:['SETUP_COMPONENT_EVIDENCE_INVALID','SETUP_COMPONENT_EVIDENCE_LIMIT','SETUP_PROFILE_CHANGED','SETUP_COMPONENT_EVIDENCE_CAPTURE_FAILED'].includes(state.componentEvidenceFailureCode)?state.componentEvidenceFailureCode:null,valuesIncluded:false};
}
