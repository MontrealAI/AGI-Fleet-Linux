import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha256} from '../src/util.mjs';
import {sqliteSecurityProjection,runtimeSQLiteDiagnosticTableNames} from './setup-runtime-sqlite.mjs';

const SCHEMA='agi-runtime-state-localization/v1',RELATIVE='state/openclaw.sqlite',SOURCE='transaction/previous/state/openclaw.sqlite';
const LIMITS={tables:256,records:512,deltas:256};
const TABLES=new Set(runtimeSQLiteDiagnosticTableNames());
const LOGICAL=new Set(['primary','startup-migrations','state-migrations','authProfiles.store','authProfiles.state','auth.sharedStore','update.checkState','gateway-restart','current']);
const CODES=new Set(['SETUP_RUNTIME_SECURITY_VERSION','SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SECURITY_INVALID','SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED','SETUP_RUNTIME_SQLITE_READ_FAILED','SETUP_STATE_OWNER_REQUIRED','SETUP_STATE_FILE_UNSUPPORTED','SETUP_PROFILE_CHANGED','REPAIR_RUNTIME_STATE_SOURCE_MISSING','REPAIR_RUNTIME_STATE_COPY_REQUIRED','REPAIR_RUNTIME_STATE_PROJECTION_FAILED']);
const STAGES=new Set(['baseline-validation','current-projection','baseline-projection','current-coherence']);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nullableHex=value=>value===null||hex(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const inside=(root,file)=>root===file||file.startsWith(root+path.sep);
const need=(ok,code)=>{if(!ok)throw Error(code);};
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000;
function failure(error,stage){return {stage,code:CODES.has(error?.message)?error.message:error?.code==='ENOENT'?'REPAIR_RUNTIME_STATE_SOURCE_MISSING':'REPAIR_RUNTIME_STATE_PROJECTION_FAILED'};}
function validateRecord(record){
 need(record?.version===1&&hex(record.digest)&&hex(record.immutableDigest)&&record.contract?.version===1&&record.contract.phase==='sealed'&&hex(record.sqliteSecurityDigests?.[RELATIVE]),'SETUP_RUNTIME_SECURITY_VERSION');
 need(record.digest===sha256(canonical({contract:record.contract,immutableDigest:record.immutableDigest,sqliteSecurityDigests:record.sqliteSecurityDigests})),'SETUP_RUNTIME_SECURITY_VERSION');
 const contract=record.contract;
 need(typeof contract.profileDir==='string'&&path.isAbsolute(contract.profileDir)&&path.resolve(contract.profileDir)===contract.profileDir&&Array.isArray(contract.registryAliases)&&contract.registryAliases.length<=1&&contract.registryAliases.every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&path.basename(root)==='candidate'),'SETUP_RUNTIME_SECURITY_VERSION');
 need(Array.isArray(contract.sqliteSchemaGuards?.[RELATIVE]),'SETUP_RUNTIME_SECURITY_VERSION');return contract;
}
function project(root,contract){
 need(typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&![contract.profileDir,...contract.registryAliases.map(alias=>path.dirname(alias))].some(source=>inside(source,root)||inside(root,source)),'REPAIR_RUNTIME_STATE_COPY_REQUIRED');
 const stat=fs.lstatSync(root);need(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(root)===root,'REPAIR_RUNTIME_STATE_COPY_REQUIRED');
 return sqliteSecurityProjection(path.join(root,RELATIVE),{root,relative:RELATIVE,profileDir:contract.profileDir,allowedProfileRoots:[contract.profileDir,...contract.registryAliases],requiredSchemaObjects:contract.sqliteSchemaGuards[RELATIVE],diagnostics:true});
}
function tableDetails(projection){
 let remaining=LIMITS.records;
 const entries=Object.entries(projection.diagnosticDetails.tableDigests).sort(([a],[b])=>a.localeCompare(b));
 return {sha256:projection.sha256,tables:entries.slice(0,LIMITS.tables).map(([table,value])=>{
  const records=value.records.slice(0,remaining).map(record=>({keySha256:record.keySha256,sha256:record.sha256,...(LOGICAL.has(record.logicalRecord)?{logicalRecord:record.logicalRecord}:{})}));remaining-=records.length;
  return {table,sha256:value.sha256,recordCount:value.recordCount,records,recordsTruncated:value.recordsTruncated||records.length<value.recordCount};
 }),tablesTruncated:entries.length>LIMITS.tables};
}
function differences(before,after){
 const result=[];
 for(const table of [...new Set([...Object.keys(before),...Object.keys(after)])].sort()){
  const left=before[table],right=after[table];if(!left||!right||left.sha256===right.sha256)continue;
  result.push({kind:'table',table,reason:'digest-mismatch',expectedSha256:left.sha256,observedSha256:right.sha256});
  if(left.recordsTruncated||right.recordsTruncated)continue;
  const a=new Map(left.records.map(row=>[row.keySha256,row])),b=new Map(right.records.map(row=>[row.keySha256,row]));
  if(a.size!==left.records.length||b.size!==right.records.length)continue;
  for(const key of [...new Set([...a.keys(),...b.keys()])].sort()){
   const l=a.get(key),r=b.get(key);if(l?.sha256===r?.sha256)continue;
   const logical=r?.logicalRecord??l?.logicalRecord;
   result.push({kind:'record',table,recordKeySha256:key,...(LOGICAL.has(logical)?{logicalRecord:logical}:{}),reason:!l?'added':!r?'removed':'digest-mismatch',expectedSha256:l?.sha256??null,observedSha256:r?.sha256??null});
  }
 }
 return {deltas:result.slice(0,LIMITS.deltas),deltasTruncated:result.length>LIMITS.deltas};
}
/** Diagnostic comparison of caller-owned disposable copies only. A previous
 * database becomes a component baseline only when its projection reproduces
 * the persisted sealed aggregate exactly; no original database is opened. */
export function localizeRuntimeState({currentRoot,previousRoot=null,sealedRecord,expectedCurrentSha256}={}){
 const output={schema:SCHEMA,path:RELATIVE,status:'BLOCKED',baseline:{source:SOURCE,available:previousRoot!==null,expectedSha256:hex(sealedRecord?.sqliteSecurityDigests?.[RELATIVE])?sealedRecord.sqliteSecurityDigests[RELATIVE]:null,candidateSha256:null,matchesSealed:false,reason:'not-inspected'},current:null,matchesObservedAggregate:null,deltas:[],deltasTruncated:false,failure:null,historicalCauseEstablished:false,reconciliationAuthorized:false};
 let stage='baseline-validation';
 try{
  const contract=validateRecord(sealedRecord);need(expectedCurrentSha256===undefined||hex(expectedCurrentSha256),'SETUP_RUNTIME_SECURITY_VERSION');
  stage='current-projection';const current=project(currentRoot,contract);output.current=tableDetails(current);
  output.matchesObservedAggregate=expectedCurrentSha256===undefined?null:current.sha256===expectedCurrentSha256;
  if(output.matchesObservedAggregate===false){stage='current-coherence';throw Error('SETUP_PROFILE_CHANGED');}
  if(previousRoot===null){output.status='BASELINE_UNAVAILABLE';output.baseline.reason='missing-source-artifact';return safeRuntimeStateLocalization(output);}
  stage='baseline-projection';const previous=project(previousRoot,contract);output.baseline.candidateSha256=previous.sha256;
  output.baseline.matchesSealed=previous.sha256===output.baseline.expectedSha256;
  if(!output.baseline.matchesSealed){output.status='BASELINE_MISMATCH';output.baseline.reason='candidate-does-not-match-seal';return safeRuntimeStateLocalization(output);}
  output.baseline.reason='aggregate-matches-seal';output.status='LOCALIZED';
  Object.assign(output,differences(previous.diagnosticDetails.tableDigests,current.diagnosticDetails.tableDigests));
 }catch(error){output.failure=failure(error,stage);if(stage==='baseline-projection'){output.status='BASELINE_UNAVAILABLE';output.baseline.reason=output.failure.code==='REPAIR_RUNTIME_STATE_SOURCE_MISSING'?'missing-source-artifact':'projection-failed';}else{output.status='BLOCKED';}}
 return safeRuntimeStateLocalization(output);
}
export function safeRuntimeStateLocalization(value){
 const top=['schema','path','status','baseline','current','matchesObservedAggregate','deltas','deltasTruncated','failure','historicalCauseEstablished','reconciliationAuthorized'];
 if(!exact(value,top)||value.schema!==SCHEMA||value.path!==RELATIVE||!['LOCALIZED','BASELINE_UNAVAILABLE','BASELINE_MISMATCH','BLOCKED'].includes(value.status)||value.historicalCauseEstablished!==false||value.reconciliationAuthorized!==false)return null;
 const baseline=value.baseline,current=value.current;
 if(!exact(baseline,['source','available','expectedSha256','candidateSha256','matchesSealed','reason'])||baseline.source!==SOURCE||typeof baseline.available!=='boolean'||!nullableHex(baseline.expectedSha256)||!nullableHex(baseline.candidateSha256)||typeof baseline.matchesSealed!=='boolean'||!['not-inspected','missing-source-artifact','candidate-does-not-match-seal','aggregate-matches-seal','projection-failed'].includes(baseline.reason))return null;
 if(baseline.matchesSealed&&(!hex(baseline.expectedSha256)||baseline.candidateSha256!==baseline.expectedSha256))return null;
 if(!(value.matchesObservedAggregate===null||typeof value.matchesObservedAggregate==='boolean')||typeof value.deltasTruncated!=='boolean')return null;
 if(current!==null){
  if(!exact(current,['sha256','tables','tablesTruncated'])||!hex(current.sha256)||!Array.isArray(current.tables)||current.tables.length>LIMITS.tables||typeof current.tablesTruncated!=='boolean'||new Set(current.tables.map(x=>x?.table)).size!==current.tables.length)return null;
  let records=0;
  for(const item of current.tables){
   if(!exact(item,['table','sha256','recordCount','records','recordsTruncated'])||!TABLES.has(item.table)||!hex(item.sha256)||!count(item.recordCount)||!Array.isArray(item.records)||typeof item.recordsTruncated!=='boolean'||item.records.length>item.recordCount||(!item.recordsTruncated&&item.records.length!==item.recordCount))return null;
   records+=item.records.length;if(records>LIMITS.records)return null;
   for(const row of item.records)if(!exact(row,row.logicalRecord===undefined?['keySha256','sha256']:['keySha256','sha256','logicalRecord'])||!hex(row.keySha256)||!hex(row.sha256)||(row.logicalRecord!==undefined&&!LOGICAL.has(row.logicalRecord)))return null;
  }
 }
 if(!Array.isArray(value.deltas)||value.deltas.length>LIMITS.deltas||value.deltas.length&&!baseline.matchesSealed)return null;
 for(const delta of value.deltas){
  const keys=['kind','table','reason','expectedSha256','observedSha256',...(delta?.kind==='record'?['recordKeySha256']:[]),...(delta?.logicalRecord!==undefined?['logicalRecord']:[])];
  if(!exact(delta,keys)||!['table','record'].includes(delta.kind)||!TABLES.has(delta.table)||!['digest-mismatch','added','removed'].includes(delta.reason)||!nullableHex(delta.expectedSha256)||!nullableHex(delta.observedSha256)||delta.expectedSha256===delta.observedSha256||delta.kind==='record'&&!hex(delta.recordKeySha256)||delta.logicalRecord!==undefined&&!LOGICAL.has(delta.logicalRecord))return null;
 }
 if(value.failure!==null&&(!exact(value.failure,['stage','code'])||!STAGES.has(value.failure.stage)||!CODES.has(value.failure.code)))return null;
 if(value.status==='LOCALIZED'&&(!current||!baseline.matchesSealed||baseline.reason!=='aggregate-matches-seal'||value.failure!==null||value.matchesObservedAggregate===false))return null;
 if(value.status==='BASELINE_UNAVAILABLE'&&(!current||baseline.matchesSealed||baseline.candidateSha256!==null||!['missing-source-artifact','projection-failed'].includes(baseline.reason)||value.matchesObservedAggregate===false))return null;
 if(current===null&&value.matchesObservedAggregate!==null||value.status!=='LOCALIZED'&&(value.deltas.length||value.deltasTruncated))return null;
 if(value.status==='BASELINE_MISMATCH'&&(!current||baseline.matchesSealed||!hex(baseline.candidateSha256)||baseline.reason!=='candidate-does-not-match-seal'||value.failure!==null))return null;
 if(value.status==='BLOCKED'&&value.failure===null)return null;
 return JSON.parse(JSON.stringify(value));
}
