import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {captureRuntimeSecurityIdentity} from '../compute/setup-runtime-identity.mjs';
import {observeTransactionRuntimeIdentity,safeTransactionRuntimeObservation,safeRuntimeObservationFailure} from '../compute/setup-runtime-observation.mjs';
import {seedRuntime,runtimeAgents,runtimeReceipt} from './runtime-sqlite-fixture.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
function fixture(t,role='agent'){
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-observation-test-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const profileDir=path.join(home,role==='agent'?'.openclaw-agi-compute':'.openclaw-agi-node-compute'),directory=path.join(home,'.agi-genesis-setup-'+role,'transaction'),transactionFile=path.join(directory,'transaction.json');
 write(path.join(profileDir,'openclaw.json'),{gateway:{bind:'loopback'},auth:{secret:'DO_NOT_EXPORT_SECRET'}});write(path.join(profileDir,'compute-settings.json'),{maxRuns24h:48,maxImages24h:8});write(path.join(profileDir,'COMPUTE_STOP'),'preserve stop marker\n');
 seedRuntime(profileDir);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const record=captureRuntimeSecurityIdentity(profileDir,{profileDir,phase:'sealed',authStaging:runtimeAgents.map(runtimeReceipt),registryAliases:[path.join(directory,'candidate')]});
 const state={schema:1,id:'110eb5c2-5163-4cae-bb41-e5d01c0c62d8',profileDir,state:'safe-stop-required',treeIdentityVersion:3,stagingProtocolVersion:2,runtimeSecurityVersion:1,runtimeSecurityRecord:record,sealedSecurityIdentity:record.digest,primaryFailureCode:'SETUP_PROFILE_CHANGED',rollbackFailureCode:'SETUP_ROLLBACK_RUNTIME_CHANGED'};
 write(transactionFile,state);return {home,role,profileDir,directory,transactionFile,state,observe:()=>observeTransactionRuntimeIdentity({home,role,profileDir})};
}
function evidence(root){const entries={};const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file,{bigint:true}),relative=path.relative(root,file);entries[relative]={type:s.isFile()?'file':s.isDirectory()?'directory':'link',mode:String(s.mode),uid:String(s.uid),ino:String(s.ino),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs)};if(s.isDirectory())visit(file);else if(s.isFile())entries[relative].sha256=sha(fs.readFileSync(file));else entries[relative].link=fs.readlinkSync(file);}};visit(root);return entries;}

for(const role of ['agent','node'])test(`${role}: current stopped observation leaves profile, transaction, stop marker, WAL and journal bytes unchanged`,t=>{
 const f=fixture(t,role),elsewhere=path.join(f.home,'isolated-writer');fs.mkdirSync(path.join(elsewhere,'state'),{recursive:true,mode:0o700});
 const live=path.join(f.profileDir,'state/openclaw.sqlite'),staged=path.join(elsewhere,'state/openclaw.sqlite');fs.copyFileSync(live,staged);
 const db=new DatabaseSync(staged);db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('observation.fixture-protected',JSON.stringify({fixture:'NEVER_EXPORTED_VALUE'}),1);
 fs.copyFileSync(staged,live);fs.copyFileSync(staged+'-wal',live+'-wal');fs.chmodSync(live+'-wal',0o600);db.close();fs.rmSync(elsewhere,{recursive:true});
 // The synthetic source is deliberately arranged as committed main+WAL with
 // no SHM; no SQLite connection to this source remains open during collection.
 fs.rmSync(live+'-shm',{force:true});
 fs.writeFileSync(live+'-journal','',{mode:0o600});assert.equal(fs.existsSync(live+'-shm'),false);
 const before=evidence(f.home),result=f.observe();assert.deepEqual(evidence(f.home),before);assert.equal(fs.existsSync(live+'-shm'),false);
 assert.equal(result.source.sourceSQLiteOpened,false);assert.equal(result.source.sourceWritten,false);assert.equal(result.source.stable,true);assert.equal(result.historicalCauseEstablished,false);assert.equal(result.rollbackAuthorized,false);
 assert.notEqual(result.diagnostic.expected.sqliteSecurityDigests['state/openclaw.sqlite'],result.diagnostic.actual.sqliteSecurityDigests['state/openclaw.sqlite']);
 assert.equal(result.transaction.recordSha256,sha(fs.readFileSync(f.transactionFile)));assert.deepEqual(safeTransactionRuntimeObservation(result),result);
 for(const secret of [f.home,'DO_NOT_EXPORT_SECRET','NEVER_EXPORTED_VALUE','observation.fixture-protected'])assert.equal(JSON.stringify(result).includes(secret),false);
});

test('generated top-level plugin-skills links are never followed; redirected root and every other link fail closed',t=>{
 const f=fixture(t),generated=path.join(f.profileDir,'plugin-skills');fs.mkdirSync(generated,{mode:0o700});fs.symlinkSync('/not-readable-and-not-followed',path.join(generated,'browser-automation'));
 const before=evidence(f.home),observation=f.observe();assert.equal(observation.status,'OBSERVED');assert.equal(observation.diagnostic.captureFailureCode,null);assert.equal(observation.diagnostic.actual.digest,observation.diagnostic.expected.digest);assert.deepEqual(evidence(f.home),before);
 fs.symlinkSync('/not-readable',path.join(f.profileDir,'unexpected-link'));assert.throws(f.observe,/SETUP_STATE_OWNER_REQUIRED/);fs.unlinkSync(path.join(f.profileDir,'unexpected-link'));
 fs.renameSync(generated,generated+'-retained');fs.symlinkSync(generated+'-retained',generated);assert.throws(f.observe,/SETUP_STATE_OWNER_REQUIRED/);
});

test('an exact recognized SHM is checked but omitted from the disposable copy, and unknown SHM links are rejected',t=>{
 const f=fixture(t),shm=path.join(f.profileDir,'state/openclaw.sqlite-shm');fs.writeFileSync(shm,'untouched source shm',{mode:0o600});
 const before=evidence(f.home),observation=f.observe();assert.equal(observation.diagnostic.captureFailureCode,null);assert.equal(observation.diagnostic.actual.digest,observation.diagnostic.expected.digest);assert.deepEqual(evidence(f.home),before);
 fs.unlinkSync(shm);fs.symlinkSync('/not-readable',shm);assert.throws(f.observe,/SETUP_STATE_OWNER_REQUIRED/);
});

test('wrong owner, hardlinks and writable profile state are refused without mutation',t=>{
 const f=fixture(t),config=path.join(f.profileDir,'openclaw.json'),before=evidence(f.home),getuid=process.getuid;
 t.mock.method(process,'getuid',()=>getuid()+1);assert.throws(f.observe,/SETUP_STATE_OWNER_REQUIRED/);t.mock.restoreAll();assert.deepEqual(evidence(f.home),before);
 fs.linkSync(config,path.join(f.home,'hardlink'));assert.throws(f.observe,/SETUP_STATE_OWNER_REQUIRED/);fs.unlinkSync(path.join(f.home,'hardlink'));
 fs.chmodSync(config,0o666);assert.throws(f.observe,/SETUP_STATE_OWNER_REQUIRED/);
});

test('home traversal, role/path mismatch, transaction redirection and foreign registry aliases are refused',t=>{
 const f=fixture(t);
 assert.throws(()=>observeTransactionRuntimeIdentity({...f,profileDir:f.profileDir+'/../'+path.basename(f.profileDir)}),/REPAIR_RUNTIME_OBSERVATION_PATH/);
 assert.throws(()=>observeTransactionRuntimeIdentity({...f,role:'node'}),/REPAIR_RUNTIME_OBSERVATION_PATH/);
 const original=fs.readFileSync(f.transactionFile);f.state.runtimeSecurityRecord.contract.registryAliases=[path.join(f.home,'foreign/candidate')];write(f.transactionFile,f.state);assert.throws(f.observe,/REPAIR_RUNTIME_TRANSACTION_INVALID/);
 fs.writeFileSync(f.transactionFile,original);fs.renameSync(f.transactionFile,f.transactionFile+'.retained');fs.symlinkSync(f.transactionFile+'.retained',f.transactionFile);assert.throws(f.observe,/SETUP_STATE_OWNER_REQUIRED/);
});

test('concurrent source content and transaction changes invalidate observation rather than return stale evidence',t=>{
 for(const target of ['profile','transaction']){
  const f=fixture(t),read=fs.readSync,changedFile=target==='profile'?path.join(f.profileDir,'compute-settings.json'):f.transactionFile;let changed=false;
  t.mock.method(fs,'readSync',(fd,buffer,offset,length,position)=>{const count=read(fd,buffer,offset,length,position);if(!changed&&fs.fstatSync(fd).ino===fs.statSync(path.join(f.profileDir,'openclaw.json')).ino){changed=true;fs.appendFileSync(changedFile,' ');}return count;});
  assert.throws(f.observe,/SETUP_PROFILE_CHANGED/);assert.equal(changed,true);t.mock.restoreAll();
 }
});

test('oversized input is rejected before allocating or opening SQLite and unexpected output fields are not exported',t=>{
 const f=fixture(t),large=path.join(f.profileDir,'large-file');const fd=fs.openSync(large,'wx',0o600);fs.ftruncateSync(fd,128*1024*1024+1);fs.closeSync(fd);
 assert.throws(f.observe,/REPAIR_RUNTIME_OBSERVATION_LIMIT/);fs.unlinkSync(large);
 const result=f.observe();for(const addition of [{...result,raw:'SECRET'}, {...result,source:{...result.source,raw:'SECRET'}}, {...result,transaction:{...result.transaction,profileDir:f.profileDir}}, {...result,transaction:{...result.transaction,primaryFailureCode:'SETUP_PRIVATE_SECRET_VALUE'}}, {...result,transaction:{...result.transaction,rollbackFailureCode:'SETUP_PRIVATE_SECRET_VALUE'}}, {...result,timing:'before-health'}, {...result,rollbackAuthorized:true}])assert.equal(safeTransactionRuntimeObservation(addition),null);
 write(f.transactionFile,{...f.state,primaryFailureCode:'SETUP_PRIVATE_SECRET_VALUE'});assert.throws(f.observe,/REPAIR_RUNTIME_TRANSACTION_INVALID/);
});

test('completion cannot be fabricated by diagnostics and unsupported transaction state is refused',t=>{
 const f=fixture(t);for(const state of ['complete','prepared','rolled-back']){write(f.transactionFile,{...f.state,state});assert.throws(f.observe,/REPAIR_RUNTIME_TRANSACTION_INVALID/);}write(f.transactionFile,{...f.state,runtimeSecurityVersion:2});assert.throws(f.observe,/REPAIR_RUNTIME_TRANSACTION_INVALID/);
});

test('legacy aggregate-only baseline identifies the changed component without inventing historical path details',t=>{
 const f=fixture(t);delete f.state.runtimeSecurityRecord.diagnosticDetails;write(f.transactionFile,f.state);fs.appendFileSync(path.join(f.profileDir,'openclaw.json'),' ');
 const before=evidence(f.home),result=f.observe();assert.deepEqual(evidence(f.home),before);assert.equal(result.diagnostic.legacyBaselineDetailAvailable,false);assert.equal(result.diagnostic.componentBaselineTrust,'unavailable');
 assert.notEqual(result.diagnostic.actual.immutableDigest,result.diagnostic.expected.immutableDigest);assert.equal(result.diagnostic.deltas.some(delta=>delta.kind==='immutable-tree'&&delta.reason==='digest-mismatch'),true);assert.equal(result.diagnostic.deltas.some(delta=>delta.path==='openclaw.json'),false);
});

test('current derived-cache capture failure is distinct from a captured aggregate mismatch and never permits rollback',t=>{
 const f=fixture(t);write(path.join(f.profileDir,'openclaw.json.last-good'),{old:'DO_NOT_EXPORT_SECRET'});const before=evidence(f.home),result=f.observe();
 assert.deepEqual(evidence(f.home),before);assert.equal(result.diagnostic.captureComplete,false);assert.equal(result.diagnostic.captureFailureCode,'SETUP_PROFILE_CHANGED');assert.equal(result.diagnostic.deltas.some(delta=>delta.kind==='derived-config'&&delta.reason==='derived-cache-not-equal'),true);assert.equal(result.rollbackAuthorized,false);assert.equal(result.historicalCauseEstablished,false);assert.equal(JSON.stringify(result).includes('DO_NOT_EXPORT_SECRET'),false);
});

test('bounded worker may use a parent-owned empty private temporary directory for reliable timeout cleanup',t=>{
 const f=fixture(t),temporaryRoot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-runtime-observation-')));fs.chmodSync(temporaryRoot,0o700);t.after(()=>fs.rmSync(temporaryRoot,{recursive:true,force:true}));
 const before=evidence(f.home),result=observeTransactionRuntimeIdentity({...f,temporaryRoot});assert.equal(result.status,'OBSERVED');assert.deepEqual(evidence(f.home),before);assert.equal(fs.existsSync(path.join(temporaryRoot,'profile')),true);
 assert.throws(()=>observeTransactionRuntimeIdentity({...f,temporaryRoot}),/REPAIR_RUNTIME_OBSERVATION_PATH/);
 assert.throws(()=>observeTransactionRuntimeIdentity({...f,temporaryRoot:f.home}),/REPAIR_RUNTIME_OBSERVATION_PATH/);
});

function failedObservation(action){let captured;assert.throws(action,error=>{captured=error;return true;});assert.ok(captured.runtimeObservationEvidence);assert.deepEqual(safeTransactionRuntimeObservation(captured.runtimeObservationEvidence),captured.runtimeObservationEvidence);assert.deepEqual(safeRuntimeObservationFailure(captured),captured.runtimeObservationEvidence.failure);return captured.runtimeObservationEvidence;}

test('v2 inventory names the sealed persisted baseline and distinguishes absent approved, completion and rollback records',t=>{
 const f=fixture(t),result=f.observe(),baseline=result.baseline;
 assert.equal(result.schema,'agi-transaction-runtime-observation/v2');assert.deepEqual(baseline.selected,{kind:'sealed',source:'transaction/transaction.json#/runtimeSecurityRecord',available:true});
 assert.equal(baseline.transactionRecord.exists,true);assert.equal(baseline.transactionRecord.readable,true);assert.equal(baseline.transactionRecord.sha256,sha(fs.readFileSync(f.transactionFile)));
 assert.equal(baseline.sealed.version,1);assert.equal(baseline.sealed.phase,'sealed');assert.equal(baseline.sealed.digest,f.state.sealedSecurityIdentity);assert.equal(baseline.sealed.immutableDigest,f.state.runtimeSecurityRecord.immutableDigest);assert.deepEqual(baseline.sealed.sqliteSecurityDigests,f.state.runtimeSecurityRecord.sqliteSecurityDigests);
 assert.equal(baseline.sealed.digestMatchesComponents,true);assert.equal(baseline.sealed.digestMatchesTransactionSeal,true);assert.equal(baseline.approved.exists,false);assert.equal(baseline.rollback.exists,false);assert.equal(baseline.completed.present,false);assert.equal(baseline.completed.independentPostReadinessRecord,false);
 assert.deepEqual(baseline.historicalFailureComparisonRecorded,{primary:false,rollback:false});assert.equal(result.progress.stage,'complete');assert.equal(result.progress.limits.transactionBytes,8*1024*1024);assert.equal(result.progress.limits.fileBytes,128*1024*1024);assert.equal(result.progress.elapsedMs>=0,true);
});

test('temporary-root mismatch exports the available legacy seal and exact missing historical component pointers before copying',t=>{
 const f=fixture(t);delete f.state.runtimeSecurityRecord.diagnosticDetails;write(f.transactionFile,f.state);const before=evidence(f.home);
 const result=failedObservation(()=>observeTransactionRuntimeIdentity({...f,temporaryRoot:f.home}));assert.deepEqual(evidence(f.home),before);
 assert.equal(result.status,'BLOCKED');assert.equal(result.failure.code,'REPAIR_RUNTIME_OBSERVATION_PATH');assert.equal(result.failure.stage,'temporary-root-validation');assert.equal(result.failure.artifact,'temporary-root');assert.equal(result.baseline.sealed.digest,f.state.sealedSecurityIdentity);assert.equal(result.baseline.sealed.digestMatchesComponents,true);assert.equal(result.baseline.historicalComponentReconstruction,'unavailable');
 assert.deepEqual(result.baseline.sealed.details.missingSourceArtifacts,['transaction/transaction.json#/runtimeSecurityRecord/diagnosticDetails/immutableEntries','transaction/transaction.json#/runtimeSecurityRecord/diagnosticDetails/sqlite']);assert.equal(result.source.copiedFiles,0);assert.equal(result.diagnostic,null);assert.equal(JSON.stringify(result).includes(f.home),false);
});

test('missing transaction file and unreadable transaction identify the exact artifact and native errno without raw errors',t=>{
 const f=fixture(t),bytes=fs.readFileSync(f.transactionFile);fs.unlinkSync(f.transactionFile);let result=failedObservation(f.observe);
 assert.equal(result.failure.stage,'transaction-read');assert.equal(result.failure.path,'transaction/transaction.json');assert.equal(result.failure.errno,'ENOENT');assert.equal(result.failure.code,'REPAIR_RUNTIME_OBSERVATION_IO_FAILED');assert.equal(result.baseline.transactionRecord.exists,false);assert.equal(result.baseline.transactionRecord.readable,false);assert.equal(result.baseline.sealed.exists,null);
 fs.writeFileSync(f.transactionFile,bytes,{mode:0o600});const before=evidence(f.home),open=fs.openSync;
 t.mock.method(fs,'openSync',(file,...rest)=>{if(file===f.transactionFile){const error=Error('PRIVATE_PATH '+f.home+' SECRET_OAUTH');error.code='EACCES';error.path=file;throw error;}return open(file,...rest);});
 result=failedObservation(f.observe);t.mock.restoreAll();assert.deepEqual(evidence(f.home),before);assert.equal(result.failure.errno,'EACCES');assert.equal(result.baseline.transactionRecord.exists,true);assert.equal(result.baseline.transactionRecord.readable,false);for(const secret of [f.home,'PRIVATE_PATH','SECRET_OAUTH'])assert.equal(JSON.stringify(result).includes(secret),false);
});

test('invalid receipts retain observed record hashes and inventory without permitting comparison',t=>{
 const f=fixture(t);write(f.transactionFile,'INVALID PRIVATE CONTENT');let result=failedObservation(f.observe);
 assert.equal(result.failure.stage,'transaction-parse');assert.equal(result.failure.code,'REPAIR_RUNTIME_TRANSACTION_INVALID');assert.equal(result.baseline.transactionRecord.sha256,sha(fs.readFileSync(f.transactionFile)));assert.equal(result.baseline.sealed.exists,null);
 const state=structuredClone(f.state);delete state.runtimeSecurityRecord;write(f.transactionFile,state);result=failedObservation(f.observe);assert.equal(result.failure.stage,'baseline-validation');assert.equal(result.baseline.sealed.exists,false);assert.equal(result.baseline.selected.available,false);assert.deepEqual(result.baseline.sealed.details.missingSourceArtifacts,['transaction/transaction.json#/runtimeSecurityRecord']);assert.equal(result.diagnostic,null);
 f.state.runtimeSecurityRecord.digest='0'.repeat(64);write(f.transactionFile,f.state);result=failedObservation(f.observe);assert.equal(result.baseline.sealed.exists,true);assert.equal(result.baseline.sealed.digestMatchesComponents,false);assert.equal(result.baseline.sealed.digestMatchesTransactionSeal,false);assert.equal(result.source.copiedFiles,0);
});

test('copy ownership and size failures preserve partial inventory and expose only known paths or opaque hashes',t=>{
 const f=fixture(t),secretPath='PRIVATE_CUSTOMER_NAME-secret-file',target=path.join(f.profileDir,secretPath);fs.symlinkSync('/PRIVATE_EXTERNAL_SECRET',target);let before=evidence(f.home),result=failedObservation(f.observe);assert.deepEqual(evidence(f.home),before);
 assert.equal(result.failure.stage,'copy-profile');assert.equal(result.failure.artifact,'live-profile');assert.equal(result.failure.code,'SETUP_STATE_OWNER_REQUIRED');assert.equal(result.failure.path,null);assert.equal(result.failure.pathSha256,sha(secretPath));assert.equal(result.baseline.sealed.digest,f.state.sealedSecurityIdentity);for(const secret of [f.home,secretPath,'PRIVATE_EXTERNAL_SECRET'])assert.equal(JSON.stringify(result).includes(secret),false);
 fs.unlinkSync(target);const config=path.join(f.profileDir,'openclaw.json');fs.chmodSync(config,0o666);result=failedObservation(f.observe);assert.equal(result.failure.path,'openclaw.json');assert.equal(result.failure.code,'SETUP_STATE_OWNER_REQUIRED');fs.chmodSync(config,0o600);
 const fd=fs.openSync(target,'wx',0o600);fs.ftruncateSync(fd,128*1024*1024+1);fs.closeSync(fd);before=evidence(f.home);result=failedObservation(f.observe);assert.deepEqual(evidence(f.home),before);assert.equal(result.failure.code,'REPAIR_RUNTIME_OBSERVATION_LIMIT');assert.equal(result.failure.stage,'copy-profile');assert.equal(result.source.sourceSQLiteOpened,false);assert.equal(result.source.sourceWritten,false);assert.equal(result.progress.limits.fileBytes,128*1024*1024);assert.equal(result.baseline.transactionRecord.readable,true);
});

test('historical v1 observations remain accepted and new failures cannot smuggle paths, errors or secret fields',t=>{
 const f=fixture(t),result=f.observe(),legacy={...result,schema:'agi-transaction-runtime-observation/v1'};delete legacy.baseline;delete legacy.progress;delete legacy.failure;delete legacy.localization;assert.deepEqual(safeTransactionRuntimeObservation(legacy),legacy);
 const safe=safeRuntimeObservationFailure({code:'EACCES',message:'PRIVATE SECRET',stage:'copy-profile',artifact:'live-profile',path:'/Users/PRIVATE_HOME/SECRET'});assert.equal(safe.code,'REPAIR_RUNTIME_OBSERVATION_IO_FAILED');assert.equal(safe.errno,'EACCES');assert.equal(safe.path,null);assert.equal(safe.pathSha256,sha('/Users/PRIVATE_HOME/SECRET'));assert.deepEqual(safeRuntimeObservationFailure(safe),safe);assert.equal(JSON.stringify(safe).includes('PRIVATE'),false);
 assert.equal(safeRuntimeObservationFailure({code:'PRIVATE_TOKEN',message:'PRIVATE_TOKEN',stage:'SECRET',artifact:'SECRET'}).code,'REPAIR_RUNTIME_OBSERVATION_FAILED');
 for(const modified of [{...result,baseline:{...result.baseline,raw:'SECRET'}},{...result,progress:{...result.progress,path:'/PRIVATE/SECRET'}},{...result,baseline:{...result.baseline,sealed:{...result.baseline.sealed,contract:{secret:'PRIVATE'}}}},{...result,baseline:{...result.baseline,sealed:{...result.baseline.sealed,details:{...result.baseline.sealed.details,missingSourceArtifacts:['/PRIVATE/SECRET']}}}}])assert.equal(safeTransactionRuntimeObservation(modified),null);
});

test('owned and supplied temporary paths inside the live profile or setup tree are rejected before mutation',t=>{
 for(const target of ['profile','setup']){
  const f=fixture(t),base=target==='profile'?f.profileDir:path.dirname(f.directory);t.mock.method(os,'tmpdir',()=>base);const before=evidence(f.home);
  let result=failedObservation(f.observe);assert.deepEqual(evidence(f.home),before);assert.equal(result.failure.stage,'temporary-root-validation');assert.equal(result.failure.code,'REPAIR_RUNTIME_OBSERVATION_PATH');assert.equal(result.source.stable,null);assert.equal(result.baseline.sealed.exists,true);
  result=failedObservation(()=>observeTransactionRuntimeIdentity({...f,temporaryRoot:path.join(base,'agi-runtime-observation-Abc123')}));assert.deepEqual(evidence(f.home),before);assert.equal(result.failure.stage,'temporary-root-validation');t.mock.restoreAll();
 }
});

test('malformed SQLite detail presence does not claim reconstructable historical components',t=>{
 const f=fixture(t);f.state.runtimeSecurityRecord.diagnosticDetails.sqlite=Object.fromEntries(Object.keys(f.state.runtimeSecurityRecord.sqliteSecurityDigests).map(relative=>[relative,{tableDigests:{}}]));write(f.transactionFile,f.state);
 const result=failedObservation(()=>observeTransactionRuntimeIdentity({...f,temporaryRoot:f.home}));assert.equal(result.baseline.sealed.details.immutableEntries,'available');assert.equal(result.baseline.sealed.details.sqliteTables,'invalid');assert.equal(result.baseline.historicalComponentReconstruction,'unavailable');assert.equal(result.source.stable,null);
});

function retainPrevious(f){const previous=path.join(f.directory,'previous');fs.cpSync(f.profileDir,previous,{recursive:true});fs.chmodSync(previous,0o700);return previous;}

for(const role of ['agent','node'])test(`${role}: previous copy binds state rows and bounded immutable reconstruction only through exact sealed hashes`,t=>{
 const f=fixture(t,role),previous=retainPrevious(f);delete f.state.runtimeSecurityRecord.diagnosticDetails;write(f.transactionFile,f.state);
 for(const agent of runtimeAgents)write(path.join(f.profileDir,'agents',agent,'agent/models.json'),{privateCredential:'PRIVATE_MODEL_MATERIAL'});
 write(path.join(f.profileDir,'config-journal-fingerprint.key'),'PRIVATE_RANDOM_FINGERPRINT');
 const file=path.join(f.profileDir,'state/openclaw.sqlite'),db=new DatabaseSync(file);db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('PRIVATE_DYNAMIC_KEY',JSON.stringify({token:'PRIVATE_STATE_VALUE'}),1);db.close();
 const before=evidence(f.home),result=f.observe(),local=result.localization;
 assert.deepEqual(evidence(f.home),before);assert.equal(result.status,'OBSERVED');assert.equal(local.previous.status,'COPIED');assert.equal(local.previous.stable,true);assert.equal(local.previous.sourceSQLiteOpened,false);assert.equal(local.previous.sourceWritten,false);
 assert.equal(local.immutable.status,'MATCHED');assert.equal(local.immutable.reason,'bounded-reconstruction-matches-seal');assert.equal(local.immutable.deltas.length,4);assert.ok(local.immutable.deltas.every(delta=>delta.expectedSha256===null&&delta.reason==='added'));
 assert.equal(local.state.status,'LOCALIZED');assert.equal(local.state.baseline.matchesSealed,true);assert.equal(local.state.baseline.candidateSha256,f.state.runtimeSecurityRecord.sqliteSecurityDigests['state/openclaw.sqlite']);assert.equal(local.state.matchesObservedAggregate,true);
 assert.ok(local.state.deltas.some(delta=>delta.kind==='record'&&delta.table==='config_machine_state'&&delta.reason==='added'));assert.equal(local.state.historicalCauseEstablished,false);assert.equal(local.state.reconciliationAuthorized,false);
 const unavailablePrevious={source:'transaction/previous',status:'MISSING',stable:null,copiedFiles:0,copiedBytes:0,sourceSQLiteOpened:false,sourceWritten:false,failure:{code:'REPAIR_RUNTIME_OBSERVATION_IO_FAILED',errno:'ENOENT',stage:'previous-profile-boundaries',artifact:'previous-profile',path:'transaction/previous',pathSha256:null}};
 assert.equal(safeTransactionRuntimeObservation({...result,localization:{...local,previous:unavailablePrevious}}),null);
 assert.equal(safeTransactionRuntimeObservation({...result,localization:{...local,previous:unavailablePrevious,immutable:null}}),null);
 assert.equal(safeTransactionRuntimeObservation({...result,localization:{...local,previous:unavailablePrevious,state:null}}),null);
 assert.deepEqual(safeTransactionRuntimeObservation(result),result);for(const secret of [f.home,previous,'DO_NOT_EXPORT_SECRET','PRIVATE_MODEL_MATERIAL','PRIVATE_RANDOM_FINGERPRINT','PRIVATE_DYNAMIC_KEY','PRIVATE_STATE_VALUE'])assert.equal(JSON.stringify(result).includes(secret),false);
});

test('missing or unsafe previous artifacts preserve successful current observation with explicit locality and unavailable baselines',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.profileDir,'openclaw.json'),' ');let result=f.observe();
 assert.equal(result.status,'OBSERVED');assert.equal(result.localization.previous.status,'MISSING');assert.equal(result.localization.previous.failure.path,'transaction/previous');assert.equal(result.localization.previous.failure.errno,'ENOENT');assert.equal(result.localization.state.status,'BASELINE_UNAVAILABLE');assert.equal(result.localization.immutable.status,'UNAVAILABLE');assert.equal(result.localization.failure,null);
 const previous=retainPrevious(f),external=path.join(f.home,'PRIVATE_EXTERNAL');fs.renameSync(previous,external);fs.symlinkSync(external,previous);let before=evidence(f.home);result=f.observe();assert.deepEqual(evidence(f.home),before);
 assert.equal(result.status,'OBSERVED');assert.equal(result.source.stable,true);assert.equal(result.localization.previous.status,'BLOCKED');assert.equal(result.localization.previous.failure.code,'SETUP_STATE_OWNER_REQUIRED');assert.equal(result.localization.previous.failure.stage,'previous-profile-boundaries');assert.equal(result.localization.state.status,'BASELINE_UNAVAILABLE');
 fs.unlinkSync(previous);fs.renameSync(external,previous);fs.symlinkSync('/PRIVATE_MISSING_TARGET',path.join(previous,'zz-PRIVATE_CUSTOMER'));before=evidence(f.home);result=f.observe();assert.deepEqual(evidence(f.home),before);
 assert.equal(result.status,'OBSERVED');assert.equal(result.localization.previous.status,'BLOCKED');assert.equal(result.localization.previous.failure.stage,'copy-previous');assert.equal(result.localization.previous.failure.path,null);assert.equal(result.localization.previous.failure.pathSha256,sha('zz-PRIVATE_CUSTOMER'));assert.equal(result.localization.previous.copiedFiles>0,true);assert.equal(JSON.stringify(result).includes('PRIVATE_CUSTOMER'),false);assert.equal(JSON.stringify(result).includes('PRIVATE_MISSING_TARGET'),false);
});

test('a concurrent previous source change invalidates only auxiliary baselines and keeps current read-only observation',t=>{
 const f=fixture(t),previous=retainPrevious(f),target=path.join(previous,'openclaw.json'),read=fs.readSync;let changed=false;
 t.mock.method(fs,'readSync',(fd,...args)=>{const count=read(fd,...args);if(!changed&&fs.fstatSync(fd).ino===fs.statSync(target).ino){changed=true;fs.appendFileSync(target,' ');}return count;});
 const result=f.observe();t.mock.restoreAll();assert.equal(changed,true);assert.equal(result.status,'OBSERVED');assert.equal(result.source.stable,true);assert.equal(result.localization.previous.status,'BLOCKED');assert.equal(result.localization.previous.stable,false);assert.equal(result.localization.previous.failure.code,'SETUP_PROFILE_CHANGED');assert.equal(result.localization.state.status,'BASELINE_UNAVAILABLE');assert.equal(result.localization.state.deltas.length,0);
});

test('current source changes during auxiliary previous copying still block the main observation',t=>{
 const f=fixture(t),previous=retainPrevious(f),trigger=path.join(previous,'openclaw.json'),target=path.join(f.profileDir,'openclaw.json'),read=fs.readSync;let changed=false;
 t.mock.method(fs,'readSync',(fd,...args)=>{const count=read(fd,...args);if(!changed&&fs.fstatSync(fd).ino===fs.statSync(trigger).ino){changed=true;fs.appendFileSync(target,' ');}return count;});
 const result=failedObservation(f.observe);t.mock.restoreAll();assert.equal(changed,true);assert.equal(result.status,'BLOCKED');assert.equal(result.source.stable,false);assert.equal(result.failure.code,'SETUP_PROFILE_CHANGED');assert.equal(result.failure.artifact,'live-profile');assert.equal(result.failure.path,'openclaw.json');
});

test('previous bytes need a sealed match and optional v2 localization is bounded and cannot authorize recovery',t=>{
 const f=fixture(t),previous=retainPrevious(f),db=new DatabaseSync(path.join(previous,'state/openclaw.sqlite'));db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('PRIVATE_PREVIOUS_KEY',JSON.stringify({token:'PRIVATE_PREVIOUS_VALUE'}),1);db.close();
 const result=f.observe();assert.equal(result.status,'OBSERVED');assert.equal(result.localization.previous.status,'COPIED');assert.equal(result.localization.state.status,'BASELINE_MISMATCH');assert.equal(result.localization.state.baseline.matchesSealed,false);assert.equal(result.localization.state.deltas.length,0);
 const historical={...result};delete historical.localization;assert.deepEqual(safeTransactionRuntimeObservation(historical),historical);
 for(const localization of [{...result.localization,extra:'PRIVATE_SECRET'},{...result.localization,previous:{...result.localization.previous,source:'/PRIVATE_SOURCE'}},{...result.localization,previous:{...result.localization.previous,sourceWritten:true}},{...result.localization,previous:{...result.localization.previous,copiedBytes:result.progress.limits.bytes}},{...result.localization,previous:{...result.localization.previous,status:'NOT_INSPECTED'}},{...result.localization,state:{...result.localization.state,reconciliationAuthorized:true}},{...result.localization,immutable:{...result.localization.immutable,rollbackAuthorized:true}}])assert.equal(safeTransactionRuntimeObservation({...result,localization}),null);
});


test('optional component recapture failure preserves OBSERVED with a sanitized auxiliary error',t=>{
 const f=fixture(t),temporaryRoot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-runtime-observation-')));fs.chmodSync(temporaryRoot,0o700);t.after(()=>fs.rmSync(temporaryRoot,{recursive:true,force:true}));
 const copied=path.join(temporaryRoot,'profile'),readdir=fs.readdirSync;let reads=0;
 const before=evidence(f.home);t.mock.method(fs,'readdirSync',(file,...args)=>{if(file===copied&&++reads===3){const error=Error('PRIVATE_NATIVE_MESSAGE');error.code='EACCES';throw error;}return readdir(file,...args);});
 const result=observeTransactionRuntimeIdentity({...f,temporaryRoot});t.mock.restoreAll();assert.deepEqual(evidence(f.home),before);assert.equal(result.status,'OBSERVED');assert.equal(result.diagnostic.captureComplete,true);assert.equal(result.localization.failure.errno,'EACCES');assert.equal(result.localization.failure.stage,'localization');assert.equal(result.localization.failure.artifact,'disposable-profile');assert.equal(result.localization.previous.status,'NOT_INSPECTED');assert.equal(result.localization.immutable,null);assert.equal(result.localization.state,null);assert.equal(JSON.stringify(result).includes('PRIVATE_NATIVE_MESSAGE'),false);
});

test('a successful component recapture with a different disposable aggregate fails closed',t=>{
 const f=fixture(t),temporaryRoot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-runtime-observation-')));fs.chmodSync(temporaryRoot,0o700);t.after(()=>fs.rmSync(temporaryRoot,{recursive:true,force:true}));
 const copied=path.join(temporaryRoot,'profile'),readdir=fs.readdirSync;let reads=0;
 const before=evidence(f.home);t.mock.method(fs,'readdirSync',(file,...args)=>{if(file===copied&&++reads===3)fs.appendFileSync(path.join(copied,'openclaw.json'),' ');return readdir(file,...args);});
 const result=failedObservation(()=>observeTransactionRuntimeIdentity({...f,temporaryRoot}));t.mock.restoreAll();assert.deepEqual(evidence(f.home),before);assert.equal(result.status,'BLOCKED');assert.equal(result.failure.code,'SETUP_PROFILE_CHANGED');assert.equal(result.failure.stage,'localization');assert.equal(result.failure.artifact,'disposable-profile');assert.equal(result.localization.previous.status,'NOT_INSPECTED');assert.equal(result.localization.immutable,null);assert.equal(result.localization.state,null);
});
