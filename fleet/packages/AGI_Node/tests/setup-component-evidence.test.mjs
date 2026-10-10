import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {beginSetupTransaction,transactionStatus} from '../compute/setup-transaction.mjs';
import {assertRuntimeSecurityIdentity,captureRuntimeSecurityComponents} from '../compute/setup-runtime-identity.mjs';
import {readComponentEvidence,persistComponentEvidence,validateCompleteComponents,safeComponentEvidenceSummary} from '../compute/setup-component-evidence.mjs';
import {safeSavedSetupReport} from '../compute/setup-failure-report.mjs';
import {preparedSecurityReviewFixture,statePreparationFixture} from './state-preparation-fixture.mjs';
import {cleanInitializationFixture as cleanReceipt} from './clean-initialization-fixture.mjs';
const schema=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url),'utf8'));
const stop=async()=>{};
function put(root,name,value){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});}

async function fixture(t,{many=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-complete-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const f={root,profileDir:path.join(root,'profile'),directory:path.join(root,'transaction'),stop};const tx=await beginSetupTransaction({...f,cleanInstall:true});
 put(tx.candidate,'openclaw.json','{"gateway":{"mode":"local"}}');put(tx.candidate,'compute-settings.json',{role:'agent',maxRuns24h:2,versions:{openclaw:'2026.9.5'}});
 put(tx.candidate,'state/openclaw.sqlite','');const file=path.join(tx.candidate,'state/openclaw.sqlite'),db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;'+schema.state.sql+';PRAGMA user_version=17');db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('primary','global',17,null,'2026.9.5',1,1);
 const insert=db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)');for(let i=0;i<(many?300:1);i++)insert.run('fixture-'+i,'{"private":"SECRET_VALUE_CANARY"}',1);db.close();
 if(many)for(let i=0;i<1100;i++)put(tx.candidate,`protected/file-${i}.json`,'"SECRET_FILE_CANARY"');
 tx.state.preparationReceipt=statePreparationFixture();tx.state.cleanInitializationReceipt=cleanReceipt();tx.save();
 const review=tx.bindReview(preparedSecurityReviewFixture({}, {}, {}, {}, {cleanInitialization:tx.state.cleanInitializationReceipt}));
 return {...f,tx,review};
}
async function publish(f){f.tx.approve(f.review);await f.tx.publish({review:f.review,validate:()=>{},seal:()=>put(f.profileDir,'compute-settings.json',{role:'agent',maxRuns24h:2,versions:{openclaw:'2026.9.5'},policyHash:'f'.repeat(64)})});}
function writeState(f,sql,params=[]){const db=new DatabaseSync(path.join(f.profileDir,'state/openclaw.sqlite'));try{db.prepare(sql).run(...params);}finally{db.close();}}
test('complete private baseline exceeds receipt budgets without losing immutable paths or SQLite records',async t=>{
 const f=await fixture(t,{many:true}),ref=f.review.componentEvidence,value=readComponentEvidence(f.directory,ref);
 assert.ok(value.components.immutableEntries.length>1100);assert.equal(value.components.sqlite['state/openclaw.sqlite'].tableDigests.config_machine_state.records.length,300);assert.equal(value.components.sqlite['state/openclaw.sqlite'].tableDigests.config_machine_state.recordsTruncated,false);
 assert.ok(ref.bytes>64*1024);const raw=fs.readFileSync(path.join(f.directory,ref.file),'utf8');assert.equal(raw.includes('SECRET_VALUE_CANARY'),false);assert.equal(raw.includes('SECRET_FILE_CANARY'),false);assert.equal(fs.statSync(path.join(f.directory,ref.file)).mode&0o777,0o600);assert.equal(fs.statSync(path.join(f.directory,'component-evidence')).mode&0o777,0o700);
 await publish(f);await f.tx.complete(()=>writeState(f,'INSERT INTO config_machine_state VALUES(?,?,?)',['update.checkState','{"lastCheck":1}',2]));
 assert.equal(transactionStatus(f.directory).state,'complete');const refs=f.tx.state.componentEvidence;assert.equal(readComponentEvidence(f.directory,refs.sealed).identity.digest,f.tx.state.sealedSecurityIdentity);assert.equal(refs.observations[0].phase,'completion-after-readiness');assert.equal(refs.observations[0].identityDigest,f.tx.state.sealedSecurityIdentity);assert.equal(f.tx.state.completedIdentity,f.tx.state.sealedSecurityIdentity);
});
test('clean admission never resumes, archives, or stops an existing profile/transaction',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-clean-refusal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const f={profileDir:path.join(root,'profile'),directory:path.join(root,'transaction'),cleanInstall:true,stop:async()=>assert.fail('must not stop')};
 put(f.profileDir,'evidence','old');await assert.rejects(beginSetupTransaction(f),/SETUP_CLEAN_INSTALL_REQUIRED/);assert.equal(fs.readFileSync(path.join(f.profileDir,'evidence'),'utf8'),'old');fs.rmSync(f.profileDir,{recursive:true});put(f.directory,'old-receipt','retained');await assert.rejects(beginSetupTransaction(f),/SETUP_CLEAN_INSTALL_REQUIRED/);assert.equal(fs.readFileSync(path.join(f.directory,'old-receipt'),'utf8'),'retained');
});
test('clean admission catches profile materialization during service verification',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-clean-race-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profileDir=path.join(root,'profile'),directory=path.join(root,'transaction');await assert.rejects(beginSetupTransaction({profileDir,directory,cleanInstall:true,stop:async()=>put(profileDir,'unexpected','keep')}),/SETUP_CLEAN_INSTALL_REQUIRED/);assert.equal(fs.existsSync(directory),false);
});
test('review binds the initialization receipt and complete artifact before approval',async t=>{
 const f=await fixture(t),initial=f.review.digest;f.review.componentEvidence.sha256='a'.repeat(64);assert.throws(()=>f.tx.approve(f.review),/SETUP_COMPONENT_EVIDENCE_INVALID|SETUP_REVIEW_STALE/);assert.equal(f.tx.state.approval,null);f.review=f.tx.bindReview(preparedSecurityReviewFixture({}, {}, {}, {}, {cleanInitialization:f.tx.state.cleanInitializationReceipt}));assert.notEqual(f.review.digest,initial);
 put(f.directory,'clean-initialization-in-progress.json','{}');assert.throws(()=>f.tx.approve(f.review),/SETUP_CLEAN_INITIALIZATION_REVIEW_INVALID/);assert.equal(f.tx.state.approval,null);
});
test('missing or changed full baseline fails closed before publication',async t=>{
 const f=await fixture(t);f.tx.approve(f.review);fs.appendFileSync(path.join(f.directory,f.review.componentEvidence.file),' ');await assert.rejects(f.tx.publish({review:f.review,validate:()=>assert.fail(),seal:()=>assert.fail()}),/SETUP_COMPONENT_EVIDENCE_INVALID/);assert.equal(fs.existsSync(f.profileDir),false);
});
test('exact post-readiness mismatch is persisted before recovery and primary code survives',async t=>{
 const f=await fixture(t);await publish(f);const sealed=f.tx.state.componentEvidence.sealed;
 await assert.rejects(f.tx.complete(()=>writeState(f,"UPDATE config_machine_state SET value_json=? WHERE state_key='fixture-0'",['{"authority":"changed"}'])),/SETUP_PROFILE_CHANGED/);
 assert.equal(f.tx.state.primaryFailureCode,'SETUP_PROFILE_CHANGED');assert.equal(f.tx.state.rollbackFailureCode,'SETUP_ROLLBACK_RUNTIME_CHANGED');assert.equal(f.tx.state.state,'safe-stop-required');const observation=f.tx.state.componentEvidence.observations.find(ref=>ref.phase==='completion-after-readiness');assert.ok(observation);assert.notEqual(observation.identityDigest,sealed.identityDigest);
 const before=readComponentEvidence(f.directory,sealed),after=readComponentEvidence(f.directory,observation);assert.notEqual(before.components.sqlite['state/openclaw.sqlite'].tableDigests.config_machine_state.sha256,after.components.sqlite['state/openclaw.sqlite'].tableDigests.config_machine_state.sha256);
 assert.equal(f.tx.state.completedIdentity,null);assert.equal(fs.existsSync(f.profileDir),true);
});
test('immutable tampering after readiness remains rejected and has a full path hash baseline',async t=>{
 const f=await fixture(t);await publish(f);await assert.rejects(f.tx.complete(()=>put(f.profileDir,'openclaw.json','{"authority":"changed"}')),/SETUP_PROFILE_CHANGED/);const observed=readComponentEvidence(f.directory,f.tx.state.componentEvidence.observations[0]);assert.ok(observed.components.immutableEntries.some(row=>row[0]==='openclaw.json'));assert.equal(f.tx.state.state,'safe-stop-required');
});
test('artifact type, redirection, and truncation are not accepted as complete evidence',async t=>{
 const f=await fixture(t),captured=captureRuntimeSecurityComponents(f.tx.candidate,{profileDir:f.profileDir,phase:'reviewed',registryAliases:[f.tx.candidate]},{completeDiagnostics:true});
 captured.components.sqlite['state/openclaw.sqlite'].tableDigests.config_machine_state.recordsTruncated=true;assert.throws(()=>validateCompleteComponents(captured),/SETUP_COMPONENT_EVIDENCE_INVALID/);
 const file=path.join(f.directory,f.review.componentEvidence.file),retained=file+'.retained';fs.renameSync(file,retained);fs.symlinkSync(retained,file);assert.throws(()=>readComponentEvidence(f.directory,f.review.componentEvidence),/SETUP_COMPONENT_EVIDENCE_INVALID/);
});
test('durability failure does not publish a partial approval',async t=>{
 const f=await fixture(t);const original=fs.fsyncSync;fs.fsyncSync=()=>{throw Error('injected disk failure');};try{assert.throws(()=>f.tx.bindReview(preparedSecurityReviewFixture({}, {}, {}, {}, {cleanInitialization:f.tx.state.cleanInitializationReceipt})),/injected disk failure/);}finally{fs.fsyncSync=original;}
 assert.equal(f.tx.state.approval,null);assert.equal(f.tx.state.state,'prepared');assert.equal(fs.existsSync(f.profileDir),false);
});

test('real concurrent committed WAL materialization during and after completion preserves the sealed identity',async t=>{
 const f=await fixture(t,{many:true});await publish(f);
 const file=path.join(f.profileDir,'state/openclaw.sqlite'),source=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA busy_timeout=1000');let count=0;const stmt=db.prepare("INSERT INTO config_machine_state VALUES('update.checkState',?,?) ON CONFLICT(state_key) DO UPDATE SET value_json=excluded.value_json,updated_at_ms=excluded.updated_at_ms");const timer=setInterval(()=>{count++;stmt.run(JSON.stringify({lastCheck:count}),count);if(count===1)process.stdout.write('ready\\n');},1);process.on('SIGTERM',()=>{clearInterval(timer);process.stdout.write('commits='+count+'\\n');db.close();process.exit(0);});setTimeout(()=>process.exit(2),20000).unref();`;
 const writer=spawn(process.execPath,['--input-type=module','-e',source,file],{stdio:['ignore','pipe','pipe']});let output='',errors='';writer.stdout.on('data',v=>output+=v);writer.stderr.on('data',v=>errors+=v);t.after(()=>{if(writer.exitCode===null)writer.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('writer readiness: '+errors)),5000);const ready=()=>{if(output.includes('ready')){clearTimeout(timeout);writer.stdout.off('data',ready);resolve();}};writer.stdout.on('data',ready);writer.once('error',reject);ready();});
 await f.tx.complete(()=>{});f.tx.assertRuntimeSecurity(f.profileDir);assert.equal(f.tx.state.state,'complete');const closed=once(writer,'close');writer.kill('SIGTERM');assert.equal((await closed)[0],0,errors);const count=Number(/commits=(\d+)/.exec(output)?.[1]);assert.ok(count>1);const db=new DatabaseSync(file,{readOnly:true});try{assert.equal(JSON.parse(db.prepare("SELECT value_json FROM config_machine_state WHERE state_key='update.checkState'").get().value_json).lastCheck,count);}finally{db.close();}
 writeState(f,"UPDATE config_machine_state SET value_json=? WHERE state_key='fixture-0'",['{"authority":"changed"}']);assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_ROLLBACK_RUNTIME_CHANGED/);
});

test('saved commissioning report exports only phase and evidence commitments',async t=>{
 const f=await fixture(t);await publish(f);const summary=safeComponentEvidenceSummary(f.tx.state);summary.privateContents='SECRET_RAW_CANARY';summary.reviewed.profileDir='/private/operator';const saved=safeSavedSetupReport({schema:'agi-setup-support/v2',componentEvidence:summary});assert.equal(saved.componentEvidence.reviewed.sha256,f.review.componentEvidence.sha256);assert.equal(saved.componentEvidence.sealed.phase,'sealed-before-readiness');assert.equal(JSON.stringify(saved).includes('SECRET_RAW_CANARY'),false);assert.equal(JSON.stringify(saved).includes('/private/operator'),false);
});

test('clean empty transfer directory lifecycle is admitted while every payload stays protected',async t=>{
 const f=await fixture(t);fs.mkdirSync(path.join(f.tx.candidate,'tmp'),{mode:0o700});f.review=f.tx.bindReview(preparedSecurityReviewFixture({}, {}, {}, {}, {cleanInitialization:f.tx.state.cleanInitializationReceipt}));await publish(f);const transfer=path.join(f.profileDir,'tmp/node-workspace-transfer');
 await f.tx.complete(()=>fs.mkdirSync(transfer,{mode:0o700}));assert.equal(f.tx.state.runtimeSecurityRecord.contract.cleanInstallVersion,1);fs.rmdirSync(transfer);f.tx.assertRuntimeSecurity(f.profileDir);fs.mkdirSync(transfer,{mode:0o700});f.tx.assertRuntimeSecurity(f.profileDir);put(transfer,'payload','private work');assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_PROFILE_CHANGED|SETUP_ROLLBACK_RUNTIME_CHANGED/);fs.unlinkSync(path.join(transfer,'payload'));fs.chmodSync(transfer,0o755);assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);fs.chmodSync(transfer,0o700);const lstat=fs.lstatSync;fs.lstatSync=(file,...args)=>{const stat=lstat(file,...args);if(file!==transfer||!stat)return stat;const foreign=Object.create(stat);Object.defineProperty(foreign,'uid',{value:stat.uid+1});return foreign;};try{assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);}finally{fs.lstatSync=lstat;}fs.rmdirSync(transfer);fs.symlinkSync(path.join(f.profileDir,'tmp'),transfer);assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);
});
test('maintenance identity keeps old transfer directory behavior unless clean runtime version is explicit',async t=>{
 const f=await fixture(t);fs.mkdirSync(path.join(f.tx.candidate,'tmp'),{mode:0o700});const normal=captureRuntimeSecurityComponents(f.tx.candidate,{profileDir:f.profileDir,phase:'reviewed'});fs.mkdirSync(path.join(f.tx.candidate,'tmp/node-workspace-transfer'),{mode:0o700});assert.notEqual(captureRuntimeSecurityComponents(f.tx.candidate,normal.identity.contract).identity.digest,normal.identity.digest);assert.throws(()=>captureRuntimeSecurityComponents(f.tx.candidate,{profileDir:f.profileDir,cleanInstallVersion:2}),/SETUP_RUNTIME_SECURITY_VERSION/);
});

async function maintenance(f,{directory=f.directory,config='browser-configuration'}={}){
 const tx=await beginSetupTransaction({profileDir:f.profileDir,directory,stop});assert.equal(tx.state.installationTrack,'clean-maintenance');put(tx.candidate,'browser-configuration.json',{configuration:config});tx.state.preparationReceipt=statePreparationFixture();tx.save();const review=tx.bindReview(preparedSecurityReviewFixture({}, {}, {}, {}));tx.approve(review);await tx.publish({review,validate:()=>{},seal:()=>{}});await tx.complete(()=>{});return {tx,review};
}
test('modern browser configuration and qualification retain clean contract through verified lineage',async t=>{
 const f=await fixture(t);fs.mkdirSync(path.join(f.tx.candidate,'tmp'),{mode:0o700});f.review=f.tx.bindReview(preparedSecurityReviewFixture({}, {}, {}, {}, {cleanInitialization:f.tx.state.cleanInitializationReceipt}));await publish(f);await f.tx.complete(()=>{});const originalId=f.tx.state.id;
 const configured=await maintenance(f);assert.equal(configured.tx.state.sourceCleanRuntime.transactionId,originalId);assert.equal(configured.review.sourceCleanRuntime.sealedSecurityIdentity,f.tx.state.sealedSecurityIdentity);assert.equal(configured.tx.state.runtimeSecurityRecord.contract.cleanInstallVersion,1);assert.equal(fs.existsSync(f.directory+'-archive-'+originalId),true);
 const qualified=await maintenance(f,{directory:path.join(f.root,'qualification-transaction'),config:'qualified-browser'});assert.equal(qualified.tx.state.sourceCleanRuntime.transactionId,configured.tx.state.id);const refreshed=await maintenance(f,{config:'renewed-browser'});assert.equal(refreshed.tx.state.sourceCleanRuntime.transactionId,qualified.tx.state.id);
 fs.mkdirSync(path.join(f.profileDir,'tmp/node-workspace-transfer'),{mode:0o700});refreshed.tx.assertRuntimeSecurity(f.profileDir);fs.rmdirSync(path.join(f.profileDir,'tmp/node-workspace-transfer'));writeState(f,'INSERT INTO config_machine_state VALUES(?,?,?)',['update.checkState','{"lastCheck":22}',22]);await refreshed.tx.rollback();assert.equal(refreshed.tx.state.state,'rolled-back');assert.equal(JSON.parse(fs.readFileSync(path.join(f.profileDir,'browser-configuration.json'))).configuration,'qualified-browser');
});
test('modern maintenance refuses unexplained config change instead of downgrading to legacy identity',async t=>{
 const f=await fixture(t);await publish(f);await f.tx.complete(()=>{});put(f.profileDir,'openclaw.json','{"unexpectedAuthority":true}');const receipt=fs.readFileSync(path.join(f.directory,'transaction.json'));await assert.rejects(beginSetupTransaction({profileDir:f.profileDir,directory:f.directory,stop}),/SETUP_PROFILE_CHANGED/);assert.deepEqual(fs.readFileSync(path.join(f.directory,'transaction.json')),receipt);assert.equal(fs.existsSync(f.directory+'-archive-'+f.tx.state.id),false);
});

test('clean exact Gateway PID locks support macOS optional startTime and disappear safely',async t=>{
 const f=await fixture(t),prefix='tmp/openclaw-'+process.getuid();fs.mkdirSync(path.join(f.tx.candidate,prefix),{recursive:true,mode:0o700});put(f.tx.candidate,'openclaw.json',{gateway:{mode:'local',port:18896}});f.review=f.tx.bindReview(preparedSecurityReviewFixture({}, {}, {}, {}, {cleanInitialization:f.tx.state.cleanInitializationReceipt}));await publish(f);
 const configPath=path.join(f.profileDir,'openclaw.json'),lockNames=[prefix+'/gateway.'+createHash('sha256').update(configPath).digest('hex').slice(0,8)+'.lock',prefix+'/gateway.state.lock'];
 const base={pid:42,ownerId:'12345678-1234-1234-1234-123456789012',cronOwnerProjection:'dynamic-default-v1',createdAt:'2026-10-04T13:10:28.971Z',configPath,stateDir:f.profileDir,port:18896};
 await f.tx.complete(()=>{for(const name of lockNames)put(f.profileDir,name,base);});f.tx.assertRuntimeSecurity(f.profileDir);
 for(const name of lockNames)put(f.profileDir,name,{...base,startTime:1791119428971});f.tx.assertRuntimeSecurity(f.profileDir);
 for(const invalid of [{startTime:'1791119428971'},{startTime:0},{startTime:null},{startTime:Infinity},{role:'operator'},{port:18897},{configPath:configPath+'.other'},{stateDir:f.profileDir+'-other'},{ownerId:'unknown'},{pid:0},{createdAt:'not-time'},{unknown:'authority'}]){put(f.profileDir,lockNames[0],{...base,...invalid});assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_RUNTIME_GATEWAY_LOCK_INVALID/);}
 put(f.profileDir,lockNames[0],{...base,startTime:1791119428999});assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_RUNTIME_GATEWAY_LOCK_INVALID/);put(f.profileDir,lockNames[0],{...base,startTime:1791119428971});fs.chmodSync(path.join(f.profileDir,lockNames[0]),0o644);assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_RUNTIME_GATEWAY_LOCK_INVALID/);fs.chmodSync(path.join(f.profileDir,lockNames[0]),0o600);
 for(const name of lockNames)fs.unlinkSync(path.join(f.profileDir,name));f.tx.assertRuntimeSecurity(f.profileDir);put(f.profileDir,prefix+'/gateway.unexpected.lock',base);assert.throws(()=>f.tx.assertRuntimeSecurity(f.profileDir),/SETUP_ROLLBACK_RUNTIME_CHANGED/);
});

test('an older completed approval is never selected when current configuration was reverted',async t=>{
 const f=await fixture(t);await publish(f);await f.tx.complete(()=>{});const configured=await maintenance(f,{config:'older-approved'});const older=fs.readFileSync(path.join(f.profileDir,'browser-configuration.json'));const qualified=await maintenance(f,{directory:path.join(f.root,'qualification-transaction'),config:'latest-approved'});assert.equal(qualified.tx.state.cleanRuntimeGeneration,configured.tx.state.cleanRuntimeGeneration+1);fs.writeFileSync(path.join(f.profileDir,'browser-configuration.json'),older);await assert.rejects(beginSetupTransaction({profileDir:f.profileDir,directory:f.directory,stop}),/SETUP_PROFILE_CHANGED/);assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'transaction.json'))).id,configured.tx.state.id);
});
