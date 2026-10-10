import {preparedSecurityReviewFixture as securityReview,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {runtimeDatabase,seedRuntime} from './runtime-sqlite-fixture.mjs';
import {beginSetupTransaction,treeIdentity,snapshotProfile,restoreSetupTransaction} from '../compute/setup-transaction.mjs';
import {startPublicBrowserBroker,requestPublicBrowser} from '../compute/public-browser-broker.mjs';
import {publicBrowserRuntimeSocketPath,publicBrowserSocketsStopped} from '../compute/public-browser-runtime.mjs';
import {stopManagedServices} from '../compute/service-stop.mjs';

const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'agi-b5-')),profileDir=path.join(root,'p'),directory=path.join(root,'t'),cleanup=[],socketPath=publicBrowserRuntimeSocketPath(profileDir);
 fs.mkdirSync(profileDir,{mode:0o700});t.after(async()=>{for(const close of cleanup.reverse())await close();fs.rmSync(root,{recursive:true,force:true});fs.rmSync(path.dirname(socketPath),{recursive:true,force:true});});return {root,profileDir,directory,cleanup,socketPath};
}
async function sealed(f,{stop=async()=>{},legacy=false}={}){
 put(f.profileDir,'openclaw.json',{version:'previous',maxRuns24h:2});const tx=await beginSetupTransaction({...f,stop});if(legacy)delete tx.state.runtimeSecurityVersion;put(tx.candidate,'openclaw.json',{version:'reviewed',maxRuns24h:2});const review=bindPreparedReviewFixture(tx,securityReview({}, {}, {}, {}));tx.approve(review);await tx.publish({review,validate:()=>{},seal:()=>put(f.profileDir,'COMPUTE_STOP','setup-pause')});return tx;
}
async function liveBroker(f,socketPath=f.socketPath){const broker=await startPublicBrowserBroker({socketPath,...(socketPath===f.socketPath?{profileDir:f.profileDir}:{}),execute:async()=>({fixture:'broker-routed'})});f.cleanup.push(()=>broker.close());return broker;}

test('completion succeeds while an actual broker listens outside the durable profile and includes committed WAL state',async t=>{
 const f=fixture(t);seedRuntime(f.profileDir);put(f.profileDir,'agi-compute-profile.json',{openclaw:'2026.9.5',role:'agent'});const tx=await sealed(f),before=treeIdentity(f.profileDir,{ignoreStop:true});let db;
 try{
  await tx.complete(async()=>{
   await liveBroker(f);assert.equal(fs.lstatSync(f.socketPath).isSocket(),true);assert.equal(fs.lstatSync(f.socketPath).mode&0o777,0o600);assert.equal(fs.existsSync(path.join(f.profileDir,'web.sock')),false);
   assert.equal((await requestPublicBrowser({socketPath:f.socketPath,context:{agentId:'agi-reviewer',sessionKey:'agent:agi-reviewer:agi-work-11111111-1111-4111-8111-111111111111'},command:{action:'snapshot'}})).fixture,'broker-routed');
   db=runtimeDatabase(f.profileDir,'state').db;db.exec("INSERT INTO session_state_events(dedupe_key,session_key,agent_id,kind,actor_type,occurred_at,summary) VALUES('initial','work','agi-creator','completed','agent',1,'committed-before-activation')");put(f.profileDir,'compute-journal.json',{accepted:['retained'],allowance:11});
  });
  assert.equal(tx.state.state,'complete');assert.match(tx.state.completedIdentity,/^[a-f0-9]{64}$/);assert.notEqual(tx.state.completedIdentity,before);assert.equal(tx.state.completedIdentity,tx.state.sealedSecurityIdentity);assert.equal(fs.statSync(path.join(f.profileDir,'state/openclaw.sqlite-wal')).size>0,true);
  const copy=path.join(f.root,'snapshot');await snapshotProfile(f.profileDir,copy);const snapshot=new DatabaseSync(path.join(copy,'state/openclaw.sqlite'));assert.deepEqual(snapshot.prepare('SELECT summary FROM session_state_events').all().map(row=>row.summary),['committed-before-activation']);snapshot.close();assert.equal(fs.readFileSync(path.join(copy,'compute-journal.json'),'utf8'),fs.readFileSync(path.join(f.profileDir,'compute-journal.json'),'utf8'));
  db.exec("INSERT INTO session_state_events(dedupe_key,session_key,agent_id,kind,actor_type,occurred_at,summary) VALUES('later','work','agi-creator','completed','agent',2,'later-committed-work')");assert.notEqual(treeIdentity(f.profileDir,{ignoreStop:true}),tx.state.completedIdentity);db.close();db=null;await restoreSetupTransaction(f.directory,{stop:async()=>{}});const restored=runtimeDatabase(f.profileDir,'state').db;assert.equal(restored.prepare('SELECT count(*) AS n FROM session_state_events').get().n,2);restored.close();
 }finally{db?.close();}
});

test('an in-profile live broker still fails durable completion after successful verification',async t=>{
 const f=fixture(t);let broker,verified=false;const stop=async()=>{if(broker){await broker.close();broker=null;}};const tx=await sealed(f,{stop});tx.state.completedIdentity=null;tx.save();
 await assert.rejects(tx.complete(async()=>{broker=await startPublicBrowserBroker({socketPath:path.join(f.profileDir,'web.sock'),execute:async()=>({})});verified=true;}),error=>{assert.equal(error.message,'SETUP_STATE_FILE_UNSUPPORTED');assert.equal(error.primaryFailureCode,'SETUP_STATE_FILE_UNSUPPORTED');return true;});
 assert.equal(verified,true);assert.equal(tx.state.completedIdentity,null);assert.equal(tx.state.state,'rolled-back');assert.equal(fs.existsSync(path.join(f.profileDir,'web.sock')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(f.profileDir,'openclaw.json'))).version,'previous');await stop();
});

for(const relative of ['unexpected.sock','web.sock','nested/web.sock'])test(`strict identity and snapshot reject unexpected live socket ${relative}`,async t=>{
 const f=fixture(t),socketPath=path.join(f.profileDir,relative);fs.mkdirSync(path.dirname(socketPath),{recursive:true,mode:0o700});const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});f.cleanup.push(()=>new Promise(resolve=>server.close(resolve)));
 assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_FILE_UNSUPPORTED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'copy')),/SETUP_STATE_FILE_UNSUPPORTED/);
});

test('strict identity rejects real FIFO and symlink redirection even when named web.sock',async t=>{
 const f=fixture(t),fifo=path.join(f.profileDir,'web.sock'),result=spawnSync('mkfifo',[fifo],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(fs.lstatSync(fifo).isFIFO(),true);assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_FILE_UNSUPPORTED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'fifo-copy')),/SETUP_STATE_FILE_UNSUPPORTED/);
 fs.unlinkSync(fifo);await liveBroker(f);fs.symlinkSync(f.socketPath,fifo);assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'link-copy')),/SETUP_STATE_OWNER_REQUIRED/);
});

for(const type of ['character-device','block-device'])test(`strict identity rejects ${type} type returned by filesystem without opening it`,t=>{
 const f=fixture(t),file=path.join(f.profileDir,'web.sock');put(f.profileDir,'web.sock','placeholder');const lstat=fs.lstatSync,read=fs.readFileSync;t.mock.method(fs,'lstatSync',(candidate,...args)=>{const stat=lstat(candidate,...args);if(candidate!==file)return stat;stat.isFile=()=>false;stat.isDirectory=()=>false;stat.isCharacterDevice=()=>type==='character-device';stat.isBlockDevice=()=>type==='block-device';return stat;});t.mock.method(fs,'readFileSync',(candidate,...args)=>{assert.notEqual(candidate,file,'unsupported object must not be opened');return read(candidate,...args);});assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_FILE_UNSUPPORTED/);
});

for(const role of ['agent','node'])test('physical-Mac prefixed absence recovers old '+role+' safe-stop evidence after actual socket exit and both port checks',async t=>{
 const f=fixture(t),uid=504,labels=role==='agent'?['ai.montreal.agi-compute','ai.openclaw.agi-compute']:['ai.montreal.agi-node-compute','ai.openclaw.agi-node-compute'],ports=role==='agent'?[18894,18896]:[18898,18900];let broker,runtimeBroker,refuse=false;
 put(f.profileDir,'compute-journal.json',{accepted:['preserved'],allowance:11});put(f.profileDir,'agents/agi-reviewer/agent/auth-profiles.json',{private:'retained-OAuth-fixture'});
 const stop=async()=>{if(refuse)throw Error('old one-shot stop failure');};const tx=await sealed(f,{stop,legacy:true});tx.state.id='7afbac88-48a0-4452-ac48-951d50485d91';tx.state.completedIdentity=null;tx.save();
 await assert.rejects(tx.complete(async()=>{broker=await startPublicBrowserBroker({socketPath:path.join(f.profileDir,'web.sock'),execute:async()=>({})});runtimeBroker=await startPublicBrowserBroker({socketPath:f.socketPath,profileDir:f.profileDir,execute:async()=>({})});refuse=true;}),/SETUP_STATE_FILE_UNSUPPORTED/);
 const originalReceipt=fs.readFileSync(tx.file,'utf8');assert.equal(tx.state.state,'safe-stop-required');let failedRecoveryStops=0;
 await assert.rejects(beginSetupTransaction({...f,stop:async()=>{failedRecoveryStops++;throw Error('SETUP_SERVICE_STOP_UNCONFIRMED');}}),/SETUP_ROLLBACK_STOP_REQUIRED/);
 assert.equal(failedRecoveryStops,1);const checkpoint=fs.readFileSync(path.join(f.directory,'recovery-evidence/transaction-before-recovery.json'),'utf8');assert.equal(checkpoint,originalReceipt);assert.equal(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')),true);
 let elapsed=0,socketChecks=0;const diagnostics={},portChecks=new Map(ports.map(port=>[port,0])),prints=[];
 try{
  const boundedStop=()=>stopManagedServices({uid,labels,ports,timeoutMs:1000,pollIntervalMs:100,now:()=>elapsed,diagnostics,
   run:async(_command,args)=>{if(args[0]==='bootout')return {status:0};prints.push(args[1]);return elapsed<200?{status:0,stdout:'state = terminating'}:{status:113,stderr:`Bad request.\nCould not find service "${args[1].split('/').at(-1)}" in domain for user gui: ${uid}\n`};},
   probePort:async port=>{assert.ok(portChecks.has(port));portChecks.set(port,portChecks.get(port)+1);return elapsed<300;},
   sleep:async ms=>{elapsed+=ms;if(elapsed>=500&&broker){await broker.close();broker=null;await runtimeBroker.close();runtimeBroker=null;}},
   checkSockets:async signal=>{socketChecks++;assert.ok(elapsed>=300);assert.ok(ports.every(port=>portChecks.get(port)>0));return publicBrowserSocketsStopped({profileDir:f.profileDir,signal});}});
  const fresh=await beginSetupTransaction({...f,stop:boundedStop}),archive=f.directory+'-archive-'+tx.state.id,record=JSON.parse(fs.readFileSync(path.join(archive,'transaction.json')));
  assert.ok(elapsed>=500);assert.ok(socketChecks>=3);for(const port of ports)assert.ok(portChecks.get(port)>=6);for(const label of labels)assert.ok(prints.includes('gui/504/'+label));assert.equal(diagnostics.state,'passed');assert.deepEqual(diagnostics.portsClosed,{compute:true,gateway:true});assert.equal(diagnostics.socketsAbsent,true);
  for(const name of ['compute','gateway'])assert.deepEqual(diagnostics.launchctlPrint[name],{attempt:diagnostics.attempts,status:113,classification:'absent',badRequestPrefix:true});
  assert.equal(fs.existsSync(path.join(f.profileDir,'web.sock')),false);assert.equal(fs.existsSync(f.socketPath),false);assert.equal(JSON.parse(fs.readFileSync(path.join(f.profileDir,'openclaw.json'))).version,'previous');assert.equal(JSON.parse(fs.readFileSync(path.join(f.profileDir,'openclaw.json'))).maxRuns24h,2);assert.equal(fs.readFileSync(path.join(archive,'recovery-evidence/transaction-before-recovery.json'),'utf8'),checkpoint);assert.equal(record.primaryFailureCode,'SETUP_STATE_FILE_UNSUPPORTED');assert.equal(record.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(record.state,'rolled-back');assert.ok(fs.existsSync(path.join(archive,record.failedCandidate)));assert.notEqual(fresh.state.id,tx.state.id);assert.equal(fresh.state.approval,null);
  for(const root of [f.profileDir,fresh.candidate,path.join(archive,record.failedCandidate)]){assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'compute-journal.json'))),{accepted:['preserved'],allowance:11});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'agents/agi-reviewer/agent/auth-profiles.json'))),{private:'retained-OAuth-fixture'});}
 }finally{if(broker)await broker.close();if(runtimeBroker)await runtimeBroker.close();}
});
