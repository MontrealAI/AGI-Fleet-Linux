import {statePreparationFixture,bindPreparedReviewFixture,preparedSecurityReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readSavedSetupReport, safeSavedSetupReport, safeFailureFields} from '../compute/setup-failure-report.mjs';
import {inventoryCompute, safeSupportReport, exportSupportReport, repairFailureText} from '../compute/repair.mjs';
import {completionText, completionHTML, nextSetupAction, exportSupport} from '../compute/setup-completion.mjs';
import {safeSetupFailure} from '../compute/setup-auth.mjs';
import {beginSetupTransaction,transactionStatus,restoreSetupTransaction} from '../compute/setup-transaction.mjs';
import {safeRuntimeIdentityDiagnostic} from '../compute/setup-runtime-identity.mjs';

function shutdownObservation() {return {schema:'agi-service-stop/v1',state:'passed',elapsedMs:21,timeoutMs:20000,attempts:1,servicesAbsent:{compute:true,gateway:true},portsClosed:{compute:true,gateway:true},socketsAbsent:true,failureCode:null,launchctlPrint:Object.fromEntries(['compute','gateway'].map(name=>[name,{attempt:1,status:113,classification:'absent',badRequestPrefix:true,stdout:'SECRET-CANARY',stderr:'SECRET-CANARY',path:'/private/SECRET-CANARY'}])),raw:'SECRET-CANARY'};}
function report() {
  const observation={attempt:1,elapsedMs:500,httpStatus:200,predicates:{policyHashMatches:true,stopped:true,roleMatches:true,gatewayReady:false,policyCurrent:true},health:{role:'agent',policyHash:'a'.repeat(64),stopped:true,gatewayReady:false,policyCurrent:true,token:'SECRET-CANARY',arbitrary:'SECRET-CANARY'}};
  return {schema:'agi-setup-support/v2',runID:'4bb1e760-f380-4503-9fe6-ae02b52211e7',passed:false,startedAt:'2026-10-03T12:00:00.000Z',finishedAt:'2026-10-03T12:01:00.000Z',stages:{oauth:'passed',services:'failed'},stageSeconds:{services:60},failureCode:'COMPUTE_SERVICE_READINESS_TIMEOUT',primaryFailureCode:'COMPUTE_SERVICE_READINESS_TIMEOUT',rollbackFailureCode:'SETUP_ROLLBACK_STOP_REQUIRED',recovery:{profile:'RESTORED',serviceFiles:'RESTORED'},transaction:{id:'4bb1e760-f380-4503-9fe6-ae02b52211e7',state:'rolled-back',candidate:'/Users/private/SECRET-CANARY'},securityReviewDigest:'b'.repeat(64),walletAccessed:false,paidProviderCall:false,
    serviceShutdown:[shutdownObservation()],serviceReadiness:{schema:'agi-setup-service-readiness/v1',platform:'darwin',commands:{gatewayStart:{status:0,stdout:'Gateway service started\ntoken=SECRET-CANARY',stderr:'Warning: transient models unavailable Bearer SECRET-CANARY /Users/private/.openclaw-agi-compute'}},gateway:{state:'passed',attempts:2,elapsedMs:500,timeoutMs:90000},computePort:{state:'passed',attempts:1},health:{state:'failed',attempts:1,timeoutMs:60000,history:[observation],lastFailure:observation},finalPolicy:{state:'pending'},raw:'SECRET-CANARY'},token:'SECRET-CANARY',oauth:{secret:'SECRET-CANARY'},desktop:{unsafe:'SECRET-CANARY'}};
}
function fixture(t, role='agent') {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-saved-failure-')),directory=path.join(home,'.agi-genesis-setup-'+role),file=path.join(directory,'setup-diagnostics.json');
  fs.mkdirSync(directory,{mode:0o700});fs.writeFileSync(file,JSON.stringify(report()),{mode:0o600});
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return {home,role,directory,file};
}

test('saved setup summary retains primary and secondary failure independently of successful outer recovery',()=>{
  const value=safeSavedSetupReport(report());assert.equal(value.primaryFailureCode,'COMPUTE_SERVICE_READINESS_TIMEOUT');assert.equal(value.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.deepEqual(value.recovery,{profile:'RESTORED',serviceFiles:'RESTORED'});assert.equal(value.transaction.state,'rolled-back');assert.match(value.source,/historical evidence/);
  assert.deepEqual(value.serviceReadiness.health.lastFailure.predicates,{policyHashMatches:true,stopped:true,roleMatches:true,gatewayReady:false,policyCurrent:true});assert.equal(value.serviceReadiness.health.lastFailure.health.gatewayReady,false);assert.equal(value.serviceReadiness.finalPolicy.state,'pending');assert(!JSON.stringify(value).includes('SECRET-CANARY'));
});
for(const role of ['agent','node'])test(`report-only ${role} inventory includes saved readiness and sanitized Gateway streams without changing evidence`,async t=>{
  const f=fixture(t,role),before=fs.readFileSync(f.file),names=fs.readdirSync(f.directory),inventory=await inventoryCompute({...f,platform:'darwin',uid:process.getuid(),dependencies:false,run:async()=>({status:0,stdout:'staff everyone'}),probePort:async()=>false});
  for(const value of [inventory.savedSetup,safeSupportReport(inventory).savedSetup]){assert.equal(value.primaryFailureCode,'COMPUTE_SERVICE_READINESS_TIMEOUT');assert.match(value.serviceReadiness.commands.gatewayStart.stdout,/Gateway service started/);assert.match(value.serviceReadiness.commands.gatewayStart.stderr,/transient models unavailable/);assert(!JSON.stringify(value).includes('SECRET-CANARY'));assert(!JSON.stringify(value).includes('/Users/private'));}
  const exported=path.join(f.home,'commissioning.json');exportSupportReport(inventory,exported);const value=JSON.parse(fs.readFileSync(exported));assert.equal(value.savedSetup.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(value.savedSetup.serviceReadiness.health.lastFailure.predicates.gatewayReady,false);for(const name of ['compute','gateway'])assert.deepEqual(value.savedSetup.serviceShutdown[0].launchctlPrint[name],{attempt:1,status:113,classification:'absent',badRequestPrefix:true});assert(!JSON.stringify(value).includes('SECRET-CANARY'));assert.equal(fs.statSync(exported).mode&0o777,0o600);assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readdirSync(f.directory),names);assert.equal(inventory.settingsChanged,false);assert.equal(inventory.walletAccessed,false);
});
test('old reports retain their legacy failure without inventing a known primary failure or fresh readiness proof',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify({schema:'agi-setup-support/v2',passed:false,failureCode:'SETUP_ROLLBACK_STOP_REQUIRED',stages:{services:'failed'}}));const value=readSavedSetupReport(f);assert.equal(value.failureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(value.primaryFailureCode,null);assert.equal(value.rollbackFailureCode,null);assert.equal(value.serviceReadiness,null);assert.equal(value.recovery.profile,'UNKNOWN');
});
test('absent saved setup evidence is optional and causes no filesystem writes',t=>{
  const f=fixture(t);fs.unlinkSync(f.file);assert.equal(readSavedSetupReport(f),null);fs.rmdirSync(f.directory);assert.equal(readSavedSetupReport(f),null);assert.deepEqual(fs.readdirSync(f.home),[]);
});
test('saved setup read refuses symlink files or directories and unowned, public, oversized or malformed evidence',t=>{
  for(const mutation of ['file-link','directory-link','public','owner','size','malformed','schema']){
    const f=fixture(t);let options=f;
    if(mutation==='file-link'){fs.renameSync(f.file,f.file+'.original');fs.symlinkSync(f.file+'.original',f.file);}
    if(mutation==='directory-link'){fs.renameSync(f.directory,f.directory+'.original');fs.symlinkSync(f.directory+'.original',f.directory);}
    if(mutation==='public')fs.chmodSync(f.file,0o644);
    if(mutation==='owner')options={...f,uid:process.getuid()+1};
    if(mutation==='size')options={...f,maxBytes:1};
    if(mutation==='malformed')fs.writeFileSync(f.file,'{');
    if(mutation==='schema')fs.writeFileSync(f.file,'{"schema":"untrusted","secret":"SECRET-CANARY"}');
    assert.throws(()=>readSavedSetupReport(options),/SAVED_SETUP_REPORT_(UNSAFE|UNREADABLE|SCHEMA_UNSUPPORTED)/,mutation);
  }
});
test('unsafe saved evidence is reported as blocked, without reading arbitrary content or altering it',async t=>{
  const f=fixture(t);fs.chmodSync(f.file,0o644);const before=fs.readFileSync(f.file);const result=await inventoryCompute({...f,platform:'linux',dependencies:false,probePort:async()=>false});assert.equal(result.checks.find(x=>x.id==='saved-setup-report').code,'SAVED_SETUP_REPORT_UNSAFE');assert.equal(result.savedSetup,undefined);assert(!JSON.stringify(safeSupportReport(result)).includes('SECRET-CANARY'));assert.deepEqual(fs.readFileSync(f.file),before);
});
test('completion panel presents failed predicates and retains rollback history after recovery without requesting manual repair',t=>{
  const value=report(),text=completionText(value),html=completionHTML(value);assert.match(text,/Primary commissioning failure: COMPUTE_SERVICE_READINESS_TIMEOUT/);assert.match(text,/Rollback failure \(retained\): SETUP_ROLLBACK_STOP_REQUIRED/);assert.match(text,/Recovery: profile RESTORED; service files RESTORED/);for(const name of ['policyHashMatches','stopped','roleMatches','gatewayReady','policyCurrent'])assert(text.includes(name+':'));assert.match(text,/gatewayReady: FAIL/);assert.match(text,/Final policy identity: pending/);assert.match(html,/Gateway service started/);assert.match(nextSetupAction(value),/technical review/);assert.match(nextSetupAction(value),/no manual profile edit, restart, rollback or browser sign-in is required/);
  const f=fixture(t),file=exportSupport({...value,token:undefined,oauth:undefined,desktop:null,transaction:{id:value.transaction.id,state:'rolled-back'}},f.home);assert.equal(JSON.parse(fs.readFileSync(file)).rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');
});
test('new readiness failure codes remain explicit while arbitrary secret-bearing codes are collapsed',()=>{
  for(const value of ['OPENCLAW_GATEWAY_READINESS_TIMEOUT','OPENCLAW_GATEWAY_HEALTH_FAILED','COMPUTE_SERVICE_READINESS_TIMEOUT'])assert.equal(safeSetupFailure(Error(value)),value);
  const bad={failureCode:'SETUP_SECRET_CANARY',primaryFailureCode:'SECRET-CANARY',rollbackFailureCode:'COMPUTE_SECRET_CANARY',recovery:{profile:'SECRET-CANARY'}};const safe=safeFailureFields(bad);assert.equal(safe.primaryFailureCode,'SETUP_STAGE_FAILED');assert(!JSON.stringify(safe).includes('SECRET'));assert(!completionHTML({passed:false,stages:{services:'failed'},...bad}).includes('SECRET-CANARY'));
});
test('failed persistence remains explicit and never claims the diagnostic report was saved',()=>{
  const value={...report(),diagnosticsSaved:false,failureRecordingFailed:true},saved=safeSavedSetupReport(value);assert.equal(saved.diagnosticsSaved,false);assert.equal(saved.failureRecordingFailed,true);assert.equal(saved.primaryFailureCode,'COMPUTE_SERVICE_READINESS_TIMEOUT');assert.match(completionText(value),/Diagnostic file was not saved/);assert.match(completionText(value),/Transaction failure recording was incomplete/);assert.match(nextSetupAction(value),/Export this in-memory support report/);
});
test('Repair-Compute failure output includes primary, rollback, recovery and the owned saved report path',t=>{
  const f=fixture(t),error=Object.assign(Error('SETUP_ROLLBACK_STOP_REQUIRED'),{supportReport:report(),supportDirectory:f.directory}),text=repairFailureText(error,{home:f.home});
  assert.match(text,/Primary commissioning failure: COMPUTE_SERVICE_READINESS_TIMEOUT/);assert.match(text,/Rollback failure \(retained\): SETUP_ROLLBACK_STOP_REQUIRED/);assert.match(text,/profile RESTORED; service files RESTORED/);assert(text.includes(f.file));assert.match(text,/gatewayReady: FAIL/);assert.match(text,/Option 6/);assert(!text.includes('inspect or resume'));
  error.supportReport.diagnosticsSaved=false;assert(!repairFailureText(error,{home:f.home}).includes('Saved support report:'));error.supportReport.diagnosticsSaved=true;error.supportDirectory='/Users/private/SECRET-CANARY';assert(!repairFailureText(error,{home:f.home}).includes('SECRET-CANARY'));
});

test('saved shutdown evidence is bounded and excludes raw outputs and unknown fields',()=>{
 const stop={...shutdownObservation(),state:'failed',elapsedMs:20000,timeoutMs:20000,attempts:80,servicesAbsent:{compute:true,gateway:true},portsClosed:{compute:true,gateway:true},socketsAbsent:false,failureCode:'SETUP_RUNTIME_SOCKET_STILL_PRESENT',stdout:'SECRET-CANARY',path:'/private/SECRET-CANARY'};
 const saved=safeSavedSetupReport({...report(),serviceShutdown:Array.from({length:12},()=>stop)});assert.equal(saved.serviceShutdown.length,8);assert.equal(saved.serviceShutdown[0].failureCode,'SETUP_RUNTIME_SOCKET_STILL_PRESENT');assert.equal(saved.serviceShutdown[0].socketsAbsent,false);assert(!JSON.stringify(saved).includes('SECRET-CANARY'));assert.deepEqual(safeSavedSetupReport({...report(),serviceShutdown:undefined}).serviceShutdown,[]);for(const name of ['compute','gateway'])assert.deepEqual(saved.serviceShutdown[0].launchctlPrint[name],{attempt:1,status:113,classification:'absent',badRequestPrefix:true});
});

test('saved print classifications remain sanitized on refusal and historical reports do not invent them',()=>{
 const rejected={...shutdownObservation(),state:'failed',failureCode:'SETUP_SERVICE_STOP_UNCONFIRMED',launchctlPrint:{compute:{attempt:1,status:113,classification:'rejected',badRequestPrefix:false,stdout:'SECRET-CANARY'},gateway:null}};
 const saved=safeSavedSetupReport({...report(),serviceShutdown:[rejected]});assert.deepEqual(saved.serviceShutdown[0].launchctlPrint,{compute:{attempt:1,status:113,classification:'rejected',badRequestPrefix:false},gateway:null});assert(!JSON.stringify(saved).includes('SECRET-CANARY'));
 const historical={...shutdownObservation()};delete historical.launchctlPrint;assert.deepEqual(safeSavedSetupReport({...report(),serviceShutdown:[historical]}).serviceShutdown[0].launchctlPrint,{compute:null,gateway:null});
 for(const record of [{attempt:1,status:113,classification:'SECRET-CANARY',badRequestPrefix:true},{attempt:1,status:'SECRET-CANARY',classification:'absent',badRequestPrefix:true},{attempt:-1,status:113,classification:'absent',badRequestPrefix:true}]){const value=safeSavedSetupReport({...report(),serviceShutdown:[{...shutdownObservation(),launchctlPrint:{compute:record,gateway:null,unknown:'SECRET-CANARY'}}]});assert.equal(value.serviceShutdown[0].launchctlPrint.compute,null);assert(!JSON.stringify(value).includes('SECRET-CANARY'));}
});

test('saved state preparation evidence keeps only the exact validated receipt and rejects private or invented fields',()=>{
 const receipt=statePreparationFixture(),value=safeSavedSetupReport({...report(),statePreparation:receipt});assert.deepEqual(value.statePreparation,receipt);receipt.addedSchemaObjects.push('table:user_profiles');assert.deepEqual(value.statePreparation.addedSchemaObjects,[]);
 for(const invalid of [null,{...statePreparationFixture(),private:'PREPARATION-PRIVATE-CANARY'},{...statePreparationFixture(),sourceContentSha256:'PREPARATION-PRIVATE-CANARY'},{...statePreparationFixture(),addedColumns:['user_profiles.unapproved']},{...statePreparationFixture(),verified:false},{...statePreparationFixture(),sourceRowCount:-1}]){
  const saved=safeSavedSetupReport({...report(),statePreparation:invalid});assert.equal(saved.statePreparation,null);assert(!JSON.stringify(saved).includes('PREPARATION-PRIVATE-CANARY'));
 }
 assert.equal(safeSavedSetupReport(report()).statePreparation,null);
});
for(const role of ['agent','node'])test(`report-only ${role} collection preserves validated state preparation evidence without writing the prior report`,async t=>{
 const f=fixture(t,role),receipt=statePreparationFixture();fs.writeFileSync(f.file,JSON.stringify({...report(),statePreparation:receipt}),{mode:0o600});const before=fs.readFileSync(f.file);
 const inventory=await inventoryCompute({...f,platform:'darwin',uid:process.getuid(),dependencies:false,run:async()=>({status:0,stdout:'staff everyone'}),probePort:async()=>false});assert.deepEqual(inventory.savedSetup.statePreparation,receipt);const exported=path.join(f.home,'commissioning-with-preparation.json');exportSupportReport(inventory,exported);assert.deepEqual(JSON.parse(fs.readFileSync(exported)).savedSetup.statePreparation,receipt);assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(fs.statSync(exported).mode&0o777,0o600);
});

test('schema, preparation and approval failures direct technical recovery rather than another OAuth login',()=>{
 for(const code of ['SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SECURITY_INVALID','SETUP_STATE_PREPARATION_FAILED','SETUP_STATE_PREPARATION_RECORDS_CHANGED','SETUP_STATE_PREPARATION_RECEIPT_INVALID','SETUP_STATE_PREPARATION_REVIEW_INVALID','SETUP_APPROVAL_WRITE_FAILED','SETUP_PREPARATION_PROTOCOL_VERSION']){
  assert.equal(safeSetupFailure(Error(code)),code);
  for(const legacy of [false,true]){
   const value={...report(),stages:{profile:'passed',oauth:'failed',services:'not-attempted'},failureCode:code,primaryFailureCode:legacy?undefined:code,rollbackFailureCode:null};
   const next=nextSetupAction(value),html=completionHTML(value);assert.match(next,/all transaction evidence intact/);assert.match(next,/Export this support report/);assert.match(next,/fresh approval/);assert.match(next,/No manual SQLite changes, profile edits, checkpoint commands or OAuth sign-in are required/);assert(!next.includes('resume sign-in'));assert(!html.includes('follow OpenClaw’s manual entry prompt'));assert(html.includes(code));
  }
 }
});
test('completion summary and exported report admit only validated preparation preservation evidence',t=>{
 const f=fixture(t),receipt=statePreparationFixture(),value={schema:'agi-setup-support/v2',passed:false,stages:{profile:'passed',oauth:'failed'},primaryFailureCode:'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED',statePreparation:receipt};
 assert.match(completionText(value),/Private state preparation: verified; existing records preserved/);assert.match(completionHTML(value),/Private state preparation: verified; existing records preserved/);
 const file=exportSupport(value,f.home);assert.deepEqual(JSON.parse(fs.readFileSync(file)).statePreparation,receipt);assert.equal(fs.statSync(file).mode&0o777,0o600);
 const invalid={...value,statePreparation:{...receipt,raw:'PREPARATION-PRIVATE-CANARY'}};assert(!completionText(invalid).includes('Private state preparation: verified'));assert(!completionHTML(invalid).includes('PREPARATION-PRIVATE-CANARY'));const rejected=exportSupport(invalid,f.home);assert.equal(JSON.parse(fs.readFileSync(rejected)).statePreparation,null);assert(!fs.readFileSync(rejected,'utf8').includes('PREPARATION-PRIVATE-CANARY'));
});


async function runtimeFailureFixture(t){
 const f=fixture(t),profileDir=path.join(f.home,'profile'),directory=path.join(f.directory,'transaction');
 fs.mkdirSync(profileDir,{mode:0o700});fs.writeFileSync(path.join(profileDir,'openclaw.json'),'original-config',{mode:0o600});
 let observeRollback=false;
 const tx=await beginSetupTransaction({profileDir,directory,stop:async()=>{if(observeRollback)fs.writeFileSync(path.join(profileDir,'openclaw.json'),'rollback-observed-config',{mode:0o600});}});
 const review=bindPreparedReviewFixture(tx,preparedSecurityReviewFixture({},{},{},{}));tx.approve(review);await tx.publish({review,validate:()=>{},seal:()=>{}});observeRollback=true;
 return {...f,profileDir,tx};
}
test('completion and rollback preserve distinct protected-runtime observations, phases and hashes through saved/exported reports',async t=>{
 const f=await runtimeFailureFixture(t);let failure;
 await assert.rejects(f.tx.complete(()=>fs.writeFileSync(path.join(f.profileDir,'openclaw.json'),'completion-observed-config',{mode:0o600})),error=>{failure=error;return error.message==='SETUP_PROFILE_CHANGED';});
 const {primaryRuntimeIdentityDiagnostic:primary,rollbackRuntimeIdentityDiagnostic:rollback}=transactionStatus(f.tx.directory);
 assert.equal(f.tx.state.state,'safe-stop-required');assert.equal(failure.primaryFailureCode,'SETUP_PROFILE_CHANGED');assert.equal(failure.rollbackFailureCode,'SETUP_ROLLBACK_RUNTIME_CHANGED');
 assert.equal(primary.phase,'completion-after-readiness');assert.equal(rollback.phase,'rollback-before-restore');assert.notEqual(primary.actual.digest,rollback.actual.digest);assert.equal(primary.expected.digest,rollback.expected.digest);
 for(const diagnostic of [primary,rollback]){const delta=diagnostic.deltas.find(value=>value.path==='openclaw.json');assert.equal(delta.kind,'config-json');assert.match(delta.beforeSha256,/^[a-f0-9]{64}$/);assert.match(delta.afterSha256,/^[a-f0-9]{64}$/);assert.notEqual(delta.beforeSha256,delta.afterSha256);}
 assert.deepEqual(failure.primaryRuntimeIdentityDiagnostic,primary);assert.deepEqual(failure.rollbackRuntimeIdentityDiagnostic,rollback);
 const value={...report(),primaryFailureCode:failure.primaryFailureCode,rollbackFailureCode:failure.rollbackFailureCode,primaryRuntimeIdentityDiagnostic:primary,rollbackRuntimeIdentityDiagnostic:rollback};
 fs.writeFileSync(f.file,JSON.stringify(value),{mode:0o600});const before=fs.readFileSync(f.file);
 for(const saved of [safeSavedSetupReport(value),readSavedSetupReport(f),JSON.parse(fs.readFileSync(exportSupport(value,f.home)))]){assert.deepEqual(saved.primaryRuntimeIdentityDiagnostic,primary);assert.deepEqual(saved.rollbackRuntimeIdentityDiagnostic,rollback);}
 assert.deepEqual(fs.readFileSync(f.file),before);
 const receipt=fs.readFileSync(f.tx.file),primaryAgain=Object.assign(Error('SETUP_PROFILE_CHANGED'),{runtimeIdentityDiagnostic:rollback});f.tx.recordFailure(primaryAgain);
 assert.deepEqual(f.tx.state.primaryRuntimeIdentityDiagnostic,primary);assert.deepEqual(f.tx.state.rollbackRuntimeIdentityDiagnostic,rollback);assert.deepEqual(fs.readFileSync(f.tx.file),receipt);
});
test('runtime failure diagnostics reject hostile values on saved, completion and exported report boundaries',t=>{
 const f=fixture(t),hostile={schema:'agi-runtime-identity-diagnostic/v1',phase:'PRIVATE_DIAGNOSTIC_CANARY',expected:{digest:'PRIVATE_DIAGNOSTIC_CANARY',contract:{token:'PRIVATE_DIAGNOSTIC_CANARY'}},actual:{immutableDigest:'b'.repeat(64),sqliteSecurityDigests:{'private/PRIVATE_DIAGNOSTIC_CANARY':'a'.repeat(64)}},deltas:[{kind:'config-json',reason:'digest-mismatch',path:'/Users/private/PRIVATE_DIAGNOSTIC_CANARY',beforeSha256:'PRIVATE_DIAGNOSTIC_CANARY',afterSha256:'c'.repeat(64),raw:'PRIVATE_DIAGNOSTIC_CANARY',logicalRecord:'PRIVATE_DIAGNOSTIC_CANARY'}, {kind:'sqlite-logical-record',reason:'digest-mismatch',path:'state/openclaw.sqlite',table:'PRIVATE_DIAGNOSTIC_CANARY',recordKeySha256:'PRIVATE_DIAGNOSTIC_CANARY',beforeSha256:'d'.repeat(64),afterSha256:'e'.repeat(64)}],captureFailureCode:'SETUP_SECRET_CANARY',raw:'PRIVATE_DIAGNOSTIC_CANARY',contract:{token:'PRIVATE_DIAGNOSTIC_CANARY'}};
 const value={...report(),primaryRuntimeIdentityDiagnostic:hostile,rollbackRuntimeIdentityDiagnostic:{schema:'PRIVATE_DIAGNOSTIC_CANARY',raw:'PRIVATE_DIAGNOSTIC_CANARY'}};
 const expected=safeRuntimeIdentityDiagnostic(hostile);assert.equal(expected.phase,'unspecified');assert.equal(expected.deltas[0].path,undefined);assert.match(expected.deltas[0].pathSha256,/^[a-f0-9]{64}$/);assert.equal(expected.deltas[0].beforeSha256,null);
 for(const safe of [safeFailureFields(value),safeSavedSetupReport(value),JSON.parse(fs.readFileSync(exportSupport(value,f.home)))]){assert.deepEqual(safe.primaryRuntimeIdentityDiagnostic,expected);assert.equal(safe.rollbackRuntimeIdentityDiagnostic,null);assert(!JSON.stringify(safe.primaryRuntimeIdentityDiagnostic).includes('CANARY'));}
 const html=completionHTML({...value,serviceReadiness:null,token:undefined,oauth:undefined,desktop:null});assert(!html.includes('PRIVATE_DIAGNOSTIC_CANARY'));assert(!html.includes('SETUP_SECRET_CANARY'));
 assert.equal(safeSavedSetupReport(report()).primaryRuntimeIdentityDiagnostic,null);assert.equal(safeSavedSetupReport(report()).rollbackRuntimeIdentityDiagnostic,null);
});
for(const historicalCode of ['SETUP_CANCELLED','SETUP_PROFILE_CHANGED'])test(`a later runtime delta cannot backfill a historical ${historicalCode} failure without diagnostic evidence`,async t=>{
 const f=await runtimeFailureFixture(t);f.tx.recordFailure(Error(historicalCode));
 await assert.rejects(f.tx.complete(()=>fs.writeFileSync(path.join(f.profileDir,'openclaw.json'),'unreviewed-config',{mode:0o600})),/SETUP_PROFILE_CHANGED/);
 assert.equal(f.tx.state.primaryFailureCode,historicalCode);assert.equal(transactionStatus(f.tx.directory).primaryRuntimeIdentityDiagnostic,null);assert.equal(f.tx.state.rollbackFailureCode,'SETUP_ROLLBACK_RUNTIME_CHANGED');assert.equal(transactionStatus(f.tx.directory).rollbackRuntimeIdentityDiagnostic.phase,'rollback-before-restore');
});


test('optional component inventories cannot make a near-limit historical transaction receipt unrecoverable',async t=>{
 const f=fixture(t),profileDir=path.join(f.home,'large-profile'),directory=path.join(f.directory,'transaction');fs.mkdirSync(profileDir,{mode:0o700});
 fs.writeFileSync(path.join(profileDir,'openclaw.json'),'original-config',{mode:0o600});
 for(let i=0;i<180;i++)fs.writeFileSync(path.join(profileDir,'reviewed-'+String(i).padStart(3,'0')+'-'+'x'.repeat(100)+'.txt'),'approved-immutable-file',{mode:0o600});
 const tx=await beginSetupTransaction({profileDir,directory,stop:async()=>{}}),review=bindPreparedReviewFixture(tx,preparedSecurityReviewFixture({},{},{},{}));
 const limit=1024*1024;
 tx.state.opaqueLegacyEvidence='legacy-owned-field:'+'L'.repeat(limit-20*1024-Buffer.byteLength(JSON.stringify(tx.state,null,2)));tx.save();
 const legacy=tx.state.opaqueLegacyEvidence;assert(fs.statSync(tx.file).size<limit);
 tx.approve(review);assert.equal(tx.state.approvedSecurityRecord.diagnosticDetails,undefined);assert(fs.statSync(tx.file).size<=limit);assert.equal(tx.state.opaqueLegacyEvidence,legacy);
 await tx.publish({review,validate:()=>{},seal:()=>{}});assert.equal(tx.state.runtimeSecurityRecord.diagnosticDetails,undefined);assert(fs.statSync(tx.file).size<=limit);
 const reviewedDigest=tx.state.approvedSecurityRecord.digest,sealedDigest=tx.state.runtimeSecurityRecord.digest;
 await tx.complete(()=>{});const before=fs.readFileSync(tx.file);assert(before.length<=limit);
 const result=await restoreSetupTransaction(directory,{stop:async()=>{}});assert.equal(result.state,'rolled-back');
 const recovered=JSON.parse(fs.readFileSync(tx.file));assert.equal(recovered.opaqueLegacyEvidence,legacy);assert.equal(recovered.approvedSecurityRecord.digest,reviewedDigest);assert.equal(recovered.runtimeSecurityRecord.digest,sealedDigest);assert(fs.statSync(tx.file).size<=limit);
 assert.deepEqual(fs.readFileSync(path.join(directory,'recovery-evidence/transaction-before-recovery.json')),before);assert.equal(fs.readFileSync(path.join(profileDir,'openclaw.json'),'utf8'),'original-config');
});


test('a repeated rollback code cannot backfill a historical rollback delta while a fresh primary observation is retained',async t=>{
 const f=await runtimeFailureFixture(t);f.tx.recordFailure(Error('SETUP_ROLLBACK_RUNTIME_CHANGED'),{rollback:true});
 await assert.rejects(f.tx.complete(()=>fs.writeFileSync(path.join(f.profileDir,'openclaw.json'),'completion-observed-config',{mode:0o600})),/SETUP_PROFILE_CHANGED/);
 const status=transactionStatus(f.tx.directory);assert.equal(status.primaryFailureCode,'SETUP_PROFILE_CHANGED');assert.equal(status.primaryRuntimeIdentityDiagnostic.phase,'completion-after-readiness');assert.equal(status.rollbackFailureCode,'SETUP_ROLLBACK_RUNTIME_CHANGED');assert.equal(status.rollbackRuntimeIdentityDiagnostic,null);
});
