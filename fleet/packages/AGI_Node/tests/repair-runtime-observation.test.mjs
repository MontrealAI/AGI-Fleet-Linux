import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {boundedCommand,collectRuntimeIdentity,safeSupportReport,inventoryCompute} from '../compute/repair.mjs';
import {captureRuntimeSecurityIdentity} from '../compute/setup-runtime-identity.mjs';

const home='/Users/example',profileDir=home+'/.openclaw-agi-compute',uid=504;
function fixture(overrides={}) {
 const commands=[];let workers=0,probes=0,sockets=0;
 return {commands,get workers(){return workers;},get probes(){return probes;},get sockets(){return sockets;},options:{home,profileDir,uid,role:'agent',platform:'darwin',
 run:async(file,args,options)=>{commands.push({file,args,options});return {status:113,code:'FAILED',stdout:'',stderr:`Bad request.\nCould not find service "${args[1].split('/').at(-1)}" in domain for user gui: 504\n`};},
 probePort:async()=>{probes++;return false;},inspectSocket:()=>{sockets++;return {exists:false};},workerRun:async()=>{workers++;return {status:1,code:'FAILED',stdout:'PRIVATE'};},...overrides}};
}
test('report-only absence gate accepts physical status113 then reaches fixed worker without issuing mutations',async()=>{
 const f=fixture();await assert.rejects(collectRuntimeIdentity(f.options),{message:'REPAIR_RUNTIME_WORKER_JSON_INVALID'});
 assert.equal(f.workers,1);assert.equal(f.probes,4);assert.equal(f.sockets,4);assert.equal(f.commands.length,4);assert(f.commands.every(c=>c.file==='/bin/launchctl'&&c.args[0]==='print'&&c.options.captureStderr));
});
test('loaded service, wrong UID/label, permission and malformed result block before copy',async()=>{
 const results=[{status:0,code:'OK',stdout:'state = running'},{status:113,code:'FAILED',stderr:'Bad request.\nCould not find service "wrong" in domain for user gui: 504'}, {status:113,code:'FAILED',stderr:'Could not find service "ai.montreal.agi-compute" in domain for user gui: 505'}, {status:1,code:'FAILED',stderr:'Operation not permitted'}, {status:null,code:'TIMEOUT',stdout:''}];
 for(const value of results){const f=fixture({run:async()=>value});await assert.rejects(collectRuntimeIdentity(f.options),{message:'REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED'});assert.equal(f.workers,0);}
});
test('listening port or existing runtime socket blocks without removing or repairing',async()=>{
 for(const change of [{probePort:async()=>true},{inspectSocket:()=>({exists:true})}]){const f=fixture(change);await assert.rejects(collectRuntimeIdentity(f.options),{message:'REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED'});assert.equal(f.workers,0);assert(f.commands.every(c=>c.args[0]==='print'));}
});
test('service relaunch after worker invalidates observation and is not stopped by collection',async()=>{
 const f=fixture();const original=f.options.run;let n=0;f.options.run=async(...args)=>++n>2?{status:0,code:'OK',stdout:'state = running'}:original(...args);
 const error=await rejection(collectRuntimeIdentity(f.options));assert.equal(error.message,'REPAIR_RUNTIME_WORKER_JSON_INVALID');assert.equal(error.runtimeIdentityCollection.afterFailure.code,'REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED');assert.equal(error.runtimeIdentityQuiescence.after.launchctlPrint.compute.classification,'loaded');assert.equal(f.workers,1);
});
test('worker is bounded and uses sanitized environment; malformed responses never leak contents',async()=>{
 let call;const f=fixture({workerRun:async(file,args,options)=>{call={file,args,options};return {status:0,code:'OK',stdout:'PRIVATE INVALID JSON'};}});
 await assert.rejects(collectRuntimeIdentity(f.options),{message:'REPAIR_RUNTIME_WORKER_JSON_INVALID'});
 assert.equal(call.options.timeoutMs,30000);assert.equal(call.options.maxBytes,2097152);
 const input=JSON.parse(call.options.input),{temporaryRoot,...identity}=input;
 assert.deepEqual(identity,{home,role:'agent',profileDir});assert.match(path.basename(temporaryRoot),/^agi-runtime-observation-/);assert.equal(fs.existsSync(temporaryRoot),false);
 assert.equal(call.options.env.NODE_OPTIONS,undefined);assert.equal(call.options.env.TMPDIR,fs.realpathSync(os.tmpdir()));assert.match(call.args.at(-1),/observeTransactionRuntimeIdentity/);
});
test('wrong profile, root account and nonmacOS cannot start collector',async()=>{
 for(const change of [{profileDir:home+'/.openclaw-other'},{uid:0},{platform:'linux'},{role:'other'}]){const f=fixture(change);await assert.rejects(collectRuntimeIdentity(f.options));assert.equal(f.workers,0);assert.equal(f.commands.length,0);}
});
test('parent removes private copied material after worker timeout',async()=>{
 let temporaryRoot;
 const f=fixture({workerRun:async(file,args,options)=>{
  temporaryRoot=JSON.parse(options.input).temporaryRoot;
  assert.equal(fs.lstatSync(temporaryRoot).mode&0o777,0o700);
  fs.writeFileSync(path.join(temporaryRoot,'private-copy'), 'PRIVATE fixture material',{mode:0o600});
  return {status:null,code:'TIMEOUT',stdout:''};
 }});
 const error=await rejection(collectRuntimeIdentity(f.options));assert.equal(error.message,'REPAIR_RUNTIME_WORKER_TIMEOUT');assert.equal(error.runtimeIdentityCollection.worker.code,'TIMEOUT');assert.equal(error.runtimeIdentityCollection.temporary.removed,true);
 assert.equal(fs.existsSync(temporaryRoot),false);assert.equal(f.commands.length,4);
});

function sourceSnapshot(root){
 const result=[];
 const walk=directory=>{for(const name of fs.readdirSync(directory).sort()){
  const file=path.join(directory,name),stat=fs.lstatSync(file,{bigint:true});
  result.push({path:path.relative(root,file),metadata:['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs','nlink'].map(key=>String(stat[key])),sha256:stat.isFile()?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null});
  if(stat.isDirectory())walk(file);
 }};walk(root);return result;
}
function realFixture(role){
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-repair-observation-test-'))),suffix=role==='agent'?'agi-compute':'agi-node-compute';
 fs.chmodSync(home,0o700);
 const profileDir=path.join(home,'.openclaw-'+suffix),support=path.join(home,'.agi-genesis-setup-'+role),directory=path.join(support,'transaction');
 for(const dir of [profileDir,support,directory])fs.mkdirSync(dir,{mode:0o700});
 fs.writeFileSync(path.join(profileDir,'openclaw.json'),JSON.stringify({gateway:{mode:'local'},fixture:'PRIVATE fixture token must not be exported'}),{mode:0o600});
 const runtimeSecurityRecord=captureRuntimeSecurityIdentity(profileDir,{registryAliases:[path.join(directory,'candidate')]});
 const record={schema:1,id:crypto.randomUUID(),profileDir,state:'safe-stop-required',treeIdentityVersion:3,stagingProtocolVersion:2,runtimeSecurityVersion:1,runtimeSecurityRecord,sealedSecurityIdentity:runtimeSecurityRecord.digest,primaryFailureCode:'SETUP_PROFILE_CHANGED',rollbackFailureCode:'SETUP_ROLLBACK_RUNTIME_CHANGED'};
 fs.writeFileSync(path.join(directory,'transaction.json'),JSON.stringify(record),{mode:0o600});
 return {home,profileDir,record,cleanup:()=>fs.rmSync(home,{recursive:true,force:true})};
}
test('real bounded worker reports a stable stopped profile without changing its bytes or metadata for Agent and Node',async()=>{
 for(const role of ['agent','node']){
  const real=realFixture(role);
  try{
   const before=sourceSnapshot(real.home),ports=[],socketPaths=[];
   const f=fixture({...real,role,workerRun:boundedCommand,probePort:async port=>{ports.push(port);return false;},inspectSocket:socket=>{socketPaths.push(socket);return {exists:false};}});
   const result=await collectRuntimeIdentity(f.options);
   assert.equal(result.observation.transaction.id,real.record.id);
   assert.equal(result.observation.source.sourceSQLiteOpened,false);assert.equal(result.observation.source.sourceWritten,false);
   assert.equal(result.observation.historicalCauseEstablished,false);assert.equal(result.observation.rollbackAuthorized,false);
   assert.equal(result.observation.diagnostic.captureComplete,true);assert.deepEqual(result.observation.diagnostic.deltas,[]);
   assert.equal(result.observation.diagnostic.expected.digest,result.observation.diagnostic.actual.digest);
   assert.deepEqual(sourceSnapshot(real.home),before);
   assert.deepEqual(ports,role==='agent'?[18894,18896,18894,18896]:[18898,18900,18898,18900]);
   const suffix=role==='agent'?'agi-compute':'agi-node-compute';
   assert.deepEqual(f.commands.map(call=>call.args),[...Array(2)].flatMap(()=>[['print',`gui/504/ai.montreal.${suffix}`],['print',`gui/504/ai.openclaw.${suffix}`]]));
   assert.equal(socketPaths.filter(socket=>socket===path.join(real.profileDir,'web.sock')).length,2);
   assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }finally{real.cleanup();}
 }
});
test('real worker identifies protected config divergence after failure without authorizing rollback or exposing contents',async()=>{
 const real=realFixture('agent');
 try{
  fs.writeFileSync(path.join(real.profileDir,'openclaw.json'),JSON.stringify({gateway:{mode:'remote'},fixture:'DIFFERENT PRIVATE secret'}));
  const before=sourceSnapshot(real.home),f=fixture({...real,role:'agent',workerRun:boundedCommand});
  const result=await collectRuntimeIdentity(f.options),observed=result.observation;
  assert.equal(observed.rollbackAuthorized,false);assert.equal(observed.historicalCauseEstablished,false);
  assert.notEqual(observed.diagnostic.expected.immutableDigest,observed.diagnostic.actual.immutableDigest);
  assert(observed.diagnostic.deltas.some(delta=>delta.path==='openclaw.json'));
  assert.equal(JSON.stringify(observed).includes('PRIVATE'),false);assert.equal(JSON.stringify(observed).includes('remote'),false);
  assert.deepEqual(sourceSnapshot(real.home),before);
 }finally{real.cleanup();}
});
test('valid outer worker envelope rejects extra observation fields and raw diagnostic payloads',async()=>{
 const real=realFixture('agent');
 try{
  const good=await collectRuntimeIdentity(fixture({...real,role:'agent',workerRun:boundedCommand}).options);
  for(const bad of [{...good.observation,secret:'PRIVATE'},{...good.observation,transaction:{...good.observation.transaction,raw:'PRIVATE'}},{...good.observation,source:{...good.observation.source,raw:'PRIVATE'}},{...good.observation,diagnostic:{schema:'WRONG',raw:'PRIVATE'}}]){
   const f=fixture({workerRun:async()=>({status:0,code:'OK',stdout:JSON.stringify({ok:true,result:bad})})});
   await assert.rejects(collectRuntimeIdentity(f.options),{message:'REPAIR_RUNTIME_WORKER_EVIDENCE_INVALID'});
  }
  const validWithUnknown={...good.observation,diagnostic:{...good.observation.diagnostic,raw:'PRIVATE'}};
  const result=await collectRuntimeIdentity(fixture({workerRun:async()=>({status:0,code:'OK',stdout:JSON.stringify({ok:true,result:validWithUnknown})})}).options);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  const exported=safeSupportReport({checks:[],runtimeIdentity:validWithUnknown,runtimeIdentityQuiescence:result.quiescence});
  assert.equal(JSON.stringify(exported).includes('PRIVATE'),false);assert.equal(exported.runtimeIdentityQuiescence.before.launchctlPrint.compute.status,113);
 }finally{real.cleanup();}
});

async function rejection(promise){try{await promise;assert.fail('expected rejection');}catch(error){return error;}}
test('nondefault macOS-shaped parent TMPDIR is shared with the real bounded worker for both roles',async()=>{
 const original=process.env.TMPDIR,base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-custom-tmp-base-')));
 const temporaryBase=path.join(base,'var','folders','fixture','T');fs.mkdirSync(temporaryBase,{recursive:true,mode:0o700});
 try{
  process.env.TMPDIR=temporaryBase;
  for(const role of ['agent','node']){
   const real=realFixture(role);
   try{
    const before=sourceSnapshot(real.home);let workerCall;
    const f=fixture({...real,role,workerRun:async(...args)=>{workerCall=args;return boundedCommand(...args);}});
    const result=await collectRuntimeIdentity(f.options);
    assert.equal(result.observation.status,'OBSERVED');assert.equal(result.collection.status,'OBSERVED');
    assert.equal(workerCall[2].env.TMPDIR,fs.realpathSync(temporaryBase));
    assert.equal(path.dirname(JSON.parse(workerCall[2].input).temporaryRoot),workerCall[2].env.TMPDIR);
    assert.deepEqual(Object.keys(workerCall[2].env).sort(),['HOME','LANG','NODE_NO_WARNINGS','PATH','TMPDIR']);
    assert.equal(result.collection.temporary.removed,true);assert.deepEqual(sourceSnapshot(real.home),before);
   }finally{real.cleanup();}
  }
 }finally{if(original===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=original;fs.rmSync(base,{recursive:true,force:true});}
});
test('all worker transport failures retain explicit safe reason and both completed quiescence checks',async()=>{
 for(const [result,code] of [
  [{status:null,code:'TIMEOUT',stdout:'PRIVATE'},'REPAIR_RUNTIME_WORKER_TIMEOUT'],
  [{status:null,code:'OUTPUT_LIMIT',stdout:'PRIVATE'},'REPAIR_RUNTIME_WORKER_OUTPUT_LIMIT'],
  [{status:null,code:'CANCELLED',stdout:'PRIVATE'},'REPAIR_RUNTIME_WORKER_CANCELLED'],
  [{status:null,code:'UNAVAILABLE',stdout:'PRIVATE'},'REPAIR_RUNTIME_WORKER_UNAVAILABLE'],
  [{status:0,code:'OK',stdout:'PRIVATE invalid'},'REPAIR_RUNTIME_WORKER_JSON_INVALID'],
  [{status:1,code:'FAILED',stdout:'{"ok":false}'},'REPAIR_RUNTIME_WORKER_ENVELOPE_INVALID']]){
  const f=fixture({workerRun:async()=>result}),error=await rejection(collectRuntimeIdentity(f.options));
  assert.equal(error.message,code);assert.equal(error.runtimeIdentityCollection.failure.code,code);
  assert.equal(error.runtimeIdentityQuiescence.before.servicesAbsent,true);assert.equal(error.runtimeIdentityQuiescence.after.socketsAbsent,true);
  const exported=safeSupportReport({checks:[],runtimeIdentity:error.runtimeIdentity,runtimeIdentityCollection:error.runtimeIdentityCollection,runtimeIdentityQuiescence:error.runtimeIdentityQuiescence});
  assert.equal(exported.runtimeIdentityCollection.failure.code,code);assert.equal(exported.runtimeIdentityCollection.temporary.removed,true);
  assert.equal(JSON.stringify(exported).includes('PRIVATE'),false);
 }
});
test('read-only quiescence failure preserves the exact completed gates without launching worker',async()=>{
 const f=fixture();let calls=0;const run=f.options.run;
 f.options.run=async(...args)=>++calls===2?{status:1,code:'FAILED',stderr:'PRIVATE permission denied'}:run(...args);
 const error=await rejection(collectRuntimeIdentity(f.options)),evidence=error.runtimeIdentityQuiescence;
 assert.equal(error.message,'REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED');assert.equal(evidence.before.launchctlPrint.compute.classification,'absent');
 assert.equal(evidence.before.launchctlPrint.gateway.classification,'rejected');assert.equal(evidence.before.servicesAbsent,false);
 assert.equal(evidence.before.portsClosed,null);assert.equal(evidence.after,null);assert.equal(f.workers,0);
 assert.equal(error.runtimeIdentityCollection.worker.started,false);assert.equal(JSON.stringify(error.runtimeIdentityCollection).includes('PRIVATE'),false);
});
test('cleanup failure stays explicit and never hides the original worker failure',async()=>{
 let temporaryRoot;const f=fixture({workerRun:async(file,args,options)=>{temporaryRoot=JSON.parse(options.input).temporaryRoot;return {status:null,code:'TIMEOUT',stdout:''};},removeTemporary:()=>{const error=Error('PRIVATE raw path');error.code='EACCES';throw error;}});
 try{
  const error=await rejection(collectRuntimeIdentity(f.options));
  assert.equal(error.message,'REPAIR_RUNTIME_WORKER_TIMEOUT');assert.equal(error.runtimeIdentityCollection.cleanupFailure.code,'REPAIR_RUNTIME_TEMPORARY_CLEANUP_FAILED');
  assert.equal(error.runtimeIdentityCollection.cleanupFailure.errno,'EACCES');assert.equal(error.runtimeIdentityCollection.temporary.removed,false);
  assert.equal(JSON.stringify(error.runtimeIdentityCollection).includes('PRIVATE'),false);
 }finally{if(temporaryRoot)fs.rmSync(temporaryRoot,{recursive:true,force:true});}
});
test('real missing/invalid transaction artifact produces actionable partial evidence in the report',async()=>{
 for(const missing of [true,false]){
  const real=realFixture('agent');
  try{
   const transaction=path.join(real.home,'.agi-genesis-setup-agent','transaction','transaction.json');
   if(missing)fs.rmSync(transaction);else fs.writeFileSync(transaction,'PRIVATE invalid JSON');
   const before=sourceSnapshot(real.home),f=fixture({...real,role:'agent',workerRun:boundedCommand});
   const error=await rejection(collectRuntimeIdentity(f.options));
   assert.equal(error.message,'REPAIR_RUNTIME_WORKER_FAILED');assert.equal(error.runtimeIdentity.status,'BLOCKED');
   assert.equal(error.runtimeIdentityCollection.worker.envelope,'accepted-failure');assert.notEqual(error.runtimeIdentityCollection.workerFailure,null);
   assert.equal(error.runtimeIdentityQuiescence.before.servicesAbsent,true);assert.equal(error.runtimeIdentityQuiescence.after.servicesAbsent,true);
   assert.equal(error.runtimeIdentityCollection.temporary.removed,true);assert.deepEqual(sourceSnapshot(real.home),before);
   const serialized=JSON.stringify(safeSupportReport({checks:[],runtimeIdentity:error.runtimeIdentity,runtimeIdentityCollection:error.runtimeIdentityCollection,runtimeIdentityQuiescence:error.runtimeIdentityQuiescence}));
   assert.equal(serialized.includes('PRIVATE'),false);assert.equal(serialized.includes(real.home),false);
  }finally{real.cleanup();}
 }
});
test('inventory still observes an existing invalid transaction and reports candidate policy provenance',async()=>{
 const real=realFixture('agent');
 try{
  const profile=real.profileDir;
  fs.writeFileSync(path.join(profile,'compute-settings.json'),JSON.stringify({profileDir:profile,home:real.home,gatewayConfig:path.join(profile,'openclaw.json'),workspace:path.join(profile,'workspace'),role:'agent',port:18894,gatewayPort:18896,policyHash:'a'.repeat(64),policySealVersion:2,signerUID:505,isolationAcknowledged:true}),{mode:0o600});
  fs.writeFileSync(path.join(profile,'agi-compute-profile.json'),JSON.stringify({version:'1.23.11'}),{mode:0o600});
  fs.writeFileSync(path.join(real.home,'.agi-genesis-setup-agent','transaction','transaction.json'),'PRIVATE invalid JSON');
  const f=fixture({...real,role:'agent'}),run=f.options.run;
  const report=await inventoryCompute({home:real.home,uid,role:'agent',platform:'darwin',dependencies:false,policyCheck:()=> 'b'.repeat(64),probePort:async()=>false,run:async(file,args,options)=>file==='/usr/bin/id'?{status:0,code:'OK',stdout:'staff'}:run(file,args,options),schemaRun:async()=>({status:0,code:'OK',stdout:JSON.stringify({ok:true,result:{schema:'agi-state-schema-observation/v1',present:false}})}),runtimeIdentityRun:boundedCommand,runtimeIdentitySocketInspect:()=>({exists:false})});
  assert.equal(report.runtimeIdentity.status,'BLOCKED');assert.equal(report.runtimeIdentityCollection.worker.envelope,'accepted-failure');
  const exported=safeSupportReport(report),policy=exported.checks.find(check=>check.id==='policy');
  assert.equal(policy.status,'FAIL');assert.equal(policy.facts.recordedPolicyHash,'a'.repeat(64));assert.equal(policy.facts.observedCandidatePolicyHash,'b'.repeat(64));assert.equal(policy.facts.policyEvaluationScope,'candidate-source');
  assert(exported.checks.filter(check=>check.id.endsWith('-service')).every(check=>!check.remediation.includes('Apply/resume')));
  assert.equal(JSON.stringify(exported).includes('PRIVATE'),false);
 }finally{real.cleanup();}
});

test('temporary-base overlap with profile or transaction tree is refused before any source write',async()=>{
 const original=process.env.TMPDIR;
 for(const target of ['profile','support','transaction']){
  const real=realFixture('agent');
  try{
   process.env.TMPDIR=target==='profile'?real.profileDir:path.join(real.home,'.agi-genesis-setup-agent',...(target==='transaction'?['transaction']:[]));
   const before=sourceSnapshot(real.home),f=fixture({...real,role:'agent',workerRun:boundedCommand});
   const error=await rejection(collectRuntimeIdentity(f.options));
   assert.equal(error.message,'REPAIR_RUNTIME_TEMPORARY_CREATE_FAILED');assert.equal(error.runtimeIdentityCollection.worker.started,false);
   assert.equal(error.runtimeIdentityCollection.temporary.created,false);assert.deepEqual(sourceSnapshot(real.home),before);
  }finally{if(original===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=original;real.cleanup();}
 }
});
test('cleanup failure after valid observation blocks export acceptance but preserves the comparison',async()=>{
 const real=realFixture('agent');let temporaryRoot;
 try{
  const f=fixture({...real,role:'agent',workerRun:async(...args)=>{temporaryRoot=JSON.parse(args[2].input).temporaryRoot;return boundedCommand(...args);},removeTemporary:()=>{const error=Error('PRIVATE');error.code='EPERM';throw error;}});
  const error=await rejection(collectRuntimeIdentity(f.options));
  assert.equal(error.message,'REPAIR_RUNTIME_TEMPORARY_CLEANUP_FAILED');assert.equal(error.runtimeIdentity.status,'OBSERVED');
  assert.equal(error.runtimeIdentityCollection.status,'BLOCKED');assert.equal(error.runtimeIdentityCollection.cleanupFailure.errno,'EPERM');
  assert.equal(error.runtimeIdentityQuiescence.after.servicesAbsent,true);
 }finally{if(temporaryRoot)fs.rmSync(temporaryRoot,{recursive:true,force:true});real.cleanup();}
});
