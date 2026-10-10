import {ALL_OAUTH_ROLES} from './roles.mjs';
import {captureStandardAuthority,assertStandardAuthority} from './setup-standard-authority.mjs';
import {assertManagedServiceTransition} from './setup-managed-service.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isSQLiteFile, SQLiteSnapshots} from './setup-sqlite.mjs';
import {captureRuntimeSecurityComponents,captureRuntimeSecurityIdentity, assertRuntimeSecurityIdentity, carryForwardRuntimeState, safeRuntimeIdentityDiagnostic} from './setup-runtime-identity.mjs';
import {persistComponentEvidence,readComponentEvidence,validateComponentReference} from './setup-component-evidence.mjs';
import {isCleanInitializationReceipt} from './setup-clean-initialization.mjs';
import {safeSetupFailure} from './setup-auth.mjs';
import {isCandidateStatePreparationReceipt} from './setup-state-preparation.mjs';
import {atomicWrite, privateDir, canonical, sha256} from '../src/util.mjs';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>atomicWrite(file,JSON.stringify(value,null,2));
const exists=file=>fs.existsSync(file);
// Staging protocol and tree identity are independent. Protocol 2 stages auth
// ordering without the legacy guarded config write. Preserve older prepared
// candidates before running that protocol; their v3 SQLite digests stay v3.
export const SETUP_STAGING_PROTOCOL_VERSION=2;
export const SETUP_RUNTIME_SECURITY_VERSION=1;
export const SETUP_PREPARATION_PROTOCOL_VERSION=1;
const approvalIntentName='approval-write-intent.json';
const approvalEvidenceName='approval-evidence/transaction-after-write-failure.json';
function approvalIntentPresent(directory){return Boolean(fs.lstatSync(path.join(directory,approvalIntentName),{throwIfNoEntry:false}));}
const runtimeIdentityKind='runtime-security/v1';
const recoveryStopMessage='Setup could not verify service shutdown. Preserve this profile and use the repair workflow.\n';
function syncDirectory(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function syncTree(directory){for(const name of fs.readdirSync(directory)){const file=path.join(directory,name),stat=owned(file);if(stat.isDirectory())syncTree(file);else{need(stat.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}syncDirectory(directory);}
function durableRename(source,target){fs.renameSync(source,target);syncDirectory(path.dirname(source));if(path.dirname(source)!==path.dirname(target))syncDirectory(path.dirname(target));}
function writeRecoveryStop(profileDir){
  const file=path.join(profileDir,'COMPUTE_STOP'),temporary=path.join(profileDir,'.agi-setup-stop-'+crypto.randomUUID()+'.tmp');
  if(fs.lstatSync(file,{throwIfNoEntry:false}))need(owned(file).isFile(),'SETUP_STATE_FILE_UNSUPPORTED');
  const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600),identity=fs.fstatSync(fd);
  try{fs.writeFileSync(fd,recoveryStopMessage);fs.fsyncSync(fd);}catch(error){fs.closeSync(fd);const current=fs.lstatSync(temporary,{throwIfNoEntry:false});if(current?.dev===identity.dev&&current?.ino===identity.ino)fs.unlinkSync(temporary);throw error;}
  fs.closeSync(fd);
  try{durableRename(temporary,file);}catch(error){const current=fs.lstatSync(temporary,{throwIfNoEntry:false});if(current?.dev===identity.dev&&current?.ino===identity.ino)fs.unlinkSync(temporary);throw error;}
}
function validateRuntimeContract(state){
  if(state.assuranceMode==='standard'){
    need(state.installationTrack==='standard-install'&&state.previousExisted===false&&state.baseIdentity===null&&state.runtimeSecurityVersion===undefined&&state.componentEvidenceVersion===undefined&&state.stagingProtocolVersion===2&&state.treeIdentityVersion===3,'SETUP_CLEAN_INSTALL_REQUIRED');
    for(const value of [state.standardReviewedAuthority,state.standardSealedAuthority].filter(Boolean))need(value.schema==='agi-standard-authority/v1'&&/^[a-f0-9]{64}$/.test(value.digest),'SETUP_PROFILE_CHANGED');
    if(['approved','publishing','published','sealed','complete'].includes(state.state))need(state.standardReviewedAuthority&&typeof state.approval==='string','SETUP_REVIEW_REQUIRED');
    if(['sealed','complete'].includes(state.state))need(state.standardSealedAuthority,'SETUP_REVIEW_REQUIRED');
    return;
  }
  if(state.installationTrack!==undefined){
    need(['clean-install','clean-maintenance'].includes(state.installationTrack)&&state.componentEvidenceVersion===1,'SETUP_CLEAN_INSTALL_REQUIRED');
    if(state.installationTrack==='clean-install')need(state.previousExisted===false&&state.baseIdentity===null&&state.sourceCleanRuntime===undefined&&state.cleanRuntimeGeneration===0,'SETUP_CLEAN_INSTALL_REQUIRED');
    else need(state.previousExisted===true&&(state.state==='preparing'&&state.baseIdentity===null||/^[a-f0-9]{64}$/.test(state.baseIdentity??''))&&validCleanRuntimeSource(state.sourceCleanRuntime)&&state.cleanRuntimeGeneration===state.sourceCleanRuntime.generation+1,'SETUP_CLEAN_RUNTIME_SOURCE_REQUIRED');
    for(const record of [state.approvedSecurityRecord,state.runtimeSecurityRecord].filter(Boolean))need(record.contract?.cleanInstallVersion===1,'SETUP_RUNTIME_SECURITY_VERSION');
    const evidence=state.componentEvidence;need(evidence&&Array.isArray(evidence.observations)&&evidence.observations.length<=32,'SETUP_COMPONENT_EVIDENCE_INVALID');
    if(evidence.reviewed)validateComponentReference(evidence.reviewed,{transactionId:state.id,phase:'reviewed-before-approval',identityDigest:state.approvedSecurityRecord?.digest});
    if(evidence.sealed)validateComponentReference(evidence.sealed,{transactionId:state.id,phase:'sealed-before-readiness',identityDigest:state.sealedSecurityIdentity});
    for(const ref of evidence.observations)validateComponentReference(ref,{transactionId:state.id});
    if(['approved','publishing','published','sealed','complete'].includes(state.state))need(evidence.reviewed,'SETUP_COMPONENT_EVIDENCE_INVALID');
    if(['sealed','complete'].includes(state.state))need(evidence.sealed,'SETUP_COMPONENT_EVIDENCE_INVALID');
  }else need(state.componentEvidenceVersion===undefined&&state.componentEvidence===undefined,'SETUP_COMPONENT_EVIDENCE_INVALID');
  need(state.preparationProtocolVersion===undefined||state.preparationProtocolVersion===SETUP_PREPARATION_PROTOCOL_VERSION,'SETUP_PREPARATION_PROTOCOL_VERSION');
  need(state.runtimeSecurityVersion===undefined||state.runtimeSecurityVersion===SETUP_RUNTIME_SECURITY_VERSION,'SETUP_RUNTIME_SECURITY_VERSION');
  if(state.runtimeSecurityVersion===undefined){need(state.runtimeSecurityRecord===undefined&&state.approvedSecurityRecord===undefined&&state.sealedSecurityIdentity===undefined&&state.completedIdentityKind===undefined&&state.rollbackPlan===undefined&&state.freshRollbackPlan===undefined,'SETUP_RUNTIME_SECURITY_VERSION');return;}
  need(state.treeIdentityVersion===3&&state.stagingProtocolVersion===SETUP_STAGING_PROTOCOL_VERSION,'SETUP_RUNTIME_SECURITY_VERSION');
  if(state.approvedSecurityRecord)need(state.approvedSecurityRecord.version===1&&state.approvedSecurityRecord.contract?.version===1&&state.approvedSecurityRecord.contract.profileDir===state.profileDir&&state.approvedSecurityRecord.contract.phase==='reviewed','SETUP_RUNTIME_SECURITY_VERSION');
  need(state.completedIdentityKind===undefined||state.completedIdentityKind===runtimeIdentityKind,'SETUP_RUNTIME_SECURITY_VERSION');
  if(state.completedIdentity)need(state.completedIdentityKind===runtimeIdentityKind&&state.completedIdentity===state.sealedSecurityIdentity,'SETUP_RUNTIME_SECURITY_VERSION');
  if(['sealed','complete'].includes(state.state))need(state.runtimeSecurityRecord&&state.approvedSecurityRecord,'SETUP_RUNTIME_SECURITY_VERSION');
  if(state.state==='complete')need(/^[a-f0-9]{64}$/.test(state.completedIdentity??'')&&state.completedIdentityKind===runtimeIdentityKind,'SETUP_RUNTIME_SECURITY_VERSION');
  if(state.rollbackPlan||state.freshRollbackPlan)need(state.runtimeSecurityRecord&&!(state.rollbackPlan&&state.freshRollbackPlan)&&Boolean(state.previousExisted)===Boolean(state.rollbackPlan),'SETUP_RUNTIME_SECURITY_VERSION');
  if(state.managedServiceInstallation){
    const value=state.managedServiceInstallation;
    need(value.schema==='agi-managed-service-installation/v1'&&value.authority?.schema==='agi-managed-gateway-authority/v1'&&/^[a-f0-9]{64}$/.test(value.authority.digest??''),'SETUP_MANAGED_SERVICE_AUTHORITY_CHANGED');
    validateComponentReference(value.before,{transactionId:state.id,phase:'before-managed-service-install'});validateComponentReference(value.after,{transactionId:state.id,phase:'after-managed-service-install'});
  }
  if(state.runtimeSecurityRecord){
    const record=state.runtimeSecurityRecord;need(record.version===1&&record.contract?.version===1&&record.contract.profileDir===state.profileDir&&record.contract.phase==='sealed'&&/^[a-f0-9]{64}$/.test(record.digest)&&record.digest===state.sealedSecurityIdentity&&canonical(record.contract.authStaging)===canonical(state.authStaging??[]),'SETUP_RUNTIME_SECURITY_VERSION');
  }else need(state.sealedSecurityIdentity===undefined,'SETUP_RUNTIME_SECURITY_VERSION');
}
function owned(file){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&(!process.getuid||s.uid===process.getuid()),'SETUP_STATE_OWNER_REQUIRED');return s;}
function profileRoot(root){const s=fs.lstatSync(root,{throwIfNoEntry:false});if(!s)return false;need(owned(root).isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');return true;}
function generatedRuntimeEntry(root,dir,name,s){
  if(dir!==root||name!=='plugin-skills')return false;
  // OpenClaw owns this generated runtime directory. Never follow its entries,
  // copy its links into a candidate, or accept a redirected/non-directory root.
  need(s.isDirectory(),'SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED');return true;
}
function sqliteSidecar(file,s){
  if(!/-(wal|shm)$/.test(file))return false;
  const base=file.replace(/-(wal|shm)$/, '');if(!exists(base))return false;
  need(s.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');
  need(owned(base).isFile(),'SETUP_STATE_FILE_UNSUPPORTED');return isSQLiteFile(base);
}
function profileIdentity(root,{ignoreStop=false,version=3,snapshots}={}){
  need([1,2,3].includes(version),'SETUP_TREE_IDENTITY_VERSION');
  const h=crypto.createHash('sha256');if(!profileRoot(root))return null;
  const ownSnapshots=version===3&&!snapshots;if(ownSnapshots)snapshots=new SQLiteSnapshots();
  if(version===3)h.update('agi-profile-sqlite-snapshot/v3\0');
  const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){
    const file=path.join(dir,name),s=owned(file);
    if(version>=2&&generatedRuntimeEntry(root,dir,name,s))continue;
    const ignored=(ignoreStop&&dir===root&&name==='COMPUTE_STOP')||(version<3&&name.endsWith('-shm')&&exists(path.join(dir,name.slice(0,-4))));
    if(ignored){need(s.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');continue;}
    if(version===3&&sqliteSidecar(file,s))continue;
    h.update(path.relative(root,file));h.update('\0');
    if(s.isDirectory())visit(file);else{
      need(s.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');
      h.update(version===3&&isSQLiteFile(file)?snapshots.capture(file):fs.readFileSync(file));
    }h.update('\0');
  }};
  try{visit(root);if(ownSnapshots)snapshots.assertStable();return h.digest('hex');}finally{if(ownSnapshots)snapshots.close();}
}
export function treeIdentity(root,{ignoreStop=false}={}){return profileIdentity(root,{ignoreStop});}
async function copyProfile(source,target,snapshots){
  const sourcePresent=profileRoot(source);privateDir(target);if(!sourcePresent)return;
  const copy=async(dir,out)=>{for(const name of fs.readdirSync(dir).sort()){
    const file=path.join(dir,name),dest=path.join(out,name),s=owned(file);
    if(generatedRuntimeEntry(source,dir,name,s))continue;
    if(sqliteSidecar(file,s))continue;
    if(s.isDirectory()){privateDir(dest);await copy(file,dest);continue;}
    need(s.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');
    if(isSQLiteFile(file))fs.writeFileSync(dest,snapshots.initial(file),{flag:'wx',mode:0o600});
    else{fs.copyFileSync(file,dest,fs.constants.COPYFILE_EXCL);fs.chmodSync(dest,s.mode&0o100?0o700:0o600);}
  }};
  await copy(source,target);
}
async function checkedSnapshot(source,target,snapshots,baseIdentity){
  await copyProfile(source,target,snapshots);
  snapshots.assertStable();
  need(profileIdentity(source,{snapshots})===baseIdentity,'SETUP_PROFILE_CHANGED');
  snapshots.assertStable();
  if(baseIdentity!==null)need(treeIdentity(target)===baseIdentity,'SETUP_SNAPSHOT_MISMATCH');
  snapshots.assertStable();
}
export async function snapshotProfile(source,target){
  const snapshots=new SQLiteSnapshots();
  try{const baseIdentity=profileIdentity(source,{snapshots});await checkedSnapshot(source,target,snapshots,baseIdentity);}
  finally{snapshots.close();}
}
function leafChanges(a,b,prefix='',result=[]){
  if(canonical(a??null)===canonical(b??null))return result;
  if((a===undefined||a===null||typeof a==='object'&&!Array.isArray(a))&&(b===undefined||b===null||typeof b==='object'&&!Array.isArray(b))&&(a&&typeof a==='object'||b&&typeof b==='object')){
    for(const key of [...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].sort())leafChanges(a?.[key],b?.[key],prefix?prefix+'.'+key:key,result);
  }else {const sensitive=/(token|password|secret|credential|auth|callback|email|account|api.?key|private.?key|seed|mnemonic|recovery|\.env(?:\.|$))/i.test(prefix);const reviewable=/(?:^|\.)(?:allow|deny|skills|profile|primary|fallbacks|enabled|host|mode|security|ask|timeoutSeconds|network|image|imageID|browserImageID|recipeSHA256|tag|admission|scope|workspaceAccess|allowHostControl|autoStart|dangerouslyAllowPrivateNetwork|allowedHostnames|blockedHostnames|bind|port|maxRuns24h|maxImages24h|gatewayHeapMiB|policySealVersion|capabilityPolicy|previousIntegrity)$/.test(prefix);result.push({path:prefix||'(root)',change:a===undefined?'added':b===undefined?'removed':'changed',before: a===undefined?null:sha256(canonical(a)),after:b===undefined?null:sha256(canonical(b)),...(!sensitive&&reviewable?{beforeValue:a??null,afterValue:b??null}:{values:'redacted'})});}
  return result;
}
function reviewedAuthStaging(receipts){
  need(Array.isArray(receipts)&&receipts.length<=3,'SETUP_AUTH_STAGING_REVIEW_INVALID');
  const agents=new Set();
  return receipts.map(receipt=>{
    need(receipt&&typeof receipt==='object'&&!Array.isArray(receipt)&&Object.keys(receipt).sort().join(',')==='agent,order,provider,storage,verified','SETUP_AUTH_STAGING_REVIEW_INVALID');
    need(ALL_OAUTH_ROLES.includes(receipt.agent)&&!agents.has(receipt.agent)&&receipt.provider==='openai'&&canonical(receipt.order)===canonical(['openai:agi-compute-pro'])&&receipt.storage==='openclaw-agent-sqlite'&&receipt.verified===true,'SETUP_AUTH_STAGING_REVIEW_INVALID');
    agents.add(receipt.agent);
    return {agent:receipt.agent,provider:'openai',order:['openai:agi-compute-pro'],storage:'openclaw-agent-sqlite',verified:true};
  }).sort((a,b)=>a.agent.localeCompare(b.agent));
}
function reviewedStatePreparation(receipt){
  if(receipt===undefined)return undefined;
  need(isCandidateStatePreparationReceipt(receipt),'SETUP_STATE_PREPARATION_REVIEW_INVALID');return structuredClone(receipt);
}
function validCleanRuntimeSource(value){
 return value&&Object.keys(value).sort().join(',')==='approval,generation,recordSha256,sealedComponentSha256,sealedSecurityIdentity,transactionId'&&Number.isSafeInteger(value.generation)&&value.generation>=0&&value.generation<1000000&&/^[a-f0-9-]{36}$/.test(value.transactionId??'')&&['approval','recordSha256','sealedComponentSha256','sealedSecurityIdentity'].every(key=>/^[a-f0-9]{64}$/.test(value[key]??''));
}
function reviewDigest(review){
  const value=review.candidateIdentity===undefined?(review.statePreparation===undefined?review.changes:{changes:review.changes,statePreparation:review.statePreparation}):{changes:review.changes,candidateIdentity:review.candidateIdentity,authStaging:review.authStaging??[],...(review.statePreparation===undefined?{}:{statePreparation:review.statePreparation})};
  if(review.assuranceMode!==undefined)need(review.assuranceMode==='standard','SETUP_REVIEW_REQUIRED');
  return sha256(canonical(review.assuranceMode==='standard'?{assuranceMode:'standard',review:value}:review.cleanInitialization===undefined&&review.componentEvidence===undefined&&review.sourceCleanRuntime===undefined?value:{review:value,...(review.cleanInitialization===undefined?{}:{cleanInitialization:review.cleanInitialization}),...(review.componentEvidence===undefined?{}:{componentEvidence:review.componentEvidence}),...(review.sourceCleanRuntime===undefined?{}:{sourceCleanRuntime:review.sourceCleanRuntime})}));
}

export function validateReview(review){
  need(review?.schema==='agi-setup-security-review/v1'&&Array.isArray(review.changes)&&/^[a-f0-9]{64}$/.test(review.digest)&&review.secretsIncluded===false,'SETUP_REVIEW_REQUIRED');
  need(review.candidateIdentity===undefined||/^[a-f0-9]{64}$/.test(review.candidateIdentity),'SETUP_REVIEW_REQUIRED');
  const receipts=reviewedAuthStaging(review.authStaging??[]),changes=review.changes.filter(item=>typeof item?.path==='string'&&item.path.startsWith('authentication.'));
  need(changes.length===receipts.length&&receipts.every(receipt=>changes.some(change=>change.path==='authentication.'+receipt.agent&&change.after===sha256(canonical(receipt)))),'SETUP_REVIEW_STALE');
  const preparation=reviewedStatePreparation(review.statePreparation),preparedChanges=review.changes.filter(item=>typeof item?.path==='string'&&item.path.startsWith('preparation.'));
  need(preparedChanges.length===(preparation?1:0)&&(!preparation||preparedChanges[0].path==='preparation.sharedState'&&preparedChanges[0].before===preparation.sourceContentSha256&&preparedChanges[0].after===sha256(canonical(preparation))),'SETUP_REVIEW_STALE');
  if(review.cleanInitialization!==undefined)need(isCleanInitializationReceipt(review.cleanInitialization),'SETUP_CLEAN_INITIALIZATION_REVIEW_INVALID');
  if(review.sourceCleanRuntime!==undefined)need(validCleanRuntimeSource(review.sourceCleanRuntime),'SETUP_CLEAN_RUNTIME_SOURCE_REQUIRED');
  if(review.componentEvidence!==undefined)validateComponentReference(review.componentEvidence,{phase:'reviewed-before-approval'});
  need(review.digest===reviewDigest(review),'SETUP_REVIEW_STALE');
}
export function securityReview(previousConfig,candidateConfig,previousSettings,candidateSettings,{authStaging=[],statePreparation,cleanInitialization}={}){
  const omitSeal=c=>{const value={...c};delete value.policyHash;return value;};
  const changes=leafChanges({gateway:previousConfig??{},settings:omitSeal(previousSettings??{})},{gateway:candidateConfig,settings:omitSeal(candidateSettings)});
  const receipts=reviewedAuthStaging(authStaging);
  for(const receipt of receipts)changes.push({path:'authentication.'+receipt.agent,change:'added',before:null,after:sha256(canonical(receipt)),values:'redacted'});
  const preparation=reviewedStatePreparation(statePreparation);
  if(preparation)changes.push({path:'preparation.sharedState',change:preparation.sourceContentSha256===preparation.destinationContentSha256?'verified':'changed',before:preparation.sourceContentSha256,after:sha256(canonical(preparation)),beforeValue:{schemaSha256:preparation.sourceSchemaSha256,objects:preparation.sourceObjectCount,rows:preparation.sourceRowCount},afterValue:{schemaSha256:preparation.destinationSchemaSha256,objects:preparation.destinationObjectCount,rows:preparation.destinationRowCount,addedSchemaObjects:preparation.addedSchemaObjects.length,addedColumns:preparation.addedColumns,ownerProfileCreated:preparation.ownerProfileCreated,ownerIdentityCreated:preparation.ownerIdentityCreated,ownerDisplayNameInitialized:preparation.ownerDisplayNameInitialized,ownerDisplayNameSource:preparation.ownerDisplayNameSource,existingRecordsPreserved:preparation.existingRecordsPreserved}});
  if(cleanInitialization!==undefined)need(isCleanInitializationReceipt(cleanInitialization),'SETUP_CLEAN_INITIALIZATION_REVIEW_INVALID');
  const review={schema:'agi-setup-security-review/v1',changes,secretsIncluded:false,...(receipts.length?{authStaging:receipts}:{}),...(preparation?{statePreparation:preparation}:{}),...(cleanInitialization===undefined?{}:{cleanInitialization:structuredClone(cleanInitialization)})};review.digest=reviewDigest(review);return review;
}
function failureCodes(state){return {primaryFailureCode:state.primaryFailureCode?safeSetupFailure({message:state.primaryFailureCode}):null,rollbackFailureCode:state.rollbackFailureCode?safeSetupFailure({message:state.rollbackFailureCode}):null};}
function failureRuntimeDiagnostics(state){return {primaryRuntimeIdentityDiagnostic:safeRuntimeIdentityDiagnostic(state.primaryRuntimeIdentityDiagnostic),rollbackRuntimeIdentityDiagnostic:safeRuntimeIdentityDiagnostic(state.rollbackRuntimeIdentityDiagnostic)};}
const recoveryEvidenceFile='recovery-evidence/transaction-before-recovery.json';
const recoveryReceiptMaxBytes=1024*1024;
function fitOptionalDiagnosticDetails(state){
  // Component inventories are additive observations, not approval authority.
  // Keep them from pushing a previously readable receipt over the existing
  // recovery-reader limit. Never remove a digest, contract, failure observation,
  // or an unknown historical field merely to make a receipt fit.
  const size=()=>Buffer.byteLength(JSON.stringify(state,null,2));
  if(size()<=recoveryReceiptMaxBytes)return;
  const records=[state.approvedSecurityRecord,state.runtimeSecurityRecord,state.rollbackPlan?.restoredSecurity];
  for(const record of records){
    if(record?.diagnosticDetails?.schema!=='agi-runtime-identity-components/v1')continue;
    delete record.diagnosticDetails;
    if(size()<=recoveryReceiptMaxBytes)return;
  }
  // Mandatory data that was already oversized retains its existing behavior;
  // this is only an optional-inventory budget, not a new acceptance contract.
}
function parseRecoveryRecord(bytes){try{return JSON.parse(bytes);}catch{throw Error('SETUP_RECOVERY_EVIDENCE_INVALID');}}
function recoveryEvidenceStatus(state){
  const v=state.recoveryEvidence;
  if(v===undefined||v===null)return null;
  need(v&&typeof v==='object'&&!Array.isArray(v)&&v.file===recoveryEvidenceFile&&/^[a-f0-9]{64}$/.test(v.sha256)&&v.id===state.id&&['preparing','prepared','approved','publishing','published','sealed','safe-stop-required','complete','rolled-back'].includes(v.state)&&[1,2,3].includes(v.treeIdentityVersion)&&[1,2].includes(v.stagingProtocolVersion),'SETUP_RECOVERY_EVIDENCE_INVALID');
  return {file:v.file,sha256:v.sha256,state:v.state,id:v.id,treeIdentityVersion:v.treeIdentityVersion,stagingProtocolVersion:v.stagingProtocolVersion};
}
function readRecoveryRecord(file){
  const before=owned(file);need(before.isFile()&&!(before.mode&0o077)&&before.size<=recoveryReceiptMaxBytes,'SETUP_RECOVERY_EVIDENCE_INVALID');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const opened=fs.fstatSync(fd);need(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.uid===before.uid&&!(opened.mode&0o077)&&opened.size<=recoveryReceiptMaxBytes,'SETUP_RECOVERY_EVIDENCE_INVALID');
    const bytes=Buffer.alloc(opened.size+1),size=fs.readSync(fd,bytes,0,bytes.length,0),after=fs.fstatSync(fd);
    need(size===opened.size&&after.size===opened.size&&after.mtimeMs===opened.mtimeMs&&after.ctimeMs===opened.ctimeMs,'SETUP_RECOVERY_EVIDENCE_INVALID');
    return bytes.subarray(0,size);
  }finally{fs.closeSync(fd);}
}
export function transactionStatus(directory){
  const file=path.join(directory,'transaction.json');if(!exists(file))return {state:'none'};
  owned(file);const v=read(file);validateRuntimeContract(v);return {preparationProtocolVersion:v.preparationProtocolVersion??null,approvalWriteFailed:v.approvalWriteFailed===true||approvalIntentPresent(directory),runtimeSecurityVersion:v.runtimeSecurityVersion??null,completedIdentityKind:v.completedIdentityKind??null,state:v.state,id:v.id,profileDir:v.profileDir,previousExisted:v.previousExisted,approved:typeof v.approval==='string'&&!v.approvalWriteFailed&&!approvalIntentPresent(directory),serviceBackup:v.serviceBackup??null,stagingProtocolVersion:v.stagingProtocolVersion??1,treeIdentityVersion:v.treeIdentityVersion??1,...failureCodes(v),...failureRuntimeDiagnostics(v),failureRecordingFailed:v.failureRecordingFailed===true,recoveryEvidence:recoveryEvidenceStatus(v)};
}
export class SetupTransaction {
  constructor(directory,state,{stop,signal}={}){need(['preparing','prepared','approved','publishing','published','sealed','complete','rolled-back','safe-stop-required'].includes(state.state),'SETUP_TRANSACTION_STATE');need(state.treeIdentityVersion===undefined||[1,2,3].includes(state.treeIdentityVersion),'SETUP_TREE_IDENTITY_VERSION');need(state.stagingProtocolVersion===undefined||[1,SETUP_STAGING_PROTOCOL_VERSION].includes(state.stagingProtocolVersion),'SETUP_STAGING_PROTOCOL_VERSION');validateRuntimeContract(state);this.directory=directory;this.state=state;this.stop=stop;this.signal=signal;this.candidate=path.join(directory,'candidate');this.previous=path.join(directory,'previous');this.file=path.join(directory,'transaction.json');}
  identity(root,options={}){return profileIdentity(root,{...options,version:this.state.treeIdentityVersion??1});}
  save(state=this.state){fitOptionalDiagnosticDetails(state);write(this.file,state);}
  completeComponentCapture(root,contract,phase){
    const captured=captureRuntimeSecurityComponents(root,contract,{completeDiagnostics:true});
    const reference=persistComponentEvidence(this.directory,{transactionId:this.state.id,phase,captured});return {captured,reference};
  }
  componentCaptureSink(phase){
    if(this.state.componentEvidenceVersion!==1)return undefined;
    return captured=>{need(this.state.componentEvidence.observations.length<32,'SETUP_COMPONENT_EVIDENCE_LIMIT');const reference=persistComponentEvidence(this.directory,{transactionId:this.state.id,phase,captured});this.state.componentEvidence.observations.push(reference);this.save();};
  }
  runtimeSecurityBaseline(record){
    if(this.state.componentEvidenceVersion!==1)return record;
    const ref=record.contract.phase==='reviewed'?this.state.componentEvidence.reviewed:this.state.componentEvidence.sealed;
    const artifact=readComponentEvidence(this.directory,ref,{transactionId:this.state.id,identityDigest:record.digest});
    return {...record,diagnosticDetails:{schema:'agi-runtime-identity-components/v1',...artifact.components}};
  }
  assertComponentEvidence(){
    if(this.state.managedServiceInstallation)for(const ref of [this.state.managedServiceInstallation.before,this.state.managedServiceInstallation.after])readComponentEvidence(this.directory,ref,{transactionId:this.state.id});
    if(this.state.componentEvidenceVersion!==1)return;
    for(const ref of [this.state.componentEvidence.reviewed,this.state.componentEvidence.sealed,...this.state.componentEvidence.observations].filter(Boolean))readComponentEvidence(this.directory,ref,{transactionId:this.state.id});
  }
  preserveRecoveryEvidence(){
    // A recovery rewrites transaction.json. Preserve the original receipt before
    // any stop/rollback mutation and bind its immutable bytes to the new record.
    const source=readRecoveryRecord(this.file),current=parseRecoveryRecord(source);
    need(current&&current.schema===1&&current.id===this.state.id&&current.profileDir===this.state.profileDir&&canonical(current)===canonical(this.state),'SETUP_RECOVERY_EVIDENCE_INVALID');
    const root=path.join(this.directory,'recovery-evidence'),target=path.join(this.directory,recoveryEvidenceFile);
    try{fs.mkdirSync(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const directory=owned(root);need(directory.isDirectory()&&!(directory.mode&0o077),'SETUP_RECOVERY_EVIDENCE_INVALID');
    const previous=recoveryEvidenceStatus(current);let stored;
    if(fs.lstatSync(target,{throwIfNoEntry:false}))stored=readRecoveryRecord(target);
    else{
      need(!previous,'SETUP_RECOVERY_EVIDENCE_INVALID');
      const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeFileSync(fd,source);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      stored=readRecoveryRecord(target);need(stored.equals(source),'SETUP_RECOVERY_EVIDENCE_INVALID');
    }
    const saved=parseRecoveryRecord(stored),hash=sha256(stored);
    need(saved&&saved.schema===1&&saved.id===current.id&&saved.profileDir===current.profileDir,'SETUP_RECOVERY_EVIDENCE_INVALID');
    if(previous)need(hash===previous.sha256&&saved.state===previous.state&&(saved.treeIdentityVersion??1)===previous.treeIdentityVersion&&(saved.stagingProtocolVersion??1)===previous.stagingProtocolVersion,'SETUP_RECOVERY_EVIDENCE_INVALID');
    else need(stored.equals(source),'SETUP_RECOVERY_EVIDENCE_INVALID');
    this.state.recoveryEvidence={file:recoveryEvidenceFile,sha256:hash,state:saved.state,id:saved.id,treeIdentityVersion:saved.treeIdentityVersion??1,stagingProtocolVersion:saved.stagingProtocolVersion??1};
    recoveryEvidenceStatus(this.state);this.save();
  }
  recordFailure(error,{rollback=false}={}){
    const key=rollback?'rollbackFailureCode':'primaryFailureCode',diagnosticKey=rollback?'rollbackRuntimeIdentityDiagnostic':'primaryRuntimeIdentityDiagnostic';
    const observedCode=safeSetupFailure(error),firstFailure=!this.state[key];
    if(firstFailure)this.state[key]=observedCode;
    // Only a newly recorded failure owns this invocation's observation. A
    // repeated code does not establish that a later delta caused the historical
    // failure; preserve missing historical detail instead of backfilling it.
    const diagnostic=safeRuntimeIdentityDiagnostic(error?.runtimeIdentityDiagnostic);
    if(firstFailure&&diagnostic)this.state[diagnosticKey]=diagnostic;
    const codes=failureCodes(this.state),diagnostics=failureRuntimeDiagnostics(this.state);Object.assign(this.state,codes);
    // Raw messages, causes, paths and process output stay private. Diagnostic
    // fields are independently whitelisted again at every reporting boundary.
    if(error&&typeof error==='object'&&Object.isExtensible(error))Object.assign(error,codes,diagnostics);
    try{this.save();}catch(writeError){
      this.state.failureRecordingFailed=true;
      if(error&&typeof error==='object'&&Object.isExtensible(error))error.failureRecordingFailed=true;
      throw writeError;
    }
    return codes;
  }
  async recoverFailure(error){
    if(this.state.componentEvidenceVersion===1&&this.state.runtimeSecurityRecord&&!this.state.componentEvidence.observations.some(ref=>ref.phase==='completion-after-readiness'||ref.phase==='failure-observation')){
      try{const observed=this.completeComponentCapture(this.state.profileDir,this.state.runtimeSecurityRecord.contract,'failure-observation');this.state.componentEvidence.observations.push(observed.reference);this.save();}
      catch(captureError){this.state.componentEvidenceFailureCode=['SETUP_COMPONENT_EVIDENCE_INVALID','SETUP_COMPONENT_EVIDENCE_LIMIT','SETUP_PROFILE_CHANGED'].includes(captureError.message)?captureError.message:'SETUP_COMPONENT_EVIDENCE_CAPTURE_FAILED';}
    }
    try{this.recordFailure(error);}catch{/* State still holds safe codes if persisting the receipt fails. */}
    try{await this.rollback();}catch{/* rollback() records its failure; preserve the primary exception. */}
    if(error&&typeof error==='object'&&Object.isExtensible(error))Object.assign(error,failureCodes(this.state),failureRuntimeDiagnostics(this.state),{failureRecordingFailed:this.state.failureRecordingFailed===true});
  }
  check(){need(!this.signal?.aborted,'SETUP_CANCELLED');}
  assertReviewPreparation(review){
    if(this.state.installationTrack==='clean-install')need(isCleanInitializationReceipt(this.state.cleanInitializationReceipt)&&canonical(this.state.cleanInitializationReceipt)===canonical(review.cleanInitialization)&&!fs.lstatSync(path.join(this.directory,'clean-initialization-in-progress.json'),{throwIfNoEntry:false}),'SETUP_CLEAN_INITIALIZATION_REVIEW_INVALID');
    else need(review.cleanInitialization===undefined,'SETUP_CLEAN_INITIALIZATION_REVIEW_INVALID');
    const expected=reviewedStatePreparation(this.state.preparationReceipt),reviewed=reviewedStatePreparation(review.statePreparation);
    if(this.state.preparationProtocolVersion===SETUP_PREPARATION_PROTOCOL_VERSION)need(expected&&reviewed&&!fs.lstatSync(path.join(this.directory,'state-preparation-in-progress.json'),{throwIfNoEntry:false}),'SETUP_STATE_PREPARATION_REVIEW_INVALID');
    need(canonical(expected??null)===canonical(reviewed??null),'SETUP_REVIEW_STALE');
    if(expected)need(this.state.preparationProtocolVersion===SETUP_PREPARATION_PROTOCOL_VERSION,'SETUP_STATE_PREPARATION_REVIEW_INVALID');
  }
  bindReview(review){
    this.check();validateReview(review);this.assertReviewPreparation(review);
    const bound={...structuredClone(review),candidateIdentity:this.identity(this.candidate)};
    need(/^[a-f0-9]{64}$/.test(bound.candidateIdentity),'SETUP_REVIEW_REQUIRED');
    if(this.state.componentEvidenceVersion===1){
      if(this.state.installationTrack==='clean-maintenance')bound.sourceCleanRuntime=structuredClone(this.state.sourceCleanRuntime);
      const contract={cleanInstallVersion:1,runtimeMutabilityVersion:1,pluginCatalogCacheVersion:1,profileDir:this.state.profileDir,authStaging:reviewedAuthStaging(review.authStaging??[]),phase:'reviewed',registryAliases:[this.candidate]};
      const {reference}=this.completeComponentCapture(this.candidate,contract,'reviewed-before-approval');
      need(this.identity(this.candidate)===bound.candidateIdentity,'SETUP_REVIEW_STALE');bound.componentEvidence=reference;this.state.componentEvidence.reviewed=reference;this.save();
    }
    bound.digest=reviewDigest(bound);return bound;
  }
  approvalWriteFailure(previous,next,intent,cause){
    const failure=Error('SETUP_APPROVAL_WRITE_FAILED',{cause});
    this.approvalWriteBlocked=true;
    this.state={...previous,approvalWriteFailed:true,primaryFailureCode:previous.primaryFailureCode??'SETUP_APPROVAL_WRITE_FAILED'};
    // The receipt rename may have succeeded before fsync reported failure.
    // Preserve exactly what reached disk before revoking the in-memory approval.
    // The durable intent makes an interrupted/uncertain attempt non-resumable.
    try{
      const observed=readRecoveryRecord(this.file),record=parseRecoveryRecord(observed),serialized=canonical(record);
      const observation=serialized===canonical(previous)?'previous':serialized===canonical(next)?'attempted':'unexpected';
      const root=path.join(this.directory,'approval-evidence'),target=path.join(this.directory,approvalEvidenceName);
      try{fs.mkdirSync(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      const st=owned(root);need(st.isDirectory()&&!(st.mode&0o077),'SETUP_APPROVAL_WRITE_FAILED');
      if(fs.lstatSync(target,{throwIfNoEntry:false}))need(readRecoveryRecord(target).equals(observed),'SETUP_APPROVAL_WRITE_FAILED');
      else{const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,observed);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(root);}
      this.state.approvalWriteEvidence={file:approvalEvidenceName,sha256:sha256(observed),observation};
      if(!approvalIntentPresent(this.directory))write(path.join(this.directory,approvalIntentName),intent);
      fitOptionalDiagnosticDetails(this.state);write(this.file,this.state);
    }catch{this.state.failureRecordingFailed=true;failure.failureRecordingFailed=true;}
    Object.assign(failure,failureCodes(this.state),failureRuntimeDiagnostics(this.state));return failure;
  }
  approve(review){
    this.check();validateReview(review);this.assertReviewPreparation(review);
    need(!this.approvalWriteBlocked&&!this.state.approvalWriteFailed&&!approvalIntentPresent(this.directory),'SETUP_APPROVAL_WRITE_FAILED');
    need(this.state.stagingProtocolVersion!==SETUP_STAGING_PROTOCOL_VERSION||review.candidateIdentity!==undefined,'SETUP_REVIEW_REQUIRED');
    const identity=this.identity(this.candidate);
    need(review.candidateIdentity===undefined||review.candidateIdentity===identity,'SETUP_REVIEW_STALE');
    const previous=structuredClone(this.state),next=structuredClone(this.state);
    if(next.installationTrack==='clean-maintenance')need(canonical(review.sourceCleanRuntime)===canonical(next.sourceCleanRuntime),'SETUP_REVIEW_STALE');
    else need(review.sourceCleanRuntime===undefined,'SETUP_REVIEW_STALE');
    next.approval=review.digest;next.approvedIdentity=identity;
    if(next.runtimeSecurityVersion===1){
      next.authStaging=reviewedAuthStaging(review.authStaging??[]);
      const contract={...(next.componentEvidenceVersion===1?{cleanInstallVersion:1,runtimeMutabilityVersion:1,pluginCatalogCacheVersion:1}:{}),profileDir:next.profileDir,authStaging:next.authStaging,phase:'reviewed',registryAliases:[this.candidate]};
      if(next.componentEvidenceVersion===1){
        need(canonical(review.componentEvidence)===canonical(next.componentEvidence.reviewed),'SETUP_REVIEW_STALE');
        const previousCapture=readComponentEvidence(this.directory,review.componentEvidence,{transactionId:next.id,phase:'reviewed-before-approval'});
        const captured=captureRuntimeSecurityComponents(this.candidate,contract,{completeDiagnostics:true});
        need(captured.identity.digest===previousCapture.identity.digest&&canonical(captured.components)===canonical(previousCapture.components),'SETUP_REVIEW_STALE');next.approvedSecurityRecord=captured.identity;
      }else next.approvedSecurityRecord=captureRuntimeSecurityIdentity(this.candidate,contract);
      need(this.identity(this.candidate)===identity,'SETUP_REVIEW_STALE');
    }
    next.state='approved';validateRuntimeContract(next);this.check();
    // Fit optional details before binding the approval intent to exact state.
    fitOptionalDiagnosticDetails(next);
    const intent={schema:'agi-approval-write-intent/v1',transactionId:next.id,previousSHA256:sha256(canonical(previous)),attemptedSHA256:sha256(canonical(next))};
    try{
      write(path.join(this.directory,approvalIntentName),intent);
      this.save(next);
      need(canonical(parseRecoveryRecord(readRecoveryRecord(this.file)))===canonical(next),'SETUP_APPROVAL_WRITE_FAILED');
      fs.unlinkSync(path.join(this.directory,approvalIntentName));syncDirectory(this.directory);
    }catch(error){throw this.approvalWriteFailure(previous,next,intent,error);}
    // Publication sees the approval only after all validation and durable I/O.
    this.state=next;
  }
  async publish({review,seal,validate,installDerivedAuthority}){
    need(!this.approvalWriteBlocked&&!this.state.approvalWriteFailed&&!approvalIntentPresent(this.directory),'SETUP_APPROVAL_WRITE_FAILED');
    this.check();this.assertComponentEvidence();validateReview(review);this.assertReviewPreparation(review);need(this.state.state==='approved'&&this.state.approval===review.digest&&this.state.approvedIdentity===this.identity(this.candidate),'SETUP_REVIEW_STALE');
    need(this.identity(this.state.profileDir)===this.state.baseIdentity,'SETUP_PROFILE_CHANGED');
    await this.stop();this.check();
    need(this.identity(this.state.profileDir)===this.state.baseIdentity,'SETUP_PROFILE_CHANGED');
    this.state.state='publishing';this.save();
    if(exists(this.state.profileDir))fs.renameSync(this.state.profileDir,this.previous);
    fs.renameSync(this.candidate,this.state.profileDir);
    this.state.state='published';this.save();
    try{await validate();this.check();need(this.identity(this.state.profileDir)===this.state.approvedIdentity,'SETUP_REVIEW_STALE');await seal();if(this.state.runtimeSecurityVersion===1){need(this.state.approvedSecurityRecord,'SETUP_RUNTIME_SECURITY_VERSION');assertRuntimeSecurityIdentity(this.state.profileDir,this.state.approvedSecurityRecord,{phase:'publish-reviewed'});
      if(installDerivedAuthority){
        const contract={...this.state.approvedSecurityRecord.contract,phase:'sealed'};
        const before=this.completeComponentCapture(this.state.profileDir,contract,'before-managed-service-install');
        // Persist the pre-install authority before the only allowed derived
        // write. A failed/partial install remains stopped and fail-closed.
        this.state.runtimeSecurityRecord=before.captured.identity;this.state.sealedSecurityIdentity=before.captured.identity.digest;if(this.state.componentEvidenceVersion===1)this.state.componentEvidence.sealed=this.completeComponentCapture(this.state.profileDir,contract,'sealed-before-readiness').reference;this.save();
        const receipt=await installDerivedAuthority();
        const after=this.completeComponentCapture(this.state.profileDir,contract,'after-managed-service-install');
        assertManagedServiceTransition(before.captured,after.captured,receipt);
        this.state.managedServiceInstallation={schema:'agi-managed-service-installation/v1',authority:receipt.authority,before:before.reference,after:after.reference};
      }
      if(this.state.componentEvidenceVersion===1){const sealed=this.completeComponentCapture(this.state.profileDir,{...this.state.approvedSecurityRecord.contract,phase:'sealed'},'sealed-before-readiness');this.state.runtimeSecurityRecord=sealed.captured.identity;this.state.componentEvidence.sealed=sealed.reference;}else this.state.runtimeSecurityRecord=captureRuntimeSecurityIdentity(this.state.profileDir,{...this.state.approvedSecurityRecord.contract,phase:'sealed'});this.state.sealedSecurityIdentity=this.state.runtimeSecurityRecord.digest;}this.state.state='sealed';this.save();}catch(error){await this.recoverFailure(error);throw error;}
  }
  async complete(verify,activate=()=>{}){
    this.check();this.assertComponentEvidence();need(this.state.state==='sealed','SETUP_TRANSACTION_STATE');
    try{
      await verify();this.check();
      if(this.state.runtimeSecurityVersion===1){
        validateRuntimeContract(this.state);need(this.state.runtimeSecurityRecord,'SETUP_RUNTIME_SECURITY_VERSION');
        assertRuntimeSecurityIdentity(this.state.profileDir,this.runtimeSecurityBaseline(this.state.runtimeSecurityRecord),{phase:'completion-after-readiness',captureSink:this.componentCaptureSink('completion-after-readiness')});
        this.state.completedIdentity=this.state.sealedSecurityIdentity;this.state.completedIdentityKind=runtimeIdentityKind;
      }else this.state.completedIdentity=this.identity(this.state.profileDir,{ignoreStop:true});
      this.state.state='complete';this.save();await activate();
    }catch(error){await this.recoverFailure(error);throw error;}
  }
  assertRuntimeSecurity(root,phase='rollback-before-restore'){
    try{this.assertComponentEvidence();assertRuntimeSecurityIdentity(root,this.runtimeSecurityBaseline(this.state.runtimeSecurityRecord),{phase,captureSink:this.componentCaptureSink(phase)});}
    catch(error){
      if(error.message!=='SETUP_PROFILE_CHANGED')throw error;
      const failure=Error('SETUP_ROLLBACK_RUNTIME_CHANGED',{cause:error});
      const diagnostic=safeRuntimeIdentityDiagnostic(error.runtimeIdentityDiagnostic);
      if(diagnostic)failure.runtimeIdentityDiagnostic=diagnostic;
      throw failure;
    }
  }
  rollbackPath(name,prefix){
    need(typeof name==='string'&&new RegExp('^'+prefix+'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(name),'SETUP_ROLLBACK_PLAN_INVALID');
    const file=path.join(this.directory,name);need(path.dirname(file)===this.directory,'SETUP_ROLLBACK_PLAN_INVALID');
    const stat=fs.lstatSync(file,{throwIfNoEntry:false});if(stat)need(owned(file).isDirectory()&&!(stat.mode&0o077),'SETUP_ROLLBACK_PLAN_INVALID');return file;
  }
  async rollbackRuntime(){
    // Runtime stores can contain spent allowances, accepted work and refreshed
    // credentials. Preserve their current committed state while restoring only
    // the old immutable configuration. Never activate the stale previous tree.
    need(exists(this.previous),'SETUP_ROLLBACK_BACKUP_MISSING');
    need(this.identity(this.previous)===this.state.baseIdentity,'SETUP_ROLLBACK_BACKUP_CHANGED');
    let plan=this.state.rollbackPlan;
    if(!plan){
      this.assertRuntimeSecurity(this.state.profileDir);
      const id=crypto.randomUUID(),currentName='rollback-current-'+id,restoreName='rollback-restored-'+id,failedName='failed-'+id;
      const current=this.rollbackPath(currentName,'rollback-current-'),restored=this.rollbackPath(restoreName,'rollback-restored-');
      need(!exists(current)&&!exists(restored)&&!exists(this.rollbackPath(failedName,'failed-')),'SETUP_ROLLBACK_PLAN_INVALID');
      await snapshotProfile(this.state.profileDir,current);
      this.assertRuntimeSecurity(current,'rollback-current');this.assertRuntimeSecurity(this.state.profileDir);
      const currentIdentity=this.identity(current,{ignoreStop:true});
      need(currentIdentity===this.identity(this.state.profileDir,{ignoreStop:true}),'SETUP_PROFILE_CHANGED');
      await snapshotProfile(this.previous,restored);
      need(this.identity(restored)===this.state.baseIdentity,'SETUP_ROLLBACK_BACKUP_CHANGED');
      const restoredSecurity=await carryForwardRuntimeState({previous:this.previous,current,target:restored,contract:this.state.runtimeSecurityRecord.contract,setupTransactionId:this.state.id});
      need(this.identity(this.previous)===this.state.baseIdentity,'SETUP_ROLLBACK_BACKUP_CHANGED');
      this.assertRuntimeSecurity(current,'rollback-current');
      need(currentIdentity===this.identity(current,{ignoreStop:true}),'SETUP_PROFILE_CHANGED');
      syncTree(current);syncTree(restored);
      plan={version:1,phase:'prepared',currentSnapshot:currentName,restoredCandidate:restoreName,failedCandidate:failedName,currentIdentity,restoredIdentity:this.identity(restored,{ignoreStop:true}),restoredSecurity};
      this.state.rollbackPlan=plan;this.state.rollbackFromState??=this.state.state;this.state.state='safe-stop-required';this.save();
    }
    need(plan.version===1&&['prepared','current-retained','restored'].includes(plan.phase)&&/^[a-f0-9]{64}$/.test(plan.currentIdentity)&&/^[a-f0-9]{64}$/.test(plan.restoredIdentity),'SETUP_ROLLBACK_PLAN_INVALID');
    const current=this.rollbackPath(plan.currentSnapshot,'rollback-current-'),restored=this.rollbackPath(plan.restoredCandidate,'rollback-restored-'),failed=this.rollbackPath(plan.failedCandidate,'failed-');
    need(exists(current)&&this.identity(current,{ignoreStop:true})===plan.currentIdentity,'SETUP_ROLLBACK_PLAN_INVALID');this.assertRuntimeSecurity(current,'rollback-current');
    // Directory presence plus exact recorded identities distinguish a crash on
    // either side of each rename. A restored profile is never compared with the
    // new candidate's completed identity, and retained evidence is never reused.
    if(!exists(failed)){
      need(plan.phase==='prepared'&&exists(restored)&&exists(this.state.profileDir),'SETUP_ROLLBACK_PLAN_INVALID');
      need(this.identity(restored,{ignoreStop:true})===plan.restoredIdentity,'SETUP_ROLLBACK_PLAN_INVALID');
      assertRuntimeSecurityIdentity(restored,plan.restoredSecurity,{phase:'rollback-restored'});
      this.assertRuntimeSecurity(this.state.profileDir);
      need(this.identity(this.state.profileDir,{ignoreStop:true})===plan.currentIdentity,'SETUP_PROFILE_CHANGED');
      durableRename(this.state.profileDir,failed);
      plan.phase='current-retained';this.state.failedCandidate=plan.failedCandidate;this.save();
    }
    need(this.identity(failed,{ignoreStop:true})===plan.currentIdentity,'SETUP_ROLLBACK_PLAN_INVALID');this.assertRuntimeSecurity(failed,'rollback-current');
    if(exists(restored)){
      need(!exists(this.state.profileDir)&&this.identity(restored,{ignoreStop:true})===plan.restoredIdentity,'SETUP_ROLLBACK_PLAN_INVALID');
      assertRuntimeSecurityIdentity(restored,plan.restoredSecurity,{phase:'rollback-restored'});
      durableRename(restored,this.state.profileDir);
    }
    need(exists(this.state.profileDir)&&this.identity(this.state.profileDir,{ignoreStop:true})===plan.restoredIdentity,'SETUP_ROLLBACK_PLAN_INVALID');
    assertRuntimeSecurityIdentity(this.state.profileDir,plan.restoredSecurity,{phase:'rollback-restored'});
    // Only remove our own emergency pause after recovering an interrupted swap;
    // a pre-existing operator stop remains part of the restored previous tree.
    const stopFile=path.join(this.state.profileDir,'COMPUTE_STOP'),previousStop=path.join(this.previous,'COMPUTE_STOP');
    if(exists(stopFile)&&fs.readFileSync(stopFile,'utf8')===recoveryStopMessage){
      if(exists(previousStop))atomicWrite(stopFile,fs.readFileSync(previousStop));else{fs.unlinkSync(stopFile);syncDirectory(this.state.profileDir);}
    }
    plan.phase='restored';this.state.failedCandidate=plan.failedCandidate;this.state.state='rolled-back';this.save();
  }
  async rollbackFreshRuntime(){
    // A first installation has no prior profile. Bind the whole stopped current
    // tree before retaining it as candidate, so an interrupted rename can resume
    // without losing its runtime history or inventing a new empty profile.
    let plan=this.state.freshRollbackPlan;
    if(!plan){
      need(!exists(this.candidate)&&exists(this.state.profileDir),'SETUP_ROLLBACK_PLAN_INVALID');this.assertRuntimeSecurity(this.state.profileDir);
      plan={version:1,candidateIdentity:this.identity(this.state.profileDir,{ignoreStop:true})};
      this.state.freshRollbackPlan=plan;this.state.rollbackFromState??=this.state.state;this.state.state='safe-stop-required';this.save();
    }
    need(plan.version===1&&/^[a-f0-9]{64}$/.test(plan.candidateIdentity),'SETUP_ROLLBACK_PLAN_INVALID');
    if(exists(this.state.profileDir)){
      need(!exists(this.candidate),'SETUP_ROLLBACK_PLAN_INVALID');this.assertRuntimeSecurity(this.state.profileDir);
      need(this.identity(this.state.profileDir,{ignoreStop:true})===plan.candidateIdentity,'SETUP_PROFILE_CHANGED');durableRename(this.state.profileDir,this.candidate);
    }
    need(exists(this.candidate)&&this.identity(this.candidate,{ignoreStop:true})===plan.candidateIdentity,'SETUP_ROLLBACK_PLAN_INVALID');this.assertRuntimeSecurity(this.candidate,'rollback-current');
    this.state.state='rolled-back';this.save();
  }
  async rollback(){
    try{
      const alreadyRolledBack=this.state.state==='rolled-back';
      let stopped=false;try{await this.stop();stopped=true;}catch{}
      if(!stopped){
        const failure=Error('SETUP_ROLLBACK_STOP_REQUIRED');this.state.rollbackFailureCode??=safeSetupFailure(failure);
        if(!alreadyRolledBack){
          this.state.rollbackFromState??=this.state.state;this.state.state='safe-stop-required';
          try{if(exists(this.state.profileDir)){const stopFile=path.join(this.state.profileDir,'COMPUTE_STOP');if(fs.lstatSync(stopFile,{throwIfNoEntry:false}))need(owned(stopFile).isFile(),'SETUP_STATE_FILE_UNSUPPORTED');else writeRecoveryStop(this.state.profileDir);}}
          catch{this.state.failureRecordingFailed=true;failure.failureRecordingFailed=true;}
        }
        throw failure;
      }
      // A later recovery may repeat this call after profile restoration. Never
      // compare the restored original with the completed candidate identity.
      if(alreadyRolledBack)return;
      const phase=this.state.rollbackFromState??this.state.state;
      validateRuntimeContract(this.state);
      if(this.state.runtimeSecurityVersion===1&&this.state.runtimeSecurityRecord){
        // A completed first installation has no older active profile into which
        // accepted work and allowances can be carried. Do not turn an explicit
        // rollback into an uninstall that would reset operational history.
        need(this.state.previousExisted||phase!=='complete'||Boolean(this.state.primaryFailureCode),'SETUP_ROLLBACK_BACKUP_MISSING');
        if(this.state.previousExisted){await this.rollbackRuntime();return;}
        await this.rollbackFreshRuntime();return;
      }
      if(this.state.completedIdentity&&this.state.runtimeSecurityVersion!==1)need(this.state.completedIdentity===this.identity(this.state.profileDir,{ignoreStop:true}),'SETUP_ROLLBACK_RUNTIME_CHANGED');
      if(exists(this.previous)){
        need(this.identity(this.previous)===this.state.baseIdentity,'SETUP_ROLLBACK_BACKUP_CHANGED');
        if(exists(this.state.profileDir)){const failed=path.join(this.directory,'failed-'+crypto.randomUUID());fs.renameSync(this.state.profileDir,failed);this.state.failedCandidate=path.basename(failed);}
        fs.renameSync(this.previous,this.state.profileDir);
      }else if(!this.state.previousExisted&&exists(this.state.profileDir)&&['published','sealed','publishing','complete'].includes(phase)){
        if(exists(this.candidate))fs.renameSync(this.candidate,path.join(this.directory,'interrupted-'+crypto.randomUUID()));
        fs.renameSync(this.state.profileDir,this.candidate);
      }
      else need(!this.state.previousExisted||!['published','sealed','complete'].includes(phase),'SETUP_ROLLBACK_BACKUP_MISSING');
      this.state.state='rolled-back';this.save();
    }catch(error){
      if(this.state.runtimeSecurityVersion===1&&this.state.runtimeSecurityRecord&&this.state.state!=='rolled-back'){this.state.rollbackFromState??=this.state.state;this.state.state='safe-stop-required';}
      try{this.recordFailure(error,{rollback:true});}catch{/* Preserve the known rollback failure if its receipt cannot be saved. */}
      if(error&&typeof error==='object'&&Object.isExtensible(error))Object.assign(error,failureCodes(this.state),failureRuntimeDiagnostics(this.state),{failureRecordingFailed:this.state.failureRecordingFailed===true});
      throw error;
    }
  }
}
async function inheritedCleanRuntime({profileDir,directory,stop,signal}){
  const locations=[directory];
  if(['transaction','qualification-transaction'].includes(path.basename(directory))){const sibling=path.join(path.dirname(directory),path.basename(directory)==='transaction'?'qualification-transaction':'transaction');if(sibling!==directory)locations.push(sibling);}
  const candidates=[];
  for(const location of locations){
    const file=path.join(location,'transaction.json');if(!fs.lstatSync(file,{throwIfNoEntry:false}))continue;
    const state=JSON.parse(readRecoveryRecord(file));
    if(state.profileDir!==profileDir)continue;
    if(state.installationTrack===undefined&&state.runtimeSecurityRecord?.contract?.cleanInstallVersion===undefined)continue;
    const tx=new SetupTransaction(location,state,{stop,signal});
    need(state.componentEvidenceVersion===1&&state.state==='complete'&&state.runtimeSecurityRecord?.contract?.cleanInstallVersion===1&&!state.primaryFailureCode&&!state.rollbackFailureCode&&!state.approvalWriteFailed&&!approvalIntentPresent(location),'SETUP_CLEAN_RUNTIME_SOURCE_REQUIRED');
    tx.assertComponentEvidence();candidates.push(tx);
  }
  if(!candidates.length)return null;
  // The two modern workflow slots retain older approvals. Never select an old
  // approval merely because reverted/tampered current bytes happen to match it.
  // Each generation is bound into its fresh review via sourceCleanRuntime.
  const generation=Math.max(...candidates.map(tx=>tx.state.cleanRuntimeGeneration));
  const latest=candidates.filter(tx=>tx.state.cleanRuntimeGeneration===generation);need(latest.length===1,'SETUP_CLEAN_RUNTIME_SOURCE_REQUIRED');
  const selected=latest[0];await stop();need(!signal?.aborted,'SETUP_CANCELLED');
  assertRuntimeSecurityIdentity(profileDir,selected.runtimeSecurityBaseline(selected.state.runtimeSecurityRecord),{phase:'sealed-before-readiness'});
  const state=selected.state,bytes=readRecoveryRecord(selected.file);need(canonical(JSON.parse(bytes))===canonical(state),'SETUP_PROFILE_CHANGED');
  return {transactionId:state.id,generation:state.cleanRuntimeGeneration,sealedSecurityIdentity:state.sealedSecurityIdentity,approval:state.approval,sealedComponentSha256:state.componentEvidence.sealed.sha256,recordSha256:sha256(bytes)};
}
/** The production constructor has no predecessor, snapshot or legacy-recovery branch. */
export async function beginFreshSetupTransaction({profileDir,directory,stop,signal}){
  need(path.isAbsolute(profileDir)&&path.isAbsolute(directory)&&profileDir!==directory&&!directory.startsWith(profileDir+path.sep)&&!profileDir.startsWith(directory+path.sep),'SETUP_TRANSACTION_PATH');
  const absent=()=>need(!fs.lstatSync(profileDir,{throwIfNoEntry:false})&&!fs.lstatSync(directory,{throwIfNoEntry:false}),'SETUP_CLEAN_INSTALL_REQUIRED');
  const canonicalParents=()=>{for(const target of [directory,profileDir]){const base=path.dirname(target);need(path.resolve(target)===target&&owned(base).isDirectory()&&fs.realpathSync(base)===base,'SETUP_STATE_OWNER_REQUIRED');}};
  absent();canonicalParents();need(!signal?.aborted,'SETUP_CANCELLED');await stop();need(!signal?.aborted,'SETUP_CANCELLED');absent();canonicalParents();
  fs.mkdirSync(directory,{mode:0o700});
  const state={schema:1,installationTrack:'clean-install',cleanRuntimeGeneration:0,componentEvidenceVersion:1,componentEvidence:{observations:[]},preparationProtocolVersion:SETUP_PREPARATION_PROTOCOL_VERSION,runtimeSecurityVersion:SETUP_RUNTIME_SECURITY_VERSION,stagingProtocolVersion:SETUP_STAGING_PROTOCOL_VERSION,treeIdentityVersion:3,id:crypto.randomUUID(),state:'preparing',profileDir,previousExisted:false,baseIdentity:null,approval:null,approvedIdentity:null,completedIdentity:null,startedAt:new Date().toISOString()};
  const tx=new SetupTransaction(directory,state,{stop,signal});tx.save();
  fs.mkdirSync(tx.candidate,{mode:0o700});syncDirectory(directory);
  need(!fs.lstatSync(profileDir,{throwIfNoEntry:false}),'SETUP_CLEAN_INSTALL_REQUIRED');
  state.state='prepared';tx.save();return tx;
}


/** Standard is fresh-only: no prior generations, historical schema inference or
 * runtime inventory equivalence. The same stop guard, durable approval receipt,
 * private publication and authority-bound service preparation remain mandatory. */
export class StandardSetupTransaction extends SetupTransaction {
  assertReviewPreparation(review){
    const preparation=reviewedStatePreparation(this.state.preparationReceipt);
    need(preparation&&canonical(preparation)===canonical(review.statePreparation)&&review.cleanInitialization===undefined&&!fs.lstatSync(path.join(this.directory,'state-preparation-in-progress.json'),{throwIfNoEntry:false}),'SETUP_STATE_PREPARATION_REVIEW_INVALID');
  }
  identity(root){return exists(root)?captureStandardAuthority(root,{phase:'reviewed',authStaging:this.state.authStaging??[]}).digest:null;}
  bindReview(review){
    this.check();validateReview(review);this.assertReviewPreparation(review);
    need(this.state.state==='prepared','SETUP_TRANSACTION_STATE');this.state.authStaging=reviewedAuthStaging(review.authStaging??[]);
    const authority=captureStandardAuthority(this.candidate,{phase:'reviewed',authStaging:this.state.authStaging});
    const bound={...structuredClone(review),assuranceMode:'standard',candidateIdentity:authority.digest};bound.digest=reviewDigest(bound);
    this.state.standardReviewedAuthority=authority;this.save();return bound;
  }
  approve(review){
    this.check();validateReview(review);this.assertReviewPreparation(review);
    need(this.state.state==='prepared'&&review.assuranceMode==='standard'&&!this.state.approvalWriteFailed&&!approvalIntentPresent(this.directory),'SETUP_REVIEW_REQUIRED');
    assertStandardAuthority(this.candidate,this.state.standardReviewedAuthority,{authStaging:this.state.authStaging});need(review.candidateIdentity===this.state.standardReviewedAuthority.digest,'SETUP_REVIEW_STALE');
    const previous=structuredClone(this.state),next={...structuredClone(this.state),state:'approved',approval:review.digest,approvedIdentity:review.candidateIdentity};
    const intent={schema:'agi-approval-write-intent/v1',transactionId:next.id,previousSHA256:sha256(canonical(previous)),attemptedSHA256:sha256(canonical(next))};
    try{write(path.join(this.directory,approvalIntentName),intent);this.save(next);need(canonical(parseRecoveryRecord(readRecoveryRecord(this.file)))===canonical(next),'SETUP_APPROVAL_WRITE_FAILED');fs.unlinkSync(path.join(this.directory,approvalIntentName));syncDirectory(this.directory);}catch(error){throw this.approvalWriteFailure(previous,next,intent,error);}this.state=next;
  }
  async publish({review,validate,seal,installDerivedAuthority}){
    this.check();validateReview(review);this.assertReviewPreparation(review);
    need(this.state.state==='approved'&&review.assuranceMode==='standard'&&this.state.approval===review.digest&&!approvalIntentPresent(this.directory),'SETUP_REVIEW_REQUIRED');
    assertStandardAuthority(this.candidate,this.state.standardReviewedAuthority,{authStaging:this.state.authStaging});
    await this.stop();this.check();need(!fs.lstatSync(this.state.profileDir,{throwIfNoEntry:false}),'SETUP_PROFILE_CHANGED');
    this.state.state='publishing';this.save();durableRename(this.candidate,this.state.profileDir);this.state.state='published';this.save();
    try{
      await validate();assertStandardAuthority(this.state.profileDir,this.state.standardReviewedAuthority,{authStaging:this.state.authStaging});await seal();
      assertStandardAuthority(this.state.profileDir,this.state.standardReviewedAuthority,{authStaging:this.state.authStaging});
      if(installDerivedAuthority){const receipt=await installDerivedAuthority();need(receipt?.authority?.schema==='agi-managed-gateway-authority/v1','SETUP_MANAGED_SERVICE_AUTHORITY_CHANGED');this.state.standardManagedServiceAuthority=receipt.authority;}
      // Reviewed comparison ignores only derived service-env and the seal hash;
      // sealed capture includes the exactly validated managed launch files.
      assertStandardAuthority(this.state.profileDir,this.state.standardReviewedAuthority,{authStaging:this.state.authStaging});
      this.state.standardSealedAuthority=captureStandardAuthority(this.state.profileDir,{authStaging:this.state.authStaging});
      this.state.sealedSecurityIdentity=this.state.standardSealedAuthority.digest;this.state.state='sealed';this.save();
    }catch(error){await this.recoverFailure(error);throw error;}
  }
  async complete(verify,activate=()=>{}){
    this.check();need(this.state.state==='sealed','SETUP_TRANSACTION_STATE');
    try{await verify();this.check();assertStandardAuthority(this.state.profileDir,this.state.standardSealedAuthority,{authStaging:this.state.authStaging});this.state.completedIdentity=this.state.standardSealedAuthority.digest;this.state.completedIdentityKind='standard-authority/v1';this.state.state='complete';this.save();await activate();}catch(error){await this.recoverFailure(error);throw error;}
  }
  async rollback(){
    try{
      await this.stop();if(this.state.state==='rolled-back')return;
      const phase=this.state.rollbackFromState??this.state.state;
      need(phase!=='complete'||Boolean(this.state.primaryFailureCode),'SETUP_ROLLBACK_BACKUP_MISSING');
      if(exists(this.state.profileDir)){
        if(this.state.standardSealedAuthority)assertStandardAuthority(this.state.profileDir,this.state.standardSealedAuthority,{authStaging:this.state.authStaging});
        else if(this.state.standardReviewedAuthority)assertStandardAuthority(this.state.profileDir,this.state.standardReviewedAuthority,{authStaging:this.state.authStaging});
        need(!exists(this.candidate),'SETUP_ROLLBACK_PLAN_INVALID');
        durableRename(this.state.profileDir,this.candidate);this.state.failedCandidate='candidate';
      }
      this.state.state='rolled-back';this.state.rollbackFailureCode=null;this.save();
    }catch(error){this.state.rollbackFromState??=this.state.state;this.state.state='safe-stop-required';if(exists(this.state.profileDir))writeRecoveryStop(this.state.profileDir);this.recordFailure(error,{rollback:true});throw error;}
  }
}
export async function beginStandardSetupTransaction({profileDir,directory,stop,signal}){
  need(path.isAbsolute(profileDir)&&path.isAbsolute(directory)&&profileDir!==directory&&!directory.startsWith(profileDir+path.sep)&&!profileDir.startsWith(directory+path.sep),'SETUP_TRANSACTION_PATH');
  const absent=()=>need(!fs.lstatSync(profileDir,{throwIfNoEntry:false})&&!fs.lstatSync(directory,{throwIfNoEntry:false}),'SETUP_CLEAN_INSTALL_REQUIRED');
  const parents=()=>{for(const target of [profileDir,directory]){const parent=path.dirname(target);need(path.resolve(target)===target&&owned(parent).isDirectory()&&fs.realpathSync(parent)===parent,'SETUP_STATE_OWNER_REQUIRED');}};
  absent();parents();need(!signal?.aborted,'SETUP_CANCELLED');await stop();need(!signal?.aborted,'SETUP_CANCELLED');absent();parents();
  fs.mkdirSync(directory,{mode:0o700});fs.mkdirSync(path.join(directory,'candidate'),{mode:0o700});syncDirectory(directory);
  const state={schema:1,assuranceMode:'standard',installationTrack:'standard-install',preparationProtocolVersion:1,stagingProtocolVersion:2,treeIdentityVersion:3,id:crypto.randomUUID(),state:'prepared',profileDir,previousExisted:false,baseIdentity:null,approval:null,approvedIdentity:null,completedIdentity:null,startedAt:new Date().toISOString()};
  const tx=new StandardSetupTransaction(directory,state,{stop,signal});tx.save();return tx;
}

export async function beginSetupTransaction({profileDir,directory,stop,signal,cleanInstall=false}){
  if(cleanInstall===true)return beginFreshSetupTransaction({profileDir,directory,stop,signal});
  need(path.isAbsolute(profileDir)&&path.isAbsolute(directory)&&!directory.startsWith(profileDir+path.sep),'SETUP_TRANSACTION_PATH');
  need(typeof cleanInstall==='boolean','SETUP_CLEAN_INSTALL_REQUIRED');
  if(cleanInstall)need(!fs.lstatSync(profileDir,{throwIfNoEntry:false})&&!fs.lstatSync(directory,{throwIfNoEntry:false}),'SETUP_CLEAN_INSTALL_REQUIRED');
  const sourceCleanRuntime=cleanInstall?null:await inheritedCleanRuntime({profileDir,directory,stop,signal});
  if(exists(directory)){owned(directory);const file=path.join(directory,'transaction.json');
    if(exists(file)){
      owned(file);const state=read(file);need(state.schema===1&&state.profileDir===profileDir,'SETUP_TRANSACTION_IDENTITY');
      const tx=new SetupTransaction(directory,state,{stop,signal});
      if(['publishing','published','sealed','safe-stop-required'].includes(state.state)){tx.preserveRecoveryEvidence();await tx.rollback();}
      // Published candidates contain rebased live paths. Keep a failed attempt
      // and its exact record intact; never rename it back into a mutable draft.
      if(['prepared','approved'].includes(state.state)){
        need(state.baseIdentity===tx.identity(profileDir),'SETUP_CANDIDATE_BASE_CHANGED');
        // Legacy identity versions and legacy staging protocols retain their
        // original evidence. Archive the entire directory without rewriting
        // its record or candidate, only after verifying the recorded live base.
        if(state.treeIdentityVersion===3&&state.stagingProtocolVersion===SETUP_STAGING_PROTOCOL_VERSION&&state.runtimeSecurityVersion===SETUP_RUNTIME_SECURITY_VERSION&&state.preparationProtocolVersion===SETUP_PREPARATION_PROTOCOL_VERSION&&state.preparationReceipt===undefined&&!state.approvalWriteFailed&&!approvalIntentPresent(directory)&&!fs.lstatSync(path.join(directory,'state-preparation-in-progress.json'),{throwIfNoEntry:false})&&!state.primaryFailureCode&&!state.rollbackFailureCode){
          // A saved candidate does not prove its registered services stayed
          // stopped between attempts. Verify shutdown and the live base again
          // before changing the saved approval or allowing candidate writes.
          await stop();tx.check();
          need(state.baseIdentity===tx.identity(profileDir),'SETUP_CANDIDATE_BASE_CHANGED');
          // Validate the saved candidate before setup refresh can write into
          // its workspace. Only the generated top-level runtime tree is exempt.
          need(profileRoot(tx.candidate),'SETUP_STATE_FILE_UNSUPPORTED');
          tx.identity(tx.candidate);
          state.state='prepared';state.approval=null;state.approvedIdentity=null;state.completedIdentity=null;delete state.completedIdentityKind;delete state.approvedSecurityRecord;delete state.sealedSecurityIdentity;delete state.runtimeSecurityRecord;delete state.authStaging;tx.save();return tx;
        }
      }
      const archive=directory+'-archive-'+state.id;
      need(path.dirname(archive)===path.dirname(directory),'SETUP_TRANSACTION_IDENTITY');
      fs.renameSync(directory,exists(archive)?archive+'-'+crypto.randomUUID():archive);
    }else fs.renameSync(directory,directory+'-interrupted-'+crypto.randomUUID());
  }
  await stop();need(!signal?.aborted,'SETUP_CANCELLED');
  if(cleanInstall)need(!fs.lstatSync(profileDir,{throwIfNoEntry:false})&&!fs.lstatSync(directory,{throwIfNoEntry:false}),'SETUP_CLEAN_INSTALL_REQUIRED');
  privateDir(directory);
  const snapshots=new SQLiteSnapshots();
  try{
    const state={schema:1,...(cleanInstall?{installationTrack:'clean-install',cleanRuntimeGeneration:0,componentEvidenceVersion:1,componentEvidence:{observations:[]}}:sourceCleanRuntime?{installationTrack:'clean-maintenance',sourceCleanRuntime,cleanRuntimeGeneration:sourceCleanRuntime.generation+1,componentEvidenceVersion:1,componentEvidence:{observations:[]}}:{}),preparationProtocolVersion:SETUP_PREPARATION_PROTOCOL_VERSION,runtimeSecurityVersion:SETUP_RUNTIME_SECURITY_VERSION,stagingProtocolVersion:SETUP_STAGING_PROTOCOL_VERSION,treeIdentityVersion:3,id:crypto.randomUUID(),state:'preparing',profileDir,previousExisted:exists(profileDir),baseIdentity:null,approval:null,approvedIdentity:null,completedIdentity:null,startedAt:new Date().toISOString()};
    const tx=new SetupTransaction(directory,state,{stop,signal});tx.save();
    state.baseIdentity=profileIdentity(profileDir,{snapshots});tx.save();
    await checkedSnapshot(profileDir,tx.candidate,snapshots,state.baseIdentity);need(!signal?.aborted,'SETUP_CANCELLED');state.state='prepared';tx.save();return tx;
  }finally{snapshots.close();}
}

export async function restoreSetupTransaction(directory,{stop,signal}={}){const file=path.join(directory,'transaction.json');owned(file);const state=read(file);need(state.schema===1,'SETUP_TRANSACTION_IDENTITY');const tx=state.assuranceMode==='standard'?new StandardSetupTransaction(directory,state,{stop,signal}):new SetupTransaction(directory,state,{stop,signal});tx.preserveRecoveryEvidence();await tx.rollback();return transactionStatus(directory);}

export {assertAuthorizedOAuthChanges} from './setup-oauth-delta.mjs';
