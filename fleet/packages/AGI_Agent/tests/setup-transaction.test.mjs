import {preparedSecurityReviewFixture as securityReview,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {beginSetupTransaction,assertAuthorizedOAuthChanges,transactionStatus,treeIdentity,restoreSetupTransaction} from '../compute/setup-transaction.mjs';
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-transaction-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,profileDir:path.join(root,'profile'),directory:path.join(root,'transaction')};};
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
const get=(root,name)=>fs.readFileSync(path.join(root,name),'utf8');
const review=()=>securityReview({gateway:{auth:{token:'old-secret'}},tools:{allow:['read']}},{gateway:{auth:{token:'new-secret'}},tools:{allow:['read','exec']}},{maxRuns24h:2},{maxRuns24h:2});
const stop=async()=>{};
test('fresh profile stays isolated until final validated and explicitly approved OAuth configuration is sealed',async t=>{
 const f=fixture(t),tx=await beginSetupTransaction({...f,stop});put(tx.candidate,'openclaw.json',{auth:{profiles:{oauth:'final-authorized'}}});put(tx.candidate,'agents/agi-checker/agent/auth-profiles.json',{token:'private-oauth'});put(tx.candidate,'seal',get(tx.candidate,'openclaw.json'));
 assert.equal(fs.existsSync(f.profileDir),false);const r=review();assert.equal(JSON.stringify(r).includes('new-secret'),false);assert.deepEqual(r.changes.find(c=>c.path==='gateway.tools.allow').afterValue,['read','exec']);Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);
 let validated=false;await tx.publish({review:r,validate:()=>{validated=true;assert.match(get(f.profileDir,'openclaw.json'),/final-authorized/);},seal:()=>{assert.equal(validated,true);put(f.profileDir,'seal',get(f.profileDir,'openclaw.json'));}});
 await tx.complete(()=>assert.equal(get(f.profileDir,'seal'),get(f.profileDir,'openclaw.json')));assert.equal(transactionStatus(f.directory).state,'complete');
});
test('migration preserves OAuth, journals, and SQLite contents using a consistent backup',async t=>{
 const f=fixture(t);put(f.profileDir,'agents/a/agent/auth-profiles.json','private');put(f.profileDir,'compute-journal.json',{calls:[1],requests:['accepted']});
 const db=new DatabaseSync(path.join(f.profileDir,'state.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES (\'kept\')');
 const tx=await beginSetupTransaction({...f,stop});assert.equal(get(tx.candidate,'agents/a/agent/auth-profiles.json'),'private');assert.equal(get(tx.candidate,'compute-journal.json'),get(f.profileDir,'compute-journal.json'));
 const copied=new DatabaseSync(path.join(tx.candidate,'state.sqlite'));assert.equal(copied.prepare('SELECT value FROM facts').get().value,'kept');copied.close();db.close();
});
test('resuming an interrupted candidate reuses its authenticated state without publishing it',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');const tx=await beginSetupTransaction({...f,stop});put(tx.candidate,'agents/a/agent/auth-profiles.json','new-oauth');
 const resumed=await beginSetupTransaction({...f,stop});assert.equal(resumed.state.id,tx.state.id);assert.equal(get(resumed.candidate,'agents/a/agent/auth-profiles.json'),'new-oauth');assert.equal(get(f.profileDir,'openclaw.json'),'original');
});
test('unapproved and changed candidates cannot be published, and live drift is never resealed',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');const tx=await beginSetupTransaction({...f,stop}),r=review();
 Object.assign(r,bindPreparedReviewFixture(tx,r));await assert.rejects(tx.publish({review:r,validate:()=>{},seal:()=>{}}),/REVIEW_STALE/);tx.approve(r);put(tx.candidate,'openclaw.json','changed-after-review');
 await assert.rejects(tx.publish({review:r,validate:()=>{},seal:()=>{}}),/REVIEW_STALE/);Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);put(f.profileDir,'openclaw.json','unexpected-drift');
 await assert.rejects(tx.publish({review:r,validate:()=>{},seal:()=>{}}),/PROFILE_CHANGED/);assert.equal(get(f.profileDir,'openclaw.json'),'unexpected-drift');
 await assert.rejects(beginSetupTransaction({...f,stop}),/CANDIDATE_BASE_CHANGED/);
});
test('validation rejection restores the original profile without erasing history',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');put(f.profileDir,'history.json','existing-history');const before=treeIdentity(f.profileDir),tx=await beginSetupTransaction({...f,stop}),r=review();put(tx.candidate,'openclaw.json','candidate');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);
 await assert.rejects(tx.publish({review:r,validate:()=>{throw Error('REJECTED');},seal:()=>assert.fail()}),/REJECTED/);assert.equal(treeIdentity(f.profileDir),before);assert.equal(transactionStatus(f.directory).state,'rolled-back');
});
test('a validating CLI may not silently mutate approved configuration before sealing',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');const tx=await beginSetupTransaction({...f,stop}),r=review();put(tx.candidate,'openclaw.json','reviewed');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);
 await assert.rejects(tx.publish({review:r,validate:()=>put(f.profileDir,'openclaw.json','startup-migration'),seal:()=>assert.fail()}),/REVIEW_STALE/);assert.equal(get(f.profileDir,'openclaw.json'),'original');
});
test('unexpected immutable startup mutation fails closed and retains the previous profile',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');let stops=0;const tx=await beginSetupTransaction({...f,stop:async()=>{stops++;}}),r=review();put(tx.candidate,'openclaw.json','reviewed');put(tx.candidate,'seal','reviewed');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>put(f.profileDir,'seal','reviewed')});
 await assert.rejects(tx.complete(()=>{put(f.profileDir,'openclaw.json','unreviewed-hot-reload');throw Error('COMPUTE_POLICY_CHANGED');}),/POLICY_CHANGED/);assert.equal(get(f.profileDir,'openclaw.json'),'unreviewed-hot-reload');assert.equal(get(tx.previous,'openclaw.json'),'original');assert.equal(tx.state.rollbackFailureCode,'SETUP_ROLLBACK_RUNTIME_CHANGED');assert.ok(stops>=3);
});
test('interruption between directory renames recovers the original before another attempt',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');const tx=await beginSetupTransaction({...f,stop});tx.state.state='publishing';tx.save();fs.renameSync(f.profileDir,tx.previous);
 const resumed=await beginSetupTransaction({...f,stop});assert.equal(get(f.profileDir,'openclaw.json'),'original');assert.equal(get(resumed.candidate,'openclaw.json'),'original');assert.notEqual(resumed.state.id,tx.state.id);
});
test('failed stop never swaps an active profile and creates an explicit stop marker',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');let fail=false;const tx=await beginSetupTransaction({...f,stop:async()=>{if(fail)throw Error('STILL_RUNNING');}}),r=review();put(tx.candidate,'openclaw.json','candidate');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});fail=true;
 await assert.rejects(tx.rollback(),/ROLLBACK_STOP_REQUIRED/);assert.equal(get(f.profileDir,'openclaw.json'),'candidate');assert.equal(get(tx.previous,'openclaw.json'),'original');assert.ok(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')));assert.equal(transactionStatus(f.directory).state,'safe-stop-required');
});
test('completed upgrade supports explicit stopped rollback, while symlinked state is rejected',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');const tx=await beginSetupTransaction({...f,stop}),r=review();put(tx.candidate,'openclaw.json','candidate');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});await tx.complete(()=>{});await restoreSetupTransaction(f.directory,{stop});assert.equal(get(f.profileDir,'openclaw.json'),'original');
 fs.symlinkSync('/etc/passwd',path.join(f.profileDir,'foreign'));await assert.rejects(beginSetupTransaction({...f,stop}),/STATE_OWNER_REQUIRED/);
});
test('rollback carries forward allowances and accepted work written after activation',async t=>{
 const f=fixture(t);put(f.profileDir,'compute-journal.json',JSON.stringify({calls:[1]}));const tx=await beginSetupTransaction({...f,stop}),r=review();Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});put(f.profileDir,'COMPUTE_STOP','setup-owned');await tx.complete(()=>{},()=>fs.rmSync(path.join(f.profileDir,'COMPUTE_STOP')));put(f.profileDir,'compute-journal.json',JSON.stringify({calls:[1,2],requests:['accepted']}));
 await restoreSetupTransaction(f.directory,{stop});assert.equal(transactionStatus(f.directory).state,'rolled-back');assert.deepEqual(JSON.parse(get(f.profileDir,'compute-journal.json')),{calls:[1,2],requests:['accepted']});
});
test('snapshot preserves owner executable helpers while credentials remain private',async t=>{
 const f=fixture(t);put(f.profileDir,'helper.sh','\x23!/bin/sh\nexit 0\n');fs.chmodSync(path.join(f.profileDir,'helper.sh'),0o755);put(f.profileDir,'auth.json','private');const tx=await beginSetupTransaction({...f,stop});assert.equal(fs.statSync(path.join(tx.candidate,'helper.sh')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(tx.candidate,'auth.json')).mode&0o777,0o600);
});

test('OAuth accepts only pinned provider metadata and empty starter catalog registration',()=>{
 const before={auth:{profiles:{'openai:agi-compute-pro':{provider:'openai',mode:'oauth'}},order:{openai:['openai:agi-compute-pro']}},agents:{defaults:{model:{primary:'openai/another-supported-model'},models:{'openai/another-supported-model':{agentRuntime:{id:'openclaw'}}}}},tools:{deny:['gateway']},gateway:{bind:'loopback',auth:{token:'NEVER-EXPORT-THIS-TOKEN'}}};
 const after=structuredClone(before);after.auth.profiles['openai:agi-compute-pro'].email='PRIVATE-EMAIL';after.agents.defaults.models['openai/gpt-6-astra']={};after.meta={lastTouchedVersion:'2026.9.5',lastTouchedAt:new Date().toISOString()};assert.doesNotThrow(()=>assertAuthorizedOAuthChanges(before,after));
 for(const change of [v=>v.tools.deny=[],v=>v.gateway.bind='all',v=>v.agents.defaults.model.primary='openai/unapproved',v=>v.plugins={allow:['foreign']},v=>v.auth.profiles['openai:agi-compute-pro'].mode='api_key']){const changed=structuredClone(after);change(changed);assert.throws(()=>assertAuthorizedOAuthChanges(before,changed),/OAUTH_SECURITY_CHANGED/);}
 const report=securityReview({},before,{},{});assert.equal(JSON.stringify(report).includes('NEVER-EXPORT-THIS-TOKEN'),false);assert.equal(JSON.stringify(report).includes('PRIVATE-EMAIL'),false);
});

test('unchanged inherited OAuth metadata is retained while newly written versions remain pinned',()=>{
 const before={auth:{profiles:{'openai:agi-compute-pro':{provider:'openai',mode:'oauth'}},order:{openai:['openai:agi-compute-pro']}},meta:{lastTouchedVersion:'2026.9.5',lastTouchedAt:'2026-09-05T00:00:00Z'}};
 assert.doesNotThrow(()=>assertAuthorizedOAuthChanges(before,structuredClone(before)));
 const earlier=structuredClone(before);earlier.meta.lastTouchedVersion='2026.9.4';assert.doesNotThrow(()=>assertAuthorizedOAuthChanges(earlier,before));
 for(const version of ['2026.9.4','2026.9.6','2026.9.7','unapproved-runtime']){const changed=structuredClone(before);changed.meta.lastTouchedVersion=version;assert.throws(()=>assertAuthorizedOAuthChanges(before,changed),/OPENCLAW_OAUTH_SECURITY_CHANGED/);}
});

 test('security review never prints removed provider or wallet secrets, including unknown settings',()=>{
 const secrets=['API_CANARY','PRIVATE_CANARY','RECOVERY_CANARY','UNKNOWN_CANARY'];
 const review=securityReview({models:{providers:{openai:{apiKey:secrets[0],API_KEY:secrets[0]}}},wallet:{privateKey:secrets[1],mnemonic:secrets[2]},custom:{opaqueSetting:secrets[3]},tools:{allow:['read']}},{tools:{allow:['read','exec']}},{},{maxRuns24h:4});
 const rendered=JSON.stringify(review);for(const secret of secrets)assert.equal(rendered.includes(secret),false);
 assert.ok(review.changes.some(x=>x.path==='gateway.tools.allow'&&x.afterValue.includes('exec')));
 assert.ok(review.changes.some(x=>x.path==='settings.maxRuns24h'&&x.afterValue===4));
 });

for(const stage of ['publish','complete'])test(`${stage} preserves the primary exception and rollback failure through successful outer recovery`,async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');let refuseStop=false;
 const tx=await beginSetupTransaction({...f,stop:async()=>{if(refuseStop)throw Error('process remained alive');}}),r=review();put(tx.candidate,'openclaw.json','reviewed');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);
 const primary=Error(stage==='publish'?'OPENCLAW_CONFIG_REJECTED':'COMPUTE_SERVICE_HEALTH_FAILED');
 const fail=()=>{refuseStop=true;throw primary;};
 if(stage==='complete')await tx.publish({review:r,validate:()=>{},seal:()=>{}});
 await assert.rejects(stage==='publish'?tx.publish({review:r,validate:fail,seal:()=>assert.fail()}):tx.complete(fail),error=>{assert.equal(error,primary);assert.equal(error.primaryFailureCode,primary.message);assert.equal(error.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');return true;});
 let status=transactionStatus(f.directory);assert.equal(status.state,'safe-stop-required');assert.equal(status.primaryFailureCode,primary.message);assert.equal(status.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(get(f.profileDir,'openclaw.json'),'reviewed');
 refuseStop=false;await tx.rollback();status=transactionStatus(f.directory);assert.equal(status.state,'rolled-back');assert.equal(status.primaryFailureCode,primary.message);assert.equal(status.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(get(f.profileDir,'openclaw.json'),'original');
 const evidence=get(f.directory,'transaction.json');await tx.rollback();assert.equal(get(f.directory,'transaction.json'),evidence);assert.equal(get(f.profileDir,'openclaw.json'),'original');
});

test('fresh installation recovers after an activation failure and a transient rollback stop failure',async t=>{
 const f=fixture(t);let refuseStop=false;const tx=await beginSetupTransaction({...f,stop:async()=>{if(refuseStop)throw Error('running');}}),r=review();put(tx.candidate,'openclaw.json','new-profile');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});
 await assert.rejects(tx.complete(()=>{},()=>{refuseStop=true;throw Error('COMPUTE_POLICY_CHANGED');}),/COMPUTE_POLICY_CHANGED/);assert.equal(tx.state.rollbackFromState,'complete');assert.equal(tx.state.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');
 refuseStop=false;await tx.rollback();assert.equal(fs.existsSync(f.profileDir),false);assert.equal(get(tx.candidate,'openclaw.json'),'new-profile');assert.equal(tx.state.state,'rolled-back');await tx.rollback();assert.equal(tx.state.primaryFailureCode,'COMPUTE_POLICY_CHANGED');assert.equal(fs.existsSync(f.profileDir),false);
});

test('persisted failure diagnostics allowlist codes and never save exception details or injected fields',async t=>{
 const f=fixture(t),tx=await beginSetupTransaction({...f,stop});const error=Error('Bearer SECRET_OAUTH_CANARY');error.primaryFailureCode='SECRET_PRIMARY_CANARY';error.rollbackFailureCode='SECRET_ROLLBACK_CANARY';error.stdout='SECRET_STDOUT_CANARY';
 assert.deepEqual(tx.recordFailure(error),{primaryFailureCode:'SETUP_STAGE_FAILED',rollbackFailureCode:null});assert.deepEqual(tx.recordFailure(Error('secret passphrase'),{rollback:true}),{primaryFailureCode:'SETUP_STAGE_FAILED',rollbackFailureCode:'SETUP_STAGE_FAILED'});
 const saved=get(f.directory,'transaction.json');assert.equal(/SECRET|passphrase|Bearer/.test(saved),false);tx.state.primaryFailureCode='SECRET_MANIPULATED_STATE';tx.save();assert.equal(transactionStatus(f.directory).primaryFailureCode,'SETUP_STAGE_FAILED');assert.equal(JSON.stringify(transactionStatus(f.directory)).includes('SECRET'),false);
});

const fileEvidence=root=>{const records={};const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())visit(file);else records[path.relative(root,file)]=fs.readFileSync(file).toString('base64');}};visit(root);return records;};
test('a rolled-back failed candidate with rebased paths is archived byte-for-byte rather than resumed',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','old-profile');put(f.profileDir,'journals.json','old-accepted-work');const tx=await beginSetupTransaction({...f,stop}),r=review();put(tx.candidate,'openclaw.json',{plugin:path.join(f.profileDir,'plugins/public-browser/index.mjs')});put(tx.candidate,'plugins/public-browser/index.mjs','retained-plugin');Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});
 await assert.rejects(tx.complete(()=>{put(f.profileDir,'service.log','AGI work studio ready on localhost. No wallet is loaded.');throw Error('COMPUTE_SERVICE_HEALTH_FAILED');}),/COMPUTE_SERVICE_HEALTH_FAILED/);assert.equal(fs.existsSync(path.join(f.profileDir,'plugins/public-browser/index.mjs')),false);
 const failedName=tx.state.failedCandidate,before=fileEvidence(f.directory),id=tx.state.id;assert.ok(failedName);assert.equal(get(path.join(f.directory,failedName),'plugins/public-browser/index.mjs'),'retained-plugin');
 const fresh=await beginSetupTransaction({...f,stop});assert.notEqual(fresh.state.id,id);assert.equal(fresh.state.treeIdentityVersion,3);assert.equal(fresh.state.stagingProtocolVersion,2);assert.equal(fresh.state.primaryFailureCode,undefined);assert.equal(get(fresh.candidate,'openclaw.json'),'old-profile');assert.equal(get(fresh.candidate,'journals.json'),'old-accepted-work');assert.deepEqual(fileEvidence(f.directory+'-archive-'+id),before);
});

for(const state of ['prepared','approved'])test(`a failed ${state} attempt is archived before starting a new attempt with fresh failure codes`,async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','old-profile');const tx=await beginSetupTransaction({...f,stop});put(tx.candidate,'private-draft.json','draft-evidence');if(state==='approved'){const r=bindPreparedReviewFixture(tx,review());tx.approve(r);}tx.recordFailure(Error('SETUP_CANCELLED'));const before=fileEvidence(f.directory),id=tx.state.id;
 const fresh=await beginSetupTransaction({...f,stop});assert.notEqual(fresh.state.id,id);assert.deepEqual(fileEvidence(f.directory+'-archive-'+id),before);assert.equal(fresh.state.primaryFailureCode,undefined);assert.equal(fs.existsSync(path.join(fresh.candidate,'private-draft.json')),false);
});

test('automatic transaction archival never replaces an existing archive with the same id',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','old-profile');const tx=await beginSetupTransaction({...f,stop});tx.recordFailure(Error('SETUP_CANCELLED'));const before=fileEvidence(f.directory),archive=f.directory+'-archive-'+tx.state.id;put(archive,'retained-evidence.txt','older-evidence');
 const fresh=await beginSetupTransaction({...f,stop});assert.notEqual(fresh.state.id,tx.state.id);assert.equal(get(archive,'retained-evidence.txt'),'older-evidence');const archives=fs.readdirSync(f.root).filter(name=>name.startsWith(path.basename(archive)+'-'));assert.equal(archives.length,1);assert.deepEqual(fileEvidence(path.join(f.root,archives[0])),before);
});

test('failure receipt write errors never replace the original service exception and are disclosed',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');const tx=await beginSetupTransaction({...f,stop}),r=bindPreparedReviewFixture(tx,review());tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});
 const save=tx.save.bind(tx);let rejectedWrites=0;tx.save=()=>{if(rejectedWrites++===0)throw Error('PRIVATE_DISK_ERROR_CANARY');save();};
 const primary=Error('COMPUTE_SERVICE_HEALTH_FAILED');await assert.rejects(tx.complete(()=>{throw primary;}),error=>{assert.equal(error,primary);assert.equal(error.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.rollbackFailureCode,null);assert.equal(error.failureRecordingFailed,true);return true;});
 assert.equal(get(f.profileDir,'openclaw.json'),'original');const status=transactionStatus(f.directory);assert.equal(status.state,'rolled-back');assert.equal(status.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(status.failureRecordingFailed,true);assert.equal(get(f.directory,'transaction.json').includes('PRIVATE_DISK_ERROR_CANARY'),false);
});

test('rollback stop failure remains identifiable even when both failure receipt writes are unavailable',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');let refuseStop=false;const tx=await beginSetupTransaction({...f,stop:async()=>{if(refuseStop)throw Error('still running');}}),r=bindPreparedReviewFixture(tx,review());tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});
 const save=tx.save.bind(tx),primary=Error('COMPUTE_SERVICE_HEALTH_FAILED');tx.save=()=>{throw Error('PRIVATE_STORAGE_CANARY');};
 await assert.rejects(tx.complete(()=>{refuseStop=true;throw primary;}),error=>{assert.equal(error,primary);assert.equal(error.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(error.failureRecordingFailed,true);return true;});
 assert.equal(tx.state.state,'safe-stop-required');assert.equal(tx.state.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(fs.existsSync(tx.previous),true);
 tx.save=save;refuseStop=false;await tx.rollback();assert.equal(get(f.profileDir,'openclaw.json'),'original');assert.equal(transactionStatus(f.directory).rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(transactionStatus(f.directory).failureRecordingFailed,true);assert.equal(get(f.directory,'transaction.json').includes('PRIVATE_STORAGE_CANARY'),false);
});

for(const failurePoint of ['stop-marker','receipt'])test(`direct rollback keeps its known stop failure when ${failurePoint} writing fails`,async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');let refuseStop=false;const tx=await beginSetupTransaction({...f,stop:async()=>{if(refuseStop)throw Error('still running');}}),r=bindPreparedReviewFixture(tx,review());put(tx.candidate,'openclaw.json','candidate');Object.assign(r,bindPreparedReviewFixture(tx,review()));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});
 const save=tx.save.bind(tx),rename=fs.renameSync,marker=path.join(f.profileDir,'COMPUTE_STOP');let mock;
 if(failurePoint==='receipt')tx.save=()=>{throw Error('PRIVATE_RECEIPT_CANARY');};
 else mock=t.mock.method(fs,'renameSync',(source,target)=>{if(target===marker)throw Error('PRIVATE_MARKER_CANARY');return rename(source,target);});
 refuseStop=true;await assert.rejects(tx.rollback(),error=>{assert.equal(error.message,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(error.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(error.primaryFailureCode,null);assert.equal(error.failureRecordingFailed,true);return true;});
 assert.equal(tx.state.state,'safe-stop-required');assert.equal(tx.state.rollbackFromState,'sealed');assert.equal(get(f.profileDir,'openclaw.json'),'candidate');assert.equal(get(tx.previous,'openclaw.json'),'original');if(failurePoint==='stop-marker')assert.equal(fs.existsSync(marker),false);
 mock?.mock.restore();tx.save=save;refuseStop=false;await tx.rollback();assert.equal(get(f.profileDir,'openclaw.json'),'original');assert.equal(transactionStatus(f.directory).rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(transactionStatus(f.directory).failureRecordingFailed,true);assert.equal(/PRIVATE_(RECEIPT|MARKER)_CANARY/.test(get(f.directory,'transaction.json')),false);
});

async function safeStopFixture(t){
 const f=fixture(t);put(f.profileDir,'openclaw.json',{profile:'old',limits:{maxRuns24h:2,maxImages24h:1}});put(f.profileDir,'COMPUTE_STOP','operator-pause-before-migration');put(f.profileDir,'compute-journal.json',{requests:['accepted-before-upgrade'],allowance:17});put(f.profileDir,'sessions/history.jsonl','{"event":"retained-session"}\n');put(f.root,'signer-wallet.vault','encrypted-wallet-fixture-outside-compute');
 for(const role of ['agi-creator','agi-checker','agi-reviewer'])put(f.profileDir,'agents/'+role+'/agent/auth-profiles.json',{fixtureOAuth:role});
 const original=fileEvidence(f.profileDir);let refused=false,stopCalls=0;
 const stop=async()=>{stopCalls++;if(refused)throw Error('still-running');};
 const tx=await beginSetupTransaction({...f,stop});delete tx.state.runtimeSecurityVersion;tx.state.id='7afbac88-48a0-4452-ac48-951d50485d91';tx.state.completedIdentity=null;put(tx.candidate,'openclaw.json',{profile:'reviewed',plugin:path.join(f.profileDir,'plugins/public-browser/index.mjs'),limits:{maxRuns24h:2,maxImages24h:1}});put(tx.candidate,'plugins/public-browser/index.mjs','retained-plugin');const r=bindPreparedReviewFixture(tx,review());tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});
 await assert.rejects(tx.complete(()=>{put(f.profileDir,'service.log','AGI work studio ready on localhost. No wallet is loaded.');refused=true;throw Error('SETUP_STATE_FILE_UNSUPPORTED');}),/SETUP_STATE_FILE_UNSUPPORTED/);
 return {...f,tx,original,stop,get stopCalls(){return stopCalls;},allowStop(){refused=false;}};
}

test('reported v3 safe-stop failure recovers automatically and archives exact original receipt plus failed candidate',async t=>{
 const f=await safeStopFixture(t),before=get(f.directory,'transaction.json'),failed=fileEvidence(f.profileDir),originalWallet=get(f.root,'signer-wallet.vault');
 assert.equal(f.tx.state.state,'safe-stop-required');assert.equal(f.tx.state.completedIdentity,null);f.allowStop();
 const fresh=await beginSetupTransaction({...f,stop:f.stop}),archive=f.directory+'-archive-'+f.tx.state.id,saved=JSON.parse(get(archive,'transaction.json'));
 assert.equal(get(archive,'recovery-evidence/transaction-before-recovery.json'),before);assert.equal(saved.state,'rolled-back');assert.equal(saved.primaryFailureCode,'SETUP_STATE_FILE_UNSUPPORTED');assert.equal(saved.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(saved.completedIdentity,null);assert.equal(saved.recoveryEvidence.state,'safe-stop-required');assert.equal(saved.recoveryEvidence.treeIdentityVersion,3);assert.equal(saved.recoveryEvidence.stagingProtocolVersion,2);
 assert.deepEqual(fileEvidence(path.join(archive,saved.failedCandidate)),failed);assert.deepEqual(fileEvidence(f.profileDir),f.original);assert.deepEqual(fileEvidence(fresh.candidate),f.original);assert.equal(get(f.root,'signer-wallet.vault'),originalWallet);assert.equal(fresh.state.treeIdentityVersion,3);assert.equal(fresh.state.stagingProtocolVersion,2);assert.notEqual(fresh.state.id,f.tx.state.id);assert.equal(fresh.state.approval,null);assert.equal(fresh.state.primaryFailureCode,undefined);assert.equal(get(f.profileDir,'COMPUTE_STOP'),'operator-pause-before-migration');assert.equal(transactionStatus(archive).recoveryEvidence.sha256,saved.recoveryEvidence.sha256);
});

test('automatic restore retries retain the first exact safe-stop receipt before recovery and archival',async t=>{
 const f=await safeStopFixture(t),before=get(f.directory,'transaction.json'),checkpoint='recovery-evidence/transaction-before-recovery.json';
 for(let attempt=0;attempt<2;attempt++){await assert.rejects(restoreSetupTransaction(f.directory,{stop:f.stop}),/SETUP_ROLLBACK_STOP_REQUIRED/);assert.equal(get(f.directory,checkpoint),before);assert.equal(transactionStatus(f.directory).recoveryEvidence.state,'safe-stop-required');assert.equal(get(f.profileDir,'COMPUTE_STOP'),'operator-pause-before-migration');}
 const checkpointStat=fs.statSync(path.join(f.directory,checkpoint));assert.equal(checkpointStat.mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(path.join(f.directory,checkpoint))).mode&0o777,0o700);
 f.allowStop();const restored=await restoreSetupTransaction(f.directory,{stop:f.stop});assert.equal(restored.state,'rolled-back');assert.equal(restored.primaryFailureCode,'SETUP_STATE_FILE_UNSUPPORTED');assert.equal(restored.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(get(f.directory,checkpoint),before);assert.deepEqual(fileEvidence(f.profileDir),f.original);
 const fresh=await beginSetupTransaction({...f,stop:f.stop});assert.notEqual(fresh.state.id,f.tx.state.id);assert.equal(get(f.directory+'-archive-'+f.tx.state.id,checkpoint),before);
});

for(const substitution of ['directory-symlink','file-symlink','foreign-record','non-private','oversized','tampered','missing'])test(`recovery checkpoint refuses ${substitution} before invoking stop or changing the live profile`,async t=>{
 const f=await safeStopFixture(t),root=path.join(f.directory,'recovery-evidence'),target=path.join(root,'transaction-before-recovery.json'),outside=path.join(f.root,'outside');fs.mkdirSync(outside,{mode:0o700});
 if(substitution==='directory-symlink')fs.symlinkSync(outside,root);
 else{
  fs.mkdirSync(root,{mode:0o700});
  if(substitution==='file-symlink'){put(outside,'receipt','must-not-follow');fs.symlinkSync(path.join(outside,'receipt'),target);}
  if(substitution==='foreign-record')fs.writeFileSync(target,JSON.stringify({...f.tx.state,state:'complete'}),{mode:0o600});
  if(substitution==='non-private'){fs.writeFileSync(target,get(f.directory,'transaction.json'),{mode:0o644});fs.chmodSync(target,0o644);}
  if(substitution==='oversized')fs.writeFileSync(target,Buffer.alloc(1048577),{mode:0o600});
  if(['tampered','missing'].includes(substitution)){f.tx.preserveRecoveryEvidence();if(substitution==='missing')fs.unlinkSync(target);else fs.appendFileSync(target,' ');}
 }
 const live=fileEvidence(f.profileDir),receipt=get(f.directory,'transaction.json'),calls=f.stopCalls;
 await assert.rejects(restoreSetupTransaction(f.directory,{stop:f.stop}),/SETUP_(STATE_OWNER_REQUIRED|RECOVERY_EVIDENCE_INVALID)/);assert.equal(f.stopCalls,calls);assert.deepEqual(fileEvidence(f.profileDir),live);assert.equal(get(f.directory,'transaction.json'),receipt);if(substitution==='file-symlink')assert.equal(get(outside,'receipt'),'must-not-follow');
});

test('a checkpoint created just before interruption is adopted only when its bytes match the current receipt',async t=>{
 const f=await safeStopFixture(t),before=get(f.directory,'transaction.json');put(f.directory,'recovery-evidence/transaction-before-recovery.json',before);f.allowStop();const restored=await restoreSetupTransaction(f.directory,{stop:f.stop});assert.equal(restored.state,'rolled-back');assert.equal(get(f.directory,'recovery-evidence/transaction-before-recovery.json'),before);assert.deepEqual(fileEvidence(f.profileDir),f.original);
});
