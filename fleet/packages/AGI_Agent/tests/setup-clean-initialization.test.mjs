import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {prepareCleanCandidateInitialization,finishCleanCandidateInitialization,isCleanInitializationReceipt} from '../compute/setup-clean-initialization.mjs';
import {treeIdentity} from '../compute/setup-transaction.mjs';
import {inspectExecutable} from '../compute/runtime-env.mjs';
import {captureRuntimeSecurityIdentity,assertRuntimeSecurityIdentity} from '../compute/setup-runtime-identity.mjs';
import {cleanInitializationFixture} from './clean-initialization-fixture.mjs';
import {computeProfile} from '../compute/profile.mjs';
import {prepareCandidateState,finishCandidateStatePreparation} from '../compute/setup-state-preparation.mjs';
import {makePublicBrowserPolicy,installPublicBrowserPlugin,applyPublicBrowserProfile} from '../compute/public-browser-config.mjs';

import {realCleanInitializationFixture as fixture} from './clean-initialization-real-fixture.mjs';

const packageRoot=process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT??'/tmp/agi-auth-staging-runtime-9.5/node_modules/openclaw';
const available=fs.existsSync(path.join(packageRoot,'package.json'));
const sdk={skip:available?false:'Pinned OpenClaw 2026.9.5 package unavailable',timeout:120000};
const contract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url)));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function finish(f,receipt){f.state.cleanInitializationReceipt=receipt;f.save();finishCleanCandidateInitialization({...f.args,receipt});}
function reject(mutator,code){const f=fixture();try{mutator(f);let invoked=false;assert.throws(()=>prepareCleanCandidateInitialization({...f.args,run(){invoked=true;throw Error('MUST_NOT_RUN');}}),new RegExp('^Error: '+code+'$'));assert.equal(invoked,false);}finally{f.close();}}

test('fresh initialization rejects installed profiles and any legacy transaction before execution',()=>{
 reject(f=>{fs.mkdirSync(f.profileDir,{mode:0o700});},'SETUP_CLEAN_INSTALL_REQUIRED');
 reject(f=>{f.state.previousExisted=true;f.save();},'SETUP_CLEAN_INSTALL_REQUIRED');
 reject(f=>{f.state.state='approved';f.save();},'SETUP_CLEAN_INITIALIZATION_FAILED');
});
test('fresh initialization rejects symlinks, live aliases and stale or incomplete initialization',()=>{
 reject(f=>{fs.symlinkSync(f.root,path.join(f.candidate,'redirect'));},'SETUP_STATE_OWNER_REQUIRED');
 reject(f=>{f.args.candidate=f.profileDir;},'SETUP_CLEAN_INITIALIZATION_FAILED');
 for(const file of ['clean-initialization-in-progress.json','clean-initialization-receipt.json'])reject(f=>{fs.writeFileSync(path.join(f.directory,file),'{}',{mode:0o600});},'SETUP_CLEAN_INITIALIZATION_INCOMPLETE');
});
test('initialization receipt admits only explicit initialization evidence, never secrets or additional effects',()=>{
 const good=cleanInitializationFixture();assert.equal(isCleanInitializationReceipt(good),true);
 for(const bad of [{...good,key:'SECRET'},{...good,verified:false},{...good,revisionKeyCreated:'yes'},{...good,destinationIdentity:'invalid'},{...good,otherFilesPreserved:false}])assert.equal(isCleanInitializationReceipt(bad),false);
});
test('pinned APIs create both keys before approval, preserve every other row and file, and bind finalization',sdk,()=>{
 const f=fixture();try{
  const journal=fs.readFileSync(path.join(f.candidate,'compute-journal.json')),config=fs.readFileSync(path.join(f.candidate,'openclaw.json'));
  const receipt=prepareCleanCandidateInitialization(f.args);assert.equal(isCleanInitializationReceipt(receipt),true);assert.equal(receipt.revisionKeyCreated,true);assert.equal(receipt.fingerprintKeyCreated,true);assert.equal(receipt.revisionSchemaCreated,false);assert.equal(receipt.sourceStateSchemaSha256,receipt.destinationStateSchemaSha256);
  assert.deepEqual(fs.readFileSync(path.join(f.candidate,'compute-journal.json')),journal);assert.deepEqual(fs.readFileSync(path.join(f.candidate,'openclaw.json')),config);assert.equal(fs.existsSync(f.profileDir),false);
  const db=new DatabaseSync(f.file,{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM config_revision_keys').get().n,1);assert.equal(db.prepare('SELECT length(hmac_key) AS n FROM config_revision_keys WHERE id=1').get().n,32);assert.equal(db.prepare("SELECT value_json FROM config_machine_state WHERE state_key='auth.sharedStore'").get().value_json,'{"location":"state-db"}');db.close();
  const key=path.join(f.candidate,'config-journal-fingerprint.key');assert.equal(fs.statSync(key).size,32);assert.equal(fs.statSync(key).mode&0o777,0o600);
  assert.equal(receipt.deviceIdentityCreated,true);assert.equal(receipt.systemJobCount,6);assert.equal(receipt.schedulerEnabled,false);assert.equal(receipt.runtimeArtifactsPrepared,true);assert.equal(receipt.pluginIndexPrepared,true);assert.equal(receipt.bundledDiscoveryInitialized,true);assert.match(receipt.pluginIndexSha256,/^[a-f0-9]{64}$/);
  assert.equal(sha(fs.readFileSync(path.join(f.candidate,'tmp/agent-cli/openclaw'))),receipt.cliShimSha256);
  for(const base of [f.candidate,f.profileDir]){const lock=path.join(f.candidate,'tmp','openclaw-'+process.getuid(),'device-identity.'+sha(path.join(base,'state/openclaw.sqlite')).slice(0,8)+'.lock.sqlite');assert.equal(fs.statSync(lock).size,0);assert.equal(fs.statSync(lock).mode&0o777,0o600);}
  assert.throws(()=>finishCleanCandidateInitialization({...f.args,receipt}),/^Error: SETUP_CLEAN_INITIALIZATION_FAILED$/);finish(f,receipt);assert.equal(fs.existsSync(path.join(f.directory,'clean-initialization-in-progress.json')),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory,'clean-initialization-receipt.json'))),receipt);assert.doesNotMatch(JSON.stringify(receipt),/auth\.sharedStore|location|hmac_key/);
 }finally{f.close();}
});
test('pinned APIs preserve already-initialized keys while materializing only the reviewed runtime artifacts',sdk,()=>{
 const f=fixture();try{
  const db=new DatabaseSync(f.file);db.prepare('INSERT INTO config_revision_keys VALUES(?,?)').run(1,Buffer.alloc(32,17));db.close();fs.writeFileSync(path.join(f.candidate,'config-journal-fingerprint.key'),Buffer.alloc(32,23),{mode:0o600});
  const receipt=prepareCleanCandidateInitialization(f.args);
  assert.equal(receipt.revisionKeyCreated,false);assert.equal(receipt.fingerprintKeyCreated,false);const checked=new DatabaseSync(f.file,{readOnly:true});assert.deepEqual(Buffer.from(checked.prepare('SELECT hmac_key FROM config_revision_keys').get().hmac_key),Buffer.alloc(32,17));checked.close();assert.deepEqual(fs.readFileSync(path.join(f.candidate,'config-journal-fingerprint.key')),Buffer.alloc(32,23));finish(f,receipt);
 }finally{f.close();}
});
test('pinned API initializer permits only the exact lazy revision-key schema',sdk,()=>{
 const f=fixture();try{const db=new DatabaseSync(f.file);db.exec('DROP TABLE config_revision_keys');db.close();const receipt=prepareCleanCandidateInitialization(f.args);assert.equal(receipt.revisionSchemaCreated,true);assert.equal(receipt.revisionKeyCreated,true);finish(f,receipt);}finally{f.close();}
});
test('unknown authority schema is rejected before any supported initialization API writes',sdk,()=>{
 const f=fixture();try{const db=new DatabaseSync(f.file);db.exec('CREATE TABLE unexpected_authority(permission TEXT) STRICT');db.close();const before=treeIdentity(f.candidate);assert.throws(()=>prepareCleanCandidateInitialization(f.args),/^Error: SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED$/);assert.equal(treeIdentity(f.candidate),before);assert.equal(fs.existsSync(path.join(f.candidate,'config-journal-fingerprint.key')),false);assert.equal(fs.existsSync(path.join(f.directory,'clean-initialization-in-progress.json')),true);}finally{f.close();}
});
test('existing malformed fingerprint key is rejected without overwriting it',sdk,()=>{
 const f=fixture();try{const file=path.join(f.candidate,'config-journal-fingerprint.key');fs.writeFileSync(file,'retain malformed evidence',{mode:0o600});const original=sha(fs.readFileSync(file));assert.throws(()=>prepareCleanCandidateInitialization(f.args),/^Error: SETUP_CLEAN_INITIALIZATION_CHANGED$/);assert.equal(sha(fs.readFileSync(file)),original);assert.equal(fs.existsSync(f.profileDir),false);}finally{f.close();}
});
test('finalization fails closed if candidate drifts after the initialization worker',sdk,()=>{
 const f=fixture();try{const receipt=prepareCleanCandidateInitialization(f.args);f.state.cleanInitializationReceipt=receipt;f.save();fs.writeFileSync(path.join(f.candidate,'openclaw.json'),'{"authority":"changed"}',{mode:0o600});assert.throws(()=>finishCleanCandidateInitialization({...f.args,receipt}),/^Error: SETUP_PROFILE_CHANGED$/);assert.equal(fs.existsSync(path.join(f.directory,'clean-initialization-in-progress.json')),true);}finally{f.close();}
});
test('new keys remain protected after initialization; mutation still rejects sealed identity',sdk,()=>{
 const f=fixture();try{const receipt=prepareCleanCandidateInitialization(f.args);finish(f,receipt);const record=captureRuntimeSecurityIdentity(f.candidate,{profileDir:f.profileDir});const db=new DatabaseSync(f.file);db.prepare('UPDATE config_revision_keys SET hmac_key=? WHERE id=1').run(Buffer.alloc(32,91));db.close();assert.throws(()=>assertRuntimeSecurityIdentity(f.candidate,record),/^Error: SETUP_PROFILE_CHANGED$/);}finally{f.close();}
});
test('pinned fresh state preparation followed by initialization works with actual lazy schema families',sdk,()=>{
 const f=fixture();try{fs.rmSync(path.join(f.candidate,'state'),{recursive:true});const preparation=prepareCandidateState(f.args);f.state.preparationReceipt=preparation;f.save();finishCandidateStatePreparation({...f.args,receipt:preparation});const receipt=prepareCleanCandidateInitialization(f.args);assert.equal(receipt.verified,true);assert.equal(receipt.systemJobCount,6);finish(f,receipt);assert.equal(fs.existsSync(f.profileDir),false);}finally{f.close();}
});
test('enabled autonomous scheduler is refused before a clean installation can be approved',sdk,()=>{
 const f=fixture();try{const file=path.join(f.candidate,'openclaw.json'),config=JSON.parse(fs.readFileSync(file));config.cron.enabled=true;fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});assert.throws(()=>prepareCleanCandidateInitialization(f.args),/^Error: SETUP_CLEAN_INITIALIZATION_FAILED$/);assert.equal(fs.existsSync(path.join(f.directory,'clean-initialization-receipt.json')),false);assert.equal(fs.existsSync(f.profileDir),false);}finally{f.close();}
});
test('unexpected pre-existing runtime shim or media payload is preserved and rejected',sdk,()=>{
 for(const relative of ['tmp/agent-cli/openclaw','media/outbound/unknown-document']){const f=fixture();try{const file=path.join(f.candidate,relative);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,'retain unreviewed private candidate evidence',{mode:0o600});assert.throws(()=>prepareCleanCandidateInitialization(f.args),/^Error: SETUP_CLEAN_INITIALIZATION_CHANGED$/);assert.equal(fs.readFileSync(file,'utf8'),'retain unreviewed private candidate evidence');assert.equal(fs.existsSync(f.profileDir),false);}finally{f.close();}}
});
test('generated executable, scheduler definitions and device identity remain fully protected',sdk,()=>{
 const f=fixture();try{const receipt=prepareCleanCandidateInitialization(f.args);finish(f,receipt);const record=captureRuntimeSecurityIdentity(f.candidate,{profileDir:f.profileDir});const shim=path.join(f.candidate,'tmp/agent-cli/openclaw'),original=fs.readFileSync(shim);fs.appendFileSync(shim,'\n# unapproved change\n');assert.throws(()=>assertRuntimeSecurityIdentity(f.candidate,record),/^Error: SETUP_PROFILE_CHANGED$/);fs.writeFileSync(shim,original);assertRuntimeSecurityIdentity(f.candidate,record);const db=new DatabaseSync(f.file);db.prepare('UPDATE cron_jobs SET enabled=1-enabled WHERE job_id=(SELECT job_id FROM cron_jobs LIMIT 1)').run();db.close();assert.throws(()=>assertRuntimeSecurityIdentity(f.candidate,record),/^Error: SETUP_PROFILE_CHANGED$/);}finally{f.close();}
});
test('Node role initializes only Checker and Reviewer and binds its dedicated CLI profile',sdk,()=>{
 const f=fixture({role:'node'});try{const config=JSON.parse(fs.readFileSync(path.join(f.candidate,'openclaw.json')));assert.equal(config.gateway.port,18900);const receipt=prepareCleanCandidateInitialization(f.args);assert.equal(receipt.systemJobCount,4);assert.equal(receipt.startupCheckpointCount,2);assert.match(fs.readFileSync(path.join(f.candidate,'tmp/agent-cli/openclaw'),'utf8'),/--profile agi-node-compute/);assert.equal(fs.existsSync(path.join(f.candidate,'agents/agi-creator')),false);finish(f,receipt);}finally{f.close();}
});

test('full initialized plugin authority and index metadata remain protected without projection exclusions',sdk,()=>{
 const f=fixture();try{
  const receipt=prepareCleanCandidateInitialization(f.args);finish(f,receipt);
  const record=captureRuntimeSecurityIdentity(f.candidate,{profileDir:f.profileDir});
  const db=new DatabaseSync(f.file);const original=db.prepare("SELECT * FROM config_machine_state WHERE state_key='plugins.installedIndex'").get();const parsed=JSON.parse(original.value_json);
  assert.ok(parsed.index.plugins.length>0);assert.equal(parsed.index.hostContractVersion,'2026.9.5');assert.ok(!original.value_json.includes(f.candidate));assert.ok(original.value_json.includes(f.profileDir));
  const plugin=parsed.index.plugins.find(item=>item.pluginId==='agi-public-browser');assert.ok(plugin);assert.ok(plugin.rootDir.startsWith(f.profileDir+'/'));
  for(const mutate of [value=>{value.index.plugins.find(item=>item.pluginId==='agi-public-browser').enabled=!plugin.enabled;},value=>{value.index.generatedAtMs++;},value=>{value.index.unrecognizedAuthority=true;}]){
   const changed=structuredClone(parsed);mutate(changed);db.prepare("UPDATE config_machine_state SET value_json=? WHERE state_key='plugins.installedIndex'").run(JSON.stringify(changed));
   assert.throws(()=>assertRuntimeSecurityIdentity(f.candidate,record),/^Error: SETUP_PROFILE_CHANGED$/);
   db.prepare("UPDATE config_machine_state SET value_json=? WHERE state_key='plugins.installedIndex'").run(original.value_json);assertRuntimeSecurityIdentity(f.candidate,record);
  }
  db.close();
 }finally{f.close();}
});
