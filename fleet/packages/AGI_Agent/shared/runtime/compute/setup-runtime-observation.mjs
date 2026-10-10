import {roleContract,COMPUTE_ROLES,OPERATOR_ROLES,setupRole} from './roles.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectRuntimeSecurityIdentity,safeRuntimeIdentityDiagnostic,captureRuntimeSecurityComponents,captureRuntimeImmutableComponents} from './setup-runtime-identity.mjs';
import {localizeImmutableBaseline,safeImmutableLocalization} from './setup-runtime-immutable-localization.mjs';
import {localizeRuntimeState,safeRuntimeStateLocalization} from './setup-runtime-state-localization.mjs';
import {RUNTIME_SQLITE_PATHS,runtimeSQLiteDiagnosticTableNames} from './setup-runtime-sqlite.mjs';
import {safeSetupFailure} from './setup-auth.mjs';
import {canonical} from '../src/util.mjs';

const LEGACY_SCHEMA='agi-transaction-runtime-observation/v1';
const SCHEMA='agi-transaction-runtime-observation/v2';
const PHASE='post-failure-stopped-observation';
const LIMITS={entries:20000,bytes:512*1024*1024,fileBytes:128*1024*1024,transactionBytes:8*1024*1024,depth:64};
const need=(ok,code='REPAIR_RUNTIME_OBSERVATION_UNSAFE')=>{if(!ok)throw Error(code);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const code=value=>value===null||typeof value==='string'&&safeSetupFailure({message:value})===value;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const signature=stat=>['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'].map(key=>String(stat[key])).join(':');
function owned(file,{directory=false,privateMode=false}={}){
 const stat=fs.lstatSync(file,{bigint:true});
 need(!stat.isSymbolicLink()&&(!process.getuid||stat.uid===BigInt(process.getuid())),'SETUP_STATE_OWNER_REQUIRED');
 need(directory?stat.isDirectory():stat.isFile()||stat.isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');
 need(!(stat.mode&BigInt(privateMode?0o077:0o022))&&(!stat.isFile()||stat.nlink===1n),'SETUP_STATE_OWNER_REQUIRED');
 return stat;
}
function same(before,after){need(signature(before)===signature(after),'SETUP_PROFILE_CHANGED');}
function regular(stat){need(stat.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');}
function readFile(file,stat,limit){
 regular(stat);need(stat.size<=BigInt(limit),'REPAIR_RUNTIME_OBSERVATION_LIMIT');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{same(stat,fs.fstatSync(fd,{bigint:true}));const bytes=Buffer.alloc(Number(stat.size)),extra=Buffer.alloc(1);let offset=0;while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),offset);need(count>0,'SETUP_PROFILE_CHANGED');offset+=count;}need(fs.readSync(fd,extra,0,1,offset)===0,'SETUP_PROFILE_CHANGED');same(stat,fs.fstatSync(fd,{bigint:true}));same(stat,owned(file));return bytes;}
 finally{fs.closeSync(fd);}
}
function parseRecord(bytes,{profileDir,candidate}){
 let value;try{value=JSON.parse(bytes);}catch{throw Error('REPAIR_RUNTIME_TRANSACTION_INVALID');}
 need(value&&value.schema===1&&uuid(value.id)&&value.profileDir===profileDir&&value.state==='safe-stop-required'&&value.treeIdentityVersion===3&&value.stagingProtocolVersion===2&&value.runtimeSecurityVersion===1,'REPAIR_RUNTIME_TRANSACTION_INVALID');
 const record=value.runtimeSecurityRecord;
 need(record?.version===1&&record.contract?.version===1&&record.contract.phase==='sealed'&&record.contract.profileDir===profileDir&&hex(record.digest)&&record.digest===value.sealedSecurityIdentity,'REPAIR_RUNTIME_TRANSACTION_INVALID');
 need(Array.isArray(record.contract.registryAliases)&&record.contract.registryAliases.every(alias=>alias===candidate)&&record.contract.registryAliases.length<=1,'REPAIR_RUNTIME_TRANSACTION_INVALID');
 need(code(value.primaryFailureCode??null)&&code(value.rollbackFailureCode??null),'REPAIR_RUNTIME_TRANSACTION_INVALID');
 return value;
}

function safeLegacyTransactionRuntimeObservation(value){
 const top=['schema','status','observedAt','transaction','source','timing','historicalCauseEstablished','rollbackAuthorized','diagnostic'];
 if(!exact(value,top)||value.schema!==LEGACY_SCHEMA||value.status!=='OBSERVED'||value.timing!==PHASE||value.historicalCauseEstablished!==false||value.rollbackAuthorized!==false||typeof value.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.observedAt))return null;
 const tx=value.transaction,source=value.source;
 if(!exact(tx,['id','state','recordSha256','primaryFailureCode','rollbackFailureCode'])||!uuid(tx.id)||tx.state!=='safe-stop-required'||!hex(tx.recordSha256)||!code(tx.primaryFailureCode)||!code(tx.rollbackFailureCode))return null;
 if(!exact(source,['stable','copiedFiles','copiedBytes','sourceSQLiteOpened','sourceWritten'])||source.stable!==true||source.sourceSQLiteOpened!==false||source.sourceWritten!==false||!Number.isSafeInteger(source.copiedFiles)||source.copiedFiles<0||source.copiedFiles>LIMITS.entries||!Number.isSafeInteger(source.copiedBytes)||source.copiedBytes<0||source.copiedBytes>LIMITS.bytes)return null;
 const diagnostic=safeRuntimeIdentityDiagnostic(value.diagnostic);if(!diagnostic||diagnostic.phase!==PHASE)return null;
 return {schema:LEGACY_SCHEMA,status:'OBSERVED',observedAt:value.observedAt,transaction:{...tx},source:{...source},timing:PHASE,historicalCauseEstablished:false,rollbackAuthorized:false,diagnostic};
}

const STAGES=new Set(['input-validation','home-validation','transaction-boundaries','transaction-read','transaction-parse','baseline-validation','profile-boundaries','temporary-root-validation','copy-profile','previous-profile-boundaries','copy-previous','localization','source-revalidation-before-comparison','identity-comparison','source-revalidation-after-comparison','cleanup','complete','worker']);
const ARTIFACTS=new Set(['input','home','setup-directory','transaction-directory','transaction-record','approved-security-record','sealed-security-record','live-profile','temporary-root','disposable-profile','previous-profile','disposable-previous','worker']);
const FAILURE_CODES=new Set(['REPAIR_RUNTIME_OBSERVATION_UNSAFE','REPAIR_RUNTIME_OBSERVATION_PATH','REPAIR_RUNTIME_OBSERVATION_LIMIT','REPAIR_RUNTIME_OBSERVATION_INVALID','REPAIR_RUNTIME_TRANSACTION_INVALID','REPAIR_RUNTIME_OBSERVATION_IO_FAILED','REPAIR_RUNTIME_OBSERVATION_FAILED','SETUP_STATE_OWNER_REQUIRED','SETUP_STATE_FILE_UNSUPPORTED','SETUP_PROFILE_CHANGED','SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED','SETUP_RUNTIME_SECURITY_VERSION','SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SECURITY_INVALID','SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED','SETUP_RUNTIME_SQLITE_READ_FAILED']);
const ERRNOS=new Set(['ENOENT','EACCES','EPERM','ENOSPC','EIO','ENOTDIR','EISDIR','ELOOP','EMFILE','ENFILE','EROFS','EBUSY','EEXIST','EINVAL']);
const KNOWN_PATHS=new Set(['transaction/transaction.json','transaction','transaction/previous','openclaw.json','openclaw.json.last-good','compute-settings.json','agi-compute-profile.json','agi-runtime/gateway-wrapper','agi-openclaw-gateway-wrapper','agi-runtime','COMPUTE_STOP','SETUP_PENDING','plugin-skills',...RUNTIME_SQLITE_PATHS,...RUNTIME_SQLITE_PATHS.flatMap(name=>['-wal','-shm','-journal'].map(suffix=>name+suffix))]);
const SOURCES={approved:'transaction/transaction.json#/approvedSecurityRecord',sealed:'transaction/transaction.json#/runtimeSecurityRecord',completed:'transaction/transaction.json#/completedIdentity',rollback:'transaction/transaction.json#/rollbackPlan/restoredSecurity'};
const SOURCE_POINTERS=new Set(Object.values(SOURCES));
const MISSING_POINTERS=new Set([...SOURCE_POINTERS,...[SOURCES.approved,SOURCES.sealed,SOURCES.rollback].flatMap(source=>[source+'/diagnosticDetails/immutableEntries',source+'/diagnosticDetails/sqlite',...RUNTIME_SQLITE_PATHS.map(relative=>source+'/diagnosticDetails/sqlite/'+relative.replaceAll('~','~0').replaceAll('/','~1')+'/tableDigests')])]);
const DETAIL_STATES=new Set(['not-inspected','missing','available','advisory-present','invalid']);
const KNOWN_TABLES=new Set(runtimeSQLiteDiagnosticTableNames());
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
function validSQLiteDetails(value,digest){
 if(!value||value.schema!=='agi-runtime-sqlite-diagnostic/v1'||value.aggregateSha256!==digest||!value.tableDigests||typeof value.tableDigests!=='object'||Array.isArray(value.tableDigests))return false;
 const tables=Object.entries(value.tableDigests);
 return tables.length>0&&tables.length<=KNOWN_TABLES.size&&tables.every(([name,table])=>KNOWN_TABLES.has(name)&&table&&hex(table.sha256)&&Number.isSafeInteger(table.recordCount)&&table.recordCount>=0&&table.recordCount<=100000&&Array.isArray(table.records)&&table.records.length<=2048&&table.records.length<=table.recordCount&&typeof table.recordsTruncated==='boolean'&&(table.recordsTruncated||table.records.length===table.recordCount)&&table.records.every(row=>row&&hex(row.keySha256)&&hex(row.sha256)));
}
const nullableBool=value=>value===null||typeof value==='boolean';
const nullableHex=value=>value===null||hex(value);
const safeLocation=relative=>typeof relative!=='string'?{path:null,pathSha256:null}:KNOWN_PATHS.has(relative)?{path:relative,pathSha256:null}:{path:null,pathSha256:hash(relative)};
function safeContext(value={}){
 return {stage:STAGES.has(value.stage)?value.stage:'worker',artifact:ARTIFACTS.has(value.artifact)?value.artifact:'worker',path:KNOWN_PATHS.has(value.path)?value.path:null,pathSha256:KNOWN_PATHS.has(value.path)?null:hex(value.pathSha256)?value.pathSha256:typeof value.path==='string'?hash(value.path):null};
}
/** Only codes, fixed artifact labels and public known paths leave the worker.
 * Native Error.message, .path, syscall arguments and database contents do not. */
export function safeRuntimeObservationFailure(error){
 const structured=error?.runtimeObservationFailure??error??{};
 const rawCode=FAILURE_CODES.has(structured.code)?structured.code:FAILURE_CODES.has(structured.message)?structured.message:null;
 const errno=ERRNOS.has(structured.errno)?structured.errno:ERRNOS.has(structured.code)?structured.code:null;
 return {code:rawCode??(errno?'REPAIR_RUNTIME_OBSERVATION_IO_FAILED':'REPAIR_RUNTIME_OBSERVATION_FAILED'),errno,...safeContext(error?.runtimeObservationContext??structured)};
}
function emptyRecord(source){return {source,exists:null,version:null,phase:null,digest:null,immutableDigest:null,sqliteSecurityDigests:{},digestMatchesComponents:null,digestMatchesTransactionSeal:null,details:{immutableEntries:'not-inspected',sqliteTables:'not-inspected',missingSourceArtifacts:[]}};}
function emptyBaseline(){return {transactionRecord:{exists:null,readable:null,sha256:null},selected:{kind:'sealed',source:SOURCES.sealed,available:false},approved:emptyRecord(SOURCES.approved),sealed:emptyRecord(SOURCES.sealed),completed:{source:SOURCES.completed,present:null,digest:null,sameAsSealed:null,independentPostReadinessRecord:false},rollback:emptyRecord(SOURCES.rollback),historicalComponentReconstruction:'not-inspected',historicalFailureComparisonRecorded:{primary:null,rollback:null}};}
function inventoryRecord(record,source,seal){
 const result=emptyRecord(source);result.exists=record!==undefined&&record!==null;
 if(!result.exists){result.details={immutableEntries:'missing',sqliteTables:'missing',missingSourceArtifacts:[source]};return result;}
 result.version=Number.isSafeInteger(record.version)&&record.version>=0&&record.version<=100?record.version:null;
 result.phase=['reviewed','sealed'].includes(record.contract?.phase)?record.contract.phase:null;
 result.digest=hex(record.digest)?record.digest:null;result.immutableDigest=hex(record.immutableDigest)?record.immutableDigest:null;
 for(const relative of RUNTIME_SQLITE_PATHS)if(hex(record.sqliteSecurityDigests?.[relative]))result.sqliteSecurityDigests[relative]=record.sqliteSecurityDigests[relative];
 result.digestMatchesComponents=Boolean(result.digest&&result.immutableDigest&&record.contract&&typeof record.sqliteSecurityDigests==='object'&&!Array.isArray(record.sqliteSecurityDigests)&&record.digest===hash(canonical({contract:record.contract,immutableDigest:record.immutableDigest,sqliteSecurityDigests:record.sqliteSecurityDigests})));
 result.digestMatchesTransactionSeal=seal===undefined?null:Boolean(hex(seal)&&result.digest===seal);
 const entries=record.diagnosticDetails?.immutableEntries;
 const validEntries=Array.isArray(entries)&&entries.length<=100000&&entries.every(entry=>Array.isArray(entry)&&typeof entry[0]==='string'&&entry[0].length>0&&entry[0].length<=4096&&!path.isAbsolute(entry[0])&&!entry[0].split('/').some(part=>!part||part==='.'||part==='..')&&(entry.length===2&&entry[1]==='directory'||entry.length===4&&entry[1]==='file'&&typeof entry[2]==='boolean'&&hex(entry[3])))&&new Set(entries.map(entry=>entry[0])).size===entries.length&&hash(canonical([...entries].sort((a,b)=>a[0].localeCompare(b[0]))))===result.immutableDigest;
 result.details.immutableEntries=entries===undefined?'missing':validEntries?'available':'invalid';
 if(entries===undefined)result.details.missingSourceArtifacts.push(source+'/diagnosticDetails/immutableEntries');
 const sqlite=record.diagnosticDetails?.sqlite;
 if(sqlite===undefined){result.details.sqliteTables='missing';result.details.missingSourceArtifacts.push(source+'/diagnosticDetails/sqlite');}
 else{
  const missing=Object.keys(result.sqliteSecurityDigests).filter(relative=>!sqlite?.[relative]?.tableDigests);
  result.details.sqliteTables=!sqlite||typeof sqlite!=='object'||Array.isArray(sqlite)?'invalid':missing.length?'missing':Object.entries(result.sqliteSecurityDigests).every(([relative,digest])=>validSQLiteDetails(sqlite[relative],digest))?'advisory-present':'invalid';
  for(const relative of missing)result.details.missingSourceArtifacts.push(source+'/diagnosticDetails/sqlite/'+relative.replaceAll('~','~0').replaceAll('/','~1')+'/tableDigests');
 }
 return result;
}
function inventoryBaseline(state,baseline){
 baseline.approved=inventoryRecord(state?.approvedSecurityRecord,SOURCES.approved);
 baseline.sealed=inventoryRecord(state?.runtimeSecurityRecord,SOURCES.sealed,state?.sealedSecurityIdentity);
 baseline.rollback=inventoryRecord(state?.rollbackPlan?.restoredSecurity,SOURCES.rollback);
 baseline.completed={source:SOURCES.completed,present:state?.completedIdentity!==undefined&&state?.completedIdentity!==null,digest:hex(state?.completedIdentity)?state.completedIdentity:null,sameAsSealed:hex(state?.completedIdentity)?state.completedIdentity===state?.sealedSecurityIdentity:null,independentPostReadinessRecord:false};
 baseline.selected.available=baseline.sealed.exists===true;
 baseline.historicalComponentReconstruction=baseline.sealed.digestMatchesComponents===true&&baseline.sealed.details.immutableEntries==='available'&&baseline.sealed.details.sqliteTables==='advisory-present'?'immutable-bound-sqlite-advisory':'unavailable';
 baseline.historicalFailureComparisonRecorded={primary:Boolean(safeRuntimeIdentityDiagnostic(state?.primaryRuntimeIdentityDiagnostic)),rollback:Boolean(safeRuntimeIdentityDiagnostic(state?.rollbackRuntimeIdentityDiagnostic))};
}
function safeBaseline(value){
 if(!exact(value,['transactionRecord','selected','approved','sealed','completed','rollback','historicalComponentReconstruction','historicalFailureComparisonRecorded']))return null;
 const tx=value.transactionRecord,selected=value.selected,completed=value.completed,historical=value.historicalFailureComparisonRecorded;
 if(!exact(tx,['exists','readable','sha256'])||!nullableBool(tx.exists)||!nullableBool(tx.readable)||!nullableHex(tx.sha256)||!exact(selected,['kind','source','available'])||selected.kind!=='sealed'||selected.source!==SOURCES.sealed||typeof selected.available!=='boolean')return null;
 for(const kind of ['approved','sealed','rollback']){
  const item=value[kind];if(!exact(item,['source','exists','version','phase','digest','immutableDigest','sqliteSecurityDigests','digestMatchesComponents','digestMatchesTransactionSeal','details'])||item.source!==SOURCES[kind]||!nullableBool(item.exists)||!(item.version===null||Number.isSafeInteger(item.version)&&item.version>=0&&item.version<=100)||![null,'reviewed','sealed'].includes(item.phase)||!nullableHex(item.digest)||!nullableHex(item.immutableDigest)||!nullableBool(item.digestMatchesComponents)||!nullableBool(item.digestMatchesTransactionSeal)||!item.sqliteSecurityDigests||typeof item.sqliteSecurityDigests!=='object'||Array.isArray(item.sqliteSecurityDigests)||Object.entries(item.sqliteSecurityDigests).some(([relative,digest])=>!RUNTIME_SQLITE_PATHS.includes(relative)||!hex(digest)))return null;
  const detail=item.details;if(!exact(detail,['immutableEntries','sqliteTables','missingSourceArtifacts'])||!DETAIL_STATES.has(detail.immutableEntries)||!DETAIL_STATES.has(detail.sqliteTables)||!Array.isArray(detail.missingSourceArtifacts)||detail.missingSourceArtifacts.length>8||detail.missingSourceArtifacts.some(pointer=>!MISSING_POINTERS.has(pointer)||!pointer.startsWith(item.source)))return null;
 }
 if(!exact(completed,['source','present','digest','sameAsSealed','independentPostReadinessRecord'])||completed.source!==SOURCES.completed||!nullableBool(completed.present)||!nullableHex(completed.digest)||!nullableBool(completed.sameAsSealed)||completed.independentPostReadinessRecord!==false||!['not-inspected','unavailable','immutable-bound-sqlite-advisory'].includes(value.historicalComponentReconstruction)||!exact(historical,['primary','rollback'])||!nullableBool(historical.primary)||!nullableBool(historical.rollback))return null;
 return JSON.parse(JSON.stringify(value));
}
function validContext(value){return STAGES.has(value.stage)&&ARTIFACTS.has(value.artifact)&&(value.path===null||KNOWN_PATHS.has(value.path))&&nullableHex(value.pathSha256)&&!(value.path!==null&&value.pathSha256!==null);}
function safeV2Observation(value){
 const top=['schema','status','observedAt','transaction','source','timing','historicalCauseEstablished','rollbackAuthorized','diagnostic','baseline','progress','failure'];
 if(!exact(value,Object.hasOwn(value??{},'localization')?[...top,'localization']:top)||value.schema!==SCHEMA||!['OBSERVED','BLOCKED'].includes(value.status)||value.timing!==PHASE||value.historicalCauseEstablished!==false||value.rollbackAuthorized!==false||typeof value.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.observedAt))return null;
 const tx=value.transaction,source=value.source,progress=value.progress,failure=value.failure;
 if(tx!==null&&(!exact(tx,['id','state','recordSha256','primaryFailureCode','rollbackFailureCode'])||!uuid(tx.id)||tx.state!=='safe-stop-required'||!hex(tx.recordSha256)||!code(tx.primaryFailureCode)||!code(tx.rollbackFailureCode)))return null;
 if(!exact(source,['stable','copiedFiles','copiedBytes','sourceSQLiteOpened','sourceWritten'])||!nullableBool(source.stable)||source.sourceSQLiteOpened!==false||source.sourceWritten!==false||!Number.isSafeInteger(source.copiedFiles)||source.copiedFiles<0||source.copiedFiles>LIMITS.entries||!Number.isSafeInteger(source.copiedBytes)||source.copiedBytes<0||source.copiedBytes>LIMITS.bytes)return null;
 if(!exact(progress,['stage','artifact','path','pathSha256','elapsedMs','limits'])||!validContext(progress)||!Number.isSafeInteger(progress.elapsedMs)||progress.elapsedMs<0||progress.elapsedMs>86400000||!exact(progress.limits,Object.keys(LIMITS))||Object.keys(LIMITS).some(key=>progress.limits[key]!==LIMITS[key]))return null;
 const baseline=safeBaseline(value.baseline);if(!baseline)return null;
 if(failure!==null&&(!exact(failure,['code','errno','stage','artifact','path','pathSha256'])||!FAILURE_CODES.has(failure.code)||!(failure.errno===null||ERRNOS.has(failure.errno))||!validContext(failure)))return null;
 const diagnostic=value.diagnostic===null?null:safeRuntimeIdentityDiagnostic(value.diagnostic);if(value.diagnostic!==null&&(!diagnostic||diagnostic.phase!==PHASE))return null;
 if(value.status==='OBSERVED'&&(!tx||!diagnostic||source.stable!==true||failure!==null||progress.stage!=='complete'))return null;
 if(value.status==='BLOCKED'&&!failure)return null;
 const localization=Object.hasOwn(value,'localization')?safeRuntimeLocalization(value.localization):undefined;if(Object.hasOwn(value,'localization')&&!localization)return null;if(localization&&(source.copiedFiles+localization.previous.copiedFiles>LIMITS.entries||source.copiedBytes+localization.previous.copiedBytes>LIMITS.bytes))return null;
 return {schema:SCHEMA,status:value.status,observedAt:value.observedAt,transaction:tx?{...tx}:null,source:{...source},timing:PHASE,historicalCauseEstablished:false,rollbackAuthorized:false,diagnostic,baseline,progress:{...progress,limits:{...LIMITS}},failure:failure?{...failure}:null,...(localization?{localization}:{})};
}
function safeRuntimeLocalization(value){
 if(!exact(value,['schema','previous','immutable','state','failure'])||value.schema!=='agi-runtime-localization/v1')return null;
 const previous=value.previous;if(!exact(previous,['source','status','stable','copiedFiles','copiedBytes','sourceSQLiteOpened','sourceWritten','failure'])||previous.source!=='transaction/previous'||!['MISSING','COPIED','BLOCKED','NOT_INSPECTED'].includes(previous.status)||!nullableBool(previous.stable)||previous.sourceSQLiteOpened!==false||previous.sourceWritten!==false||!Number.isSafeInteger(previous.copiedFiles)||previous.copiedFiles<0||previous.copiedFiles>LIMITS.entries||!Number.isSafeInteger(previous.copiedBytes)||previous.copiedBytes<0||previous.copiedBytes>LIMITS.bytes)return null;
 const failureValid=item=>item===null||exact(item,['code','errno','stage','artifact','path','pathSha256'])&&FAILURE_CODES.has(item.code)&&(item.errno===null||ERRNOS.has(item.errno))&&validContext(item);
 if(!failureValid(previous.failure)||!failureValid(value.failure)||previous.status==='COPIED'&&(previous.stable!==true||previous.failure!==null)||previous.status==='BLOCKED'&&!previous.failure)return null;
 if(previous.status==='NOT_INSPECTED'&&(previous.failure!==null||previous.stable!==null||previous.copiedFiles!==0||previous.copiedBytes!==0)||previous.status==='MISSING'&&(!previous.failure||previous.failure.errno!=='ENOENT'||previous.failure.stage!=='previous-profile-boundaries'||previous.stable!==null||previous.copiedFiles!==0||previous.copiedBytes!==0))return null;
 const immutable=value.immutable===null?null:safeImmutableLocalization(value.immutable),state=value.state===null?null:safeRuntimeStateLocalization(value.state);
 if(value.immutable!==null&&!immutable||value.state!==null&&!state)return null;
 const previousAvailable=previous.status==='COPIED';if(state&&state.baseline.available!==previousAvailable||immutable&&!previousAvailable&&(immutable.reason==='bounded-reconstruction-matches-seal'||immutable.candidatePaths.some(item=>item.previousArtifactPresence!=='unavailable')))return null;
 return {schema:value.schema,previous:{...previous,failure:previous.failure?{...previous.failure}:null},immutable,state,failure:value.failure?{...value.failure}:null};
}
export function safeTransactionRuntimeObservation(value){return value?.schema===LEGACY_SCHEMA?safeLegacyTransactionRuntimeObservation(value):safeV2Observation(value);}

/** Diagnostic collection only. The caller separately proves services/ports are
 * stopped. SQLite opens disposable byte copies, never an installed database.
 * No transaction recovery, checkpoint, approval or source mutation is performed.
 */
export function observeTransactionRuntimeIdentity({home,role,profileDir,temporaryRoot}){
 const started=Date.now(),baseline=emptyBaseline();
 const result={schema:SCHEMA,status:'BLOCKED',observedAt:new Date().toISOString(),transaction:null,source:{stable:null,copiedFiles:0,copiedBytes:0,sourceSQLiteOpened:false,sourceWritten:false},timing:PHASE,historicalCauseEstablished:false,rollbackAuthorized:false,diagnostic:null,baseline,progress:{stage:'input-validation',artifact:'input',path:null,pathSha256:null,elapsedMs:0,limits:{...LIMITS}},failure:null};
 let temporary,ownsTemporary=temporaryRoot===undefined;
 const mark=(stage,artifact,relative)=>{Object.assign(result.progress,{stage,artifact,...safeLocation(relative),elapsedMs:Math.min(86400000,Math.max(0,Date.now()-started))});};
 const blocked=error=>{if(error?.message==='SETUP_PROFILE_CHANGED'&&!['disposable-profile','disposable-previous'].includes(result.progress.artifact))result.source.stable=false;result.status='BLOCKED';result.progress.elapsedMs=Math.min(86400000,Math.max(0,Date.now()-started));error.runtimeObservationContext={...result.progress};result.failure=safeRuntimeObservationFailure(error);error.runtimeObservationEvidence=safeV2Observation(result);return error;};
 try{
  need(COMPUTE_ROLES.includes(role)&&typeof home==='string'&&path.isAbsolute(home)&&path.resolve(home)===home&&typeof profileDir==='string','REPAIR_RUNTIME_OBSERVATION_PATH');
  need(profileDir===path.join(home,'.openclaw-'+roleContract(role).profile),'REPAIR_RUNTIME_OBSERVATION_PATH');
  mark('home-validation','home');owned(home,{directory:true});need(fs.realpathSync(home)===home,'SETUP_STATE_OWNER_REQUIRED');
  const support=path.join(home,'.agi-genesis-setup-'+role),directory=path.join(support,'transaction'),file=path.join(directory,'transaction.json'),boundaries=[];
  for(const [name,artifact,relative] of [[support,'setup-directory',undefined],[directory,'transaction-directory','transaction']]){mark('transaction-boundaries',artifact,relative);const stat=owned(name,{directory:true,privateMode:true});need(fs.realpathSync(name)===name,'SETUP_STATE_OWNER_REQUIRED');boundaries.push({file:name,stat});}
  mark('transaction-read','transaction-record','transaction/transaction.json');
  let transactionStat;try{fs.lstatSync(file);baseline.transactionRecord.exists=true;transactionStat=owned(file,{privateMode:true});}catch(error){if(error.code==='ENOENT')baseline.transactionRecord.exists=false;baseline.transactionRecord.readable=false;throw error;}
  let transactionBytes;try{transactionBytes=readFile(file,transactionStat,LIMITS.transactionBytes);baseline.transactionRecord.readable=true;baseline.transactionRecord.sha256=hash(transactionBytes);}catch(error){baseline.transactionRecord.readable=false;throw error;}
  mark('transaction-parse','transaction-record','transaction/transaction.json');
  let raw;try{raw=JSON.parse(transactionBytes);}catch{throw Error('REPAIR_RUNTIME_TRANSACTION_INVALID');}inventoryBaseline(raw,baseline);
  mark('baseline-validation','sealed-security-record','transaction/transaction.json');const state=parseRecord(transactionBytes,{profileDir,candidate:path.join(directory,'candidate')});
  result.transaction={id:state.id,state:state.state,recordSha256:hash(transactionBytes),primaryFailureCode:state.primaryFailureCode??null,rollbackFailureCode:state.rollbackFailureCode??null};
  mark('profile-boundaries','live-profile');const profileStat=owned(profileDir,{directory:true,privateMode:true});need(fs.realpathSync(profileDir)===profileDir,'SETUP_STATE_OWNER_REQUIRED');boundaries.push({file:profileDir,stat:profileStat});
  mark('temporary-root-validation','temporary-root');
  const temporaryBase=fs.realpathSync(os.tmpdir());need(!inside(profileDir,temporaryBase)&&!inside(support,temporaryBase),'REPAIR_RUNTIME_OBSERVATION_PATH');
  if(ownsTemporary){temporary=fs.realpathSync(fs.mkdtempSync(path.join(temporaryBase,'agi-runtime-observation-')));fs.chmodSync(temporary,0o700);}
  else{
   need(typeof temporaryRoot==='string'&&path.isAbsolute(temporaryRoot)&&path.resolve(temporaryRoot)===temporaryRoot&&path.dirname(temporaryRoot)===temporaryBase&&!inside(profileDir,temporaryRoot)&&!inside(support,temporaryRoot)&&/^agi-runtime-observation-[A-Za-z0-9_-]{6,64}$/.test(path.basename(temporaryRoot)),'REPAIR_RUNTIME_OBSERVATION_PATH');
   owned(temporaryRoot,{directory:true,privateMode:true});need(fs.realpathSync(temporaryRoot)===temporaryRoot&&fs.readdirSync(temporaryRoot).length===0,'REPAIR_RUNTIME_OBSERVATION_PATH');temporary=temporaryRoot;
  }
  const copied=path.join(temporary,'profile');let entries=0,bytes=0;const observed=[];
  const currentGroup={root:profileDir,observed,source:result.source,stage:'copy-profile',artifact:'live-profile',targetArtifact:'disposable-profile'};
  const add=(group,file,stat,extra={})=>{need(++entries<=LIMITS.entries,'REPAIR_RUNTIME_OBSERVATION_LIMIT');group.observed.push({file,stat,...extra});};
  const walk=(source,target,relative='',depth=0,group=currentGroup)=>{
   mark(group.stage,group.artifact,relative||undefined);need(depth<=LIMITS.depth,'REPAIR_RUNTIME_OBSERVATION_LIMIT');const stat=owned(source,{directory:true});need(fs.realpathSync(source)===source,'SETUP_STATE_OWNER_REQUIRED');
   const names=fs.readdirSync(source).sort();add(group,source,stat,{names});mark(group.stage,group.targetArtifact,relative||undefined);fs.mkdirSync(target,{mode:0o700});
   for(const name of names){
    const sourceFile=path.join(source,name),targetFile=path.join(target,name),rel=relative?relative+'/'+name:name;mark(group.stage,group.artifact,rel);const item=owned(sourceFile);
    if(rel==='plugin-skills'){need(item.isDirectory(),'SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED');add(group,sourceFile,item);mark(group.stage,group.targetArtifact,rel);fs.mkdirSync(targetFile,{mode:0o700});continue;}
    if(RUNTIME_SQLITE_PATHS.some(base=>rel===base+'-shm')){
     regular(item);const base=sourceFile.slice(0,-4),baseStat=owned(base);regular(baseStat);const fd=fs.openSync(base,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
     try{same(baseStat,fs.fstatSync(fd,{bigint:true}));const header=Buffer.alloc(16);need(fs.readSync(fd,header,0,16,0)===16&&header.equals(Buffer.from('SQLite format 3\0')),'SETUP_STATE_FILE_UNSUPPORTED');same(baseStat,owned(base));}finally{fs.closeSync(fd);}add(group,sourceFile,item);continue;
    }
    if(item.isDirectory()){walk(sourceFile,targetFile,rel,depth+1,group);continue;}
    regular(item);need(bytes+Number(item.size)<=LIMITS.bytes,'REPAIR_RUNTIME_OBSERVATION_LIMIT');add(group,sourceFile,item);const content=readFile(sourceFile,item,LIMITS.fileBytes);
    mark(group.stage,group.targetArtifact,rel);fs.writeFileSync(targetFile,content,{flag:'wx',mode:Number(item.mode&0o777n)});bytes+=content.length;group.source.copiedFiles++;group.source.copiedBytes+=content.length;
   }
  };
  const revalidateGroup=(group,stage)=>{for(const item of group.observed){mark(stage,group.artifact,path.relative(group.root,item.file).split(path.sep).join('/')||undefined);same(item.stat,owned(item.file));if(item.names)need(JSON.stringify(fs.readdirSync(item.file).sort())===JSON.stringify(item.names),'SETUP_PROFILE_CHANGED');}};
  const revalidate=stage=>{
   for(const item of boundaries){mark(stage,item.file===profileDir?'live-profile':item.file===directory?'transaction-directory':'setup-directory',item.file===directory?'transaction':undefined);same(item.stat,owned(item.file,{directory:true,privateMode:true}));}
   revalidateGroup(currentGroup,stage);
   mark(stage,'transaction-record','transaction/transaction.json');same(transactionStat,owned(file,{privateMode:true}));need(readFile(file,transactionStat,LIMITS.transactionBytes).equals(transactionBytes),'SETUP_PROFILE_CHANGED');
  };
  walk(profileDir,copied);revalidate('source-revalidation-before-comparison');
  mark('identity-comparison','disposable-profile');result.diagnostic=safeRuntimeIdentityDiagnostic(inspectRuntimeSecurityIdentity(copied,state.runtimeSecurityRecord,{phase:PHASE}));need(result.diagnostic,'REPAIR_RUNTIME_OBSERVATION_INVALID');
  const localization={schema:'agi-runtime-localization/v1',previous:{source:'transaction/previous',status:'NOT_INSPECTED',stable:null,copiedFiles:0,copiedBytes:0,sourceSQLiteOpened:false,sourceWritten:false,failure:null},immutable:null,state:null,failure:null};
  result.localization=localization;
  if(result.diagnostic.captureComplete){
   mark('localization','disposable-profile');let current;try{current=captureRuntimeSecurityComponents(copied,state.runtimeSecurityRecord.contract);}catch(error){localization.failure=safeRuntimeObservationFailure({...safeRuntimeObservationFailure(error),...result.progress});}
   if(current){
   need(current.identity.digest===result.diagnostic.actual.digest,'SETUP_PROFILE_CHANGED');
   const previousRoot=path.join(directory,'previous'),previousCopy=path.join(temporary,'previous'),previousGroup={root:previousRoot,observed:[],source:localization.previous,stage:'copy-previous',artifact:'previous-profile',targetArtifact:'disposable-previous'};
   let previousAvailable=false,previousEntries=null;
   const previousBlocked=error=>{localization.previous.status=error?.code==='ENOENT'&&result.progress.stage==='previous-profile-boundaries'?'MISSING':'BLOCKED';localization.previous.stable=error?.message==='SETUP_PROFILE_CHANGED'?false:null;localization.previous.failure=safeRuntimeObservationFailure({...safeRuntimeObservationFailure(error),...result.progress});previousAvailable=false;previousEntries=null;};
   try{
    mark('previous-profile-boundaries','previous-profile','transaction/previous');owned(previousRoot,{directory:true,privateMode:true});need(fs.realpathSync(previousRoot)===previousRoot,'SETUP_STATE_OWNER_REQUIRED');
    walk(previousRoot,previousCopy,'',0,previousGroup);revalidateGroup(previousGroup,'source-revalidation-before-comparison');
    mark('localization','disposable-previous');previousEntries=captureRuntimeImmutableComponents(previousCopy).immutableEntries;
    revalidateGroup(previousGroup,'source-revalidation-after-comparison');localization.previous.status='COPIED';localization.previous.stable=true;previousAvailable=true;
   }catch(error){previousBlocked(error);}
   const localize=()=>{
    mark('localization','disposable-profile');localization.immutable=safeImmutableLocalization(localizeImmutableBaseline({currentEntries:current.components.immutableEntries,expectedDigest:state.runtimeSecurityRecord.immutableDigest,previousEntries}));
    localization.state=safeRuntimeStateLocalization(localizeRuntimeState({currentRoot:copied,previousRoot:previousAvailable?previousCopy:null,sealedRecord:state.runtimeSecurityRecord,expectedCurrentSha256:result.diagnostic.actual.sqliteSecurityDigests['state/openclaw.sqlite']}));
    need(localization.immutable&&localization.state,'REPAIR_RUNTIME_OBSERVATION_INVALID');
   };
   try{
    localize();if(previousAvailable)try{revalidateGroup(previousGroup,'source-revalidation-after-comparison');}catch(error){previousBlocked(error);localize();}
   }catch(error){localization.failure=safeRuntimeObservationFailure({...safeRuntimeObservationFailure(error),...result.progress});localization.immutable=null;localization.state=null;}
   }
  }else localization.failure=safeRuntimeObservationFailure({code:result.diagnostic.captureFailureCode,stage:'localization',artifact:'disposable-profile'});
  revalidate('source-revalidation-after-comparison');result.source.stable=true;
  if(ownsTemporary){mark('cleanup','temporary-root');fs.rmSync(temporary,{recursive:true,force:true});temporary=undefined;}
  mark('complete','disposable-profile');result.status='OBSERVED';return safeV2Observation(result);
 }catch(error){throw blocked(error);}
 finally{if(ownsTemporary&&temporary){try{fs.rmSync(temporary,{recursive:true,force:true});}catch{ /* The primary staged failure remains authoritative; no source is mutated. */ }}}
}
