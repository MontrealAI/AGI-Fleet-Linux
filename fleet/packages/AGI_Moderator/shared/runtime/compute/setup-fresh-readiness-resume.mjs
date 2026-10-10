import {deriveManagedGatewayAuthority,validateManagedGatewayAuthority} from './setup-managed-service.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {canonical,sha256,atomicWrite} from '../src/util.mjs';
import {inspectRetainedFreshOAuthAssociation,freshOAuthEvidenceTree} from './setup-fresh-oauth-resume.mjs';
import {captureRuntimeSecurityComponents,isRuntimeMutableFilesystemPath} from './setup-runtime-identity.mjs';
import {readComponentEvidence} from './setup-component-evidence.mjs';
import {validatePinnedControlUICache} from './setup-runtime-materialization.mjs';
import {verifyRuntimeArtifact} from './runtime-artifacts.mjs';
import {runtimeOwnerChecker} from './runtime-env.mjs';
import {classifyLaunchctlPrint} from './service-stop.mjs';
import {publicBrowserSocketsStopped} from './public-browser-runtime.mjs';
import {restoreServiceFiles} from './repair-backup.mjs';
import {withPrivateTemporary} from './setup-private-temp.mjs';
import {SQLiteSnapshots} from './setup-sqlite.mjs';
const historical=JSON.parse(fs.readFileSync(new URL('./fresh-readiness-1.18.6-source.json',import.meta.url)));
const CODE='CLEAN_INSTALL_READINESS_RESUME_UNAVAILABLE';
const need=(ok,predicate='evidence-contract')=>{if(!ok){const e=Error(CODE);e.freshReadinessDiagnostic={schema:'agi-fresh-readiness-diagnostic/v1',predicate};throw e;}};
const same=(a,b)=>canonical(a)===canonical(b),present=file=>Boolean(fs.lstatSync(file,{throwIfNoEntry:false}));
function bytes(file,uid,{runtime=false}={}){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===uid&&s.nlink===1&&!(s.mode&(runtime?0o022:0o077))&&s.size<=32*1024*1024,'private-evidence');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd);need(opened.ino===s.ino&&opened.dev===s.dev);const data=fs.readFileSync(fd),after=fs.lstatSync(file);need(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>after[k]===s[k]),'evidence-stable');return data;}finally{fs.closeSync(fd);}}
const json=(file,uid)=>JSON.parse(bytes(file,uid));
function dir(file,uid){const s=fs.lstatSync(file);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid&&!(s.mode&0o077)&&fs.realpathSync(file)===file,'private-canonical-directory');}
function sync(file){const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){atomicWrite(file,JSON.stringify(value,null,2));sync(path.dirname(file));}
function paths(o){const root=path.join(o.home,'.agi-genesis-setup-'+o.role);return {root,profileDir:path.join(o.home,o.role==='agent'?'.openclaw-agi-compute':'.openclaw-agi-node-compute'),directory:path.join(root,'transaction'),intentFile:path.join(root,'fresh-readiness-recovery.json')};}
const identity=(file,uid)=>freshOAuthEvidenceTree(file,uid).sha256;
const runtimeMachineKeys=new Set(['modelCatalog.remote','telemetry.updateCheck'].map(key=>sha256(canonical([['state_key',key]]))));
function compareComponents(expected,current,cachePaths,servicePaths=[]){
 for(const row of expected.components.immutableEntries.filter(row=>servicePaths.includes(row[0])))need(same(row,current.components.immutableEntries.find(v=>v[0]===row[0])),'existing-service-authority-unchanged');
 for(const relative of servicePaths)cachePaths.add(relative);
 const filter=entries=>entries.filter(row=>!cachePaths.has(row[0]));need(same(filter(expected.components.immutableEntries),filter(current.components.immutableEntries)),'immutable-authority-unchanged');
 need(same(Object.keys(expected.components.sqlite).sort(),Object.keys(current.components.sqlite).sort()),'sqlite-set-unchanged');
 for(const [relative,before] of Object.entries(expected.components.sqlite)){
  const after=current.components.sqlite[relative];need(same(Object.keys(before.tableDigests).sort(),Object.keys(after.tableDigests).sort()),'sqlite-security-table-set');
  for(const [table,old] of Object.entries(before.tableDigests)){
   const next=after.tableDigests[table];if(relative==='state/openclaw.sqlite'&&table==='config_machine_state'){
    need(!old.recordsTruncated&&!next.recordsTruncated&&old.records.length===old.recordCount&&next.records.length===next.recordCount,'complete-machine-state-evidence');
    for(const value of [old,next])need(new Set(value.records.map(row=>row.keySha256)).size===value.records.length,'unique-machine-state-evidence');
    const rows=value=>value.records.filter(row=>!runtimeMachineKeys.has(row.keySha256)).map(row=>[row.keySha256,row.sha256]).sort((a,b)=>a[0].localeCompare(b[0]));need(same(rows(old),rows(next)),'machine-state-authority-unchanged');
   }else need(old.sha256===next.sha256&&old.recordCount===next.recordCount,'sqlite-authority-unchanged');
  }
 }
}
/** No installed database is opened here: SQLite observation runs on a stopped
 * byte copy, while source hashes are checked on both sides of the observation. */
function observeStopped(o,p,state,settings){
 const artifact=verifyRuntimeArtifact(settings.openclaw,{allowedOwner:runtimeOwnerChecker()});need(artifact.version==='2026.9.5','pinned-runtime');
 const expected=readComponentEvidence(p.directory,state.componentEvidence.sealed,{transactionId:state.id,phase:'sealed-before-readiness',identityDigest:state.sealedSecurityIdentity});
 need(same(expected.identity,Object.fromEntries(['version','digest','immutableDigest','sqliteSecurityDigests','contract'].map(k=>[k,state.runtimeSecurityRecord[k]]))),'sealed-record-bound');
 const original=identity(p.profileDir,o.fileUID);
 return withPrivateTemporary('agi-fresh-readiness-observe-',temp=>{
  const copy=path.join(temp,'runtime-profile');copyPrivateProfile(p.profileDir,copy,o.fileUID);
  const cache=validatePinnedControlUICache(copy,artifact.packageRoot,{optional:true});
  const authority=deriveManagedGatewayAuthority(settings,copy),managed=validateManagedGatewayAuthority(settings,copy,authority,{optional:true});
  const captured=captureRuntimeSecurityComponents(copy,{...state.runtimeSecurityRecord.contract,runtimeMutabilityVersion:1},{completeDiagnostics:true});
  compareComponents(expected,captured,new Set(cache.map(row=>row[0])),managed.paths);need(identity(p.profileDir,o.fileUID)===original,'source-unchanged-during-observation');
  return {profileIdentity:original,authorityIdentity:captured.identity.digest,sealedComponentSHA256:state.componentEvidence.sealed.sha256,managedServiceAuthority:{digest:authority.digest,paths:managed.paths,present:managed.present}};
 },{uid:o.fileUID});
}

function copyPrivateProfile(source,target,uid){
 dir(source,uid);fs.mkdirSync(target,{mode:0o700});
 function copy(from,to,relative=''){for(const name of fs.readdirSync(from).sort()){const file=path.join(from,name),destination=path.join(to,name),rel=relative?relative+'/'+name:name,st=fs.lstatSync(file);if(rel==='plugin-skills'){need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===uid&&!(st.mode&0o022),'generated-skill-root');continue;}const runtime=isRuntimeMutableFilesystemPath(rel);need(!st.isSymbolicLink()&&st.uid===uid&&!(st.mode&(runtime?0o022:0o077)),'private-source-object');if(st.isDirectory()){fs.mkdirSync(destination,{mode:runtime?0o700:st.mode&0o777});copy(file,destination,rel);}else{need(st.isFile()&&st.nlink===1&&(!runtime||!(st.mode&0o111)),'regular-source-object');fs.writeFileSync(destination,bytes(file,uid,{runtime}),{flag:'wx',mode:runtime?0o600:st.mode&0o777});}}}copy(source,target);
}

const reports=['clean-install-intent.json','genesis-setup-progress.json','machine-preflight.json','setup-diagnostics.json','setup-result.html','desktop-diagnostics.json','security-review.json'];
function referencePaths(p,intent){need(intent.schema==='agi-fresh-readiness-recovery/v1'&&/^fresh-readiness-attempts\/attempt-[a-f0-9-]{36}$/.test(intent.archive),'recovery-reference');return {archive:path.join(p.root,intent.archive),retainedProfile:path.join(p.root,intent.archive,'runtime-profile'),retainedTransaction:path.join(p.root,intent.archive,'transaction')};}
function inspectIntent(o,p){const intent=json(p.intentFile,o.fileUID),r=referencePaths(p,intent);need(intent.kitIdentity===sha256(canonical({kit:o.kit,home:o.home,role:o.role,uid:o.uid,signerUID:o.signerUID}))&&['prepared','runtime-retained','transaction-retained','retained'].includes(intent.phase),'recovery-binding');dir(r.archive,o.fileUID);const live=present(p.profileDir),retained=present(r.retainedProfile);need(live!==retained,'runtime-rename-unambiguous');need(identity(live?p.profileDir:r.retainedProfile,o.fileUID)===intent.profileIdentity,'retained-runtime-unchanged');const current=present(p.directory),archived=present(r.retainedTransaction);need(current!==archived,'transaction-rename-unambiguous');need(identity(current?p.directory:r.retainedTransaction,o.fileUID)===intent.transactionIdentity,'retained-transaction-unchanged');for(const row of intent.reports){const f=path.join(r.archive,row.name);need(sha256(bytes(f,o.fileUID))===row.sha256,'retained-report-unchanged');}return {intent,...r};}
export function inspectFreshReadinessResume(o,{observe=true}={}){
 need(['agent','node'].includes(o.role),'documented-role-source-required');
 o={fileUID:process.getuid(),...o};const p=paths(o);const home=fs.lstatSync(o.home);need(home.isDirectory()&&!home.isSymbolicLink()&&home.uid===o.fileUID&&!(home.mode&0o022)&&fs.realpathSync(o.home)===o.home,'canonical-owned-home');dir(p.root,o.fileUID);need(o.uid>0&&o.uid!==o.signerUID&&o.kit.signerUID===o.signerUID,'signer-separated');
 const association=inspectRetainedFreshOAuthAssociation(o);
 if(present(p.intentFile))return {...p,...inspectIntent(o,p),association};
 dir(p.directory,o.fileUID);dir(p.profileDir,o.fileUID);
 const state=json(path.join(p.directory,'transaction.json'),o.fileUID),report=json(path.join(p.root,'setup-diagnostics.json'),o.fileUID),review=json(path.join(p.root,'security-review.json'),o.fileUID),settings=json(path.join(p.profileDir,'compute-settings.json'),o.fileUID),intent=json(path.join(p.root,'clean-install-intent.json'),o.fileUID);
 need(state.installationTrack==='clean-install'&&state.previousExisted===false&&state.baseIdentity===null&&state.treeIdentityVersion===3&&state.stagingProtocolVersion===2&&state.preparationProtocolVersion===1&&state.runtimeSecurityVersion===1&&state.componentEvidenceVersion===1&&state.cleanRuntimeGeneration===0,'fresh-approved-transaction');
 need(state.state==='safe-stop-required'&&state.primaryFailureCode==='SETUP_PROFILE_CHANGED'&&state.rollbackFailureCode==='SETUP_ROLLBACK_RUNTIME_CHANGED'&&state.completedIdentity===null&&state.runtimeSecurityRecord?.contract?.runtimeMutabilityVersion===undefined,'known-readiness-failure');
 need(intent.schema==='agi-clean-install-intent/v1'&&intent.protocolVersion===1&&intent.home===o.home&&intent.role===o.role&&intent.computeUID===o.uid&&intent.signerUID===o.signerUID,'released-intent-identity');
 need(intent.releaseVersion===(o.role==='agent'?'1.24.6':'2.25.6')&&report.versions?.fleet==='1.18.6'&&report.versions[o.role]===intent.releaseVersion&&report.transaction?.id===state.id&&report.transaction.state===state.state,'released-attempt-associated');
 need(association.binding.currentTransactionId===state.id&&association.binding.pending===null,'original-continuation-associated');
 need(state.approval===review.digest&&state.approvedIdentity===review.candidateIdentity&&report.securityReviewDigest===review.digest&&!present(path.join(p.directory,'approval-write-intent.json')),'approval-bound');
 need(report.installationTrack==='clean-install'&&report.passed===false&&report.recovery?.profile==='SAFE_STOP_REQUIRED'&&report.primaryFailureCode===state.primaryFailureCode&&report.rollbackFailureCode===state.rollbackFailureCode&&report.stages?.services==='failed'&&['preflight','docker','images','desktop','profile','oauth'].every(stage=>report.stages[stage]==='passed'),'reported-failure-bound');
 need(['walletAccessed','paidProviderCall','moneyMoved','publicOutput'].every(k=>report[k]===false),'no-operational-side-effects');
 need(['gateway','computePort','health'].every(k=>report.serviceReadiness?.[k]?.state==='passed')&&report.serviceReadiness.finalPolicy?.state==='passed'&&report.serviceReadiness.finalPolicy.policyHashMatches===true,'authenticated-readiness-passed');
 const h=report.serviceReadiness.health.history.at(-1)?.predicates;need(['policyHashMatches','stopped','roleMatches','gatewayReady','policyCurrent'].every(k=>h?.[k]===true),'all-health-predicates-passed');
 need(settings.role===o.role&&settings.signerUID===o.signerUID&&settings.token===o.kit.token&&settings.profileDir===p.profileDir&&settings.runtimeDependencies?.openclaw==='2026.9.5'&&Number.isSafeInteger(settings.maxRuns24h)&&settings.maxRuns24h>0&&Number.isSafeInteger(settings.maxImages24h)&&settings.maxImages24h>0,'compute-identity-and-limits');
 need(report.images.work===settings.imageID&&report.images.browser===settings.browserImageID&&same(settings.executionImageVerification.images,report.executionImages),'attempt-execution-images-associated');
 const approvedConfig=JSON.parse(bytes(path.join(p.profileDir,'openclaw.json'),o.fileUID));need(same(association.source.config.agents.defaults.modelPolicy,approvedConfig.agents.defaults.modelPolicy)&&same(association.source.config.meta?.migrations,approvedConfig.meta?.migrations),'model-policy-and-migrations-associated');
 need(report.packageManifestSHA256===historical[o.role].packageManifestSHA256&&same(report.sourceHashes,historical[o.role].sourceHashes),'released-package-integrity-associated');
 const observed=observe?observeStopped(o,p,state,settings):null;return {...p,association,state,settings,observed};
}
async function quiescent(o){need(o.platform==='darwin'&&typeof o.listen==='function'&&typeof o.spawn==='function','mac-quiescence-adapter');const suffix=o.role==='agent'?'agi-compute':'agi-node-compute';for(const label of ['ai.montreal.'+suffix,'ai.openclaw.'+suffix]){const r=o.spawn('/bin/launchctl',['print',`gui/${o.uid}/${label}`],{encoding:'utf8',stdio:'pipe',timeout:5000,maxBuffer:262144,shell:false,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});need(classifyLaunchctlPrint(r,label,o.uid,1).classification==='absent','managed-service-absent');}for(const port of o.role==='agent'?[18894,18896]:[18898,18900])need(await o.listen(port)===false,'managed-port-closed');need(await publicBrowserSocketsStopped({profileDir:paths(o).profileDir,uid:o.fileUID,platform:o.runtimePlatform??o.platform}),'runtime-sockets-absent');return true;}
export async function archiveFreshReadinessAttempt(o){
 o={fileUID:process.getuid(),...o};await quiescent(o);let f=inspectFreshReadinessResume(o),intent=f.intent;
 if(!intent){
  const parent=path.join(f.root,'fresh-readiness-attempts');if(!present(parent))fs.mkdirSync(parent,{mode:0o700});dir(parent,o.fileUID);
  const archive=path.join(parent,'attempt-'+crypto.randomUUID());fs.mkdirSync(archive,{mode:0o700});const saved=[];
  for(const name of reports){const data=bytes(path.join(f.root,name),o.fileUID);fs.writeFileSync(path.join(archive,name),data,{flag:'wx',mode:0o600});saved.push({name,sha256:sha256(data)});}sync(archive);
  intent={schema:'agi-fresh-readiness-recovery/v1',archive:path.relative(f.root,archive),kitIdentity:sha256(canonical({kit:o.kit,home:o.home,role:o.role,uid:o.uid,signerUID:o.signerUID})),transactionId:f.state.id,profileIdentity:f.observed.profileIdentity,authorityIdentity:f.observed.authorityIdentity,sealedComponentSHA256:f.observed.sealedComponentSHA256,transactionIdentity:identity(f.directory,o.fileUID),reports:saved,serviceBackup:f.state.serviceBackup,phase:'prepared'};save(f.intentFile,intent);
 }
 await quiescent(o);f=inspectFreshReadinessResume(o);const r=referencePaths(f,intent);
 if(present(f.profileDir)){fs.renameSync(f.profileDir,r.retainedProfile);sync(path.dirname(f.profileDir));sync(r.archive);intent.phase='runtime-retained';save(f.intentFile,intent);}
 if(present(f.directory)){need(identity(f.directory,o.fileUID)===intent.transactionIdentity,'transaction-stable-before-retention');fs.renameSync(f.directory,r.retainedTransaction);sync(f.root);sync(r.archive);intent.phase='transaction-retained';save(f.intentFile,intent);}
 const stopped=()=>quiescent(o);await restoreServiceFiles(intent.serviceBackup,{home:o.home,stop:stopped});intent.phase='retained';save(f.intentFile,intent);
 const settings=json(path.join(r.retainedProfile,'compute-settings.json'),o.fileUID),config=json(path.join(r.retainedProfile,'openclaw.json'),o.fileUID),binding=f.association.binding;binding.currentTransactionId=null;binding.failureIdentity=null;binding.phase='ready-to-prepare';binding.readinessRecovery={archive:intent.archive,transactionId:intent.transactionId,profileIdentity:intent.profileIdentity,transactionIdentity:intent.transactionIdentity};save(path.join(f.root,'fresh-oauth-continuation.json'),binding);
 // The new release binds the complete retained source; it never rewrites IDs or
 // approvals in the old transaction. Current credentials are copied from it.
 const receipt={...intent,retainedArchiveSHA256:identity(r.archive,o.fileUID),originalEvidencePreserved:true,sourceSQLiteOpened:false,legacyProfileImported:false};
 return {root:f.root,archive:f.association.source.archive,sourceDirectory:r.archive,sourceIdentity:receipt.retainedArchiveSHA256,fileUID:o.fileUID,roles:f.association.source.roles,modelPolicy:structuredClone(config.agents.defaults.modelPolicy??null),metaMigrations:structuredClone(config.meta?.migrations??null),limits:{maxRuns24h:settings.maxRuns24h,maxImages24h:settings.maxImages24h},readinessRecovery:receipt,receipt:{...f.association.binding.source,readinessRecovery:receipt,retainedAttempts:f.association.binding.retained,bindingVersion:2}};
}
/** Preserve committed current-schema state and journals on private copies.
 * This path admits one released clean attempt; no legacy schema is migrated. */
export function seedFreshReadinessState(c,candidate,profileDir){
 need(c.readinessRecovery?.schema==='agi-fresh-readiness-recovery/v1'&&identity(c.sourceDirectory,c.fileUID)===c.sourceIdentity,'retained-source-stable');
 const source=path.join(c.sourceDirectory,'runtime-profile');
 withPrivateTemporary('agi-fresh-readiness-copy-',temp=>{
  const file=path.join(temp,'state/openclaw.sqlite');fs.mkdirSync(path.dirname(file),{mode:0o700});for(const suffix of ['','-wal','-shm','-journal'])if(present(path.join(source,'state/openclaw.sqlite')+suffix))fs.writeFileSync(file+suffix,bytes(path.join(source,'state/openclaw.sqlite')+suffix,c.fileUID),{flag:'wx',mode:0o600});
  const snapshots=new SQLiteSnapshots();let data;try{data=snapshots.initial(file);snapshots.assertStable();}finally{snapshots.close();}fs.mkdirSync(path.join(candidate,'state'),{mode:0o700});fs.writeFileSync(path.join(candidate,'state/openclaw.sqlite'),data,{flag:'wx',mode:0o600});
  for(const name of ['config-journal-fingerprint.key','compute-journal.json'])if(present(path.join(source,name)))fs.writeFileSync(path.join(candidate,name),bytes(path.join(source,name),c.fileUID),{flag:'wx',mode:0o600});
 },{uid:c.fileUID});need(identity(c.sourceDirectory,c.fileUID)===c.sourceIdentity,'source-unchanged-after-state-copy');
}

export function safeFreshReadinessDiagnostic(value){return value?.schema==='agi-fresh-readiness-diagnostic/v1'&&typeof value.predicate==='string'&&/^[a-z-]{1,100}$/.test(value.predicate)?{schema:value.schema,predicate:value.predicate}:null;}
export async function recoverFreshReadinessLock(o){const p=paths(o);if(!present(path.join(p.root,'installer.lock')))return;const lock=json(path.join(p.root,'installer.lock'),o.fileUID);need(Number.isSafeInteger(lock.pid)&&lock.pid>0,'installer-lock-valid');try{process.kill(lock.pid,0);need(false,'concurrent-installer');}catch(e){if(e.code!=='ESRCH')throw e;}await quiescent(o);inspectFreshReadinessResume(o);const retained=path.join(p.root,'fresh-readiness-stale-lock-'+crypto.randomUUID()+'.json');fs.renameSync(path.join(p.root,'installer.lock'),retained);sync(p.root);}
