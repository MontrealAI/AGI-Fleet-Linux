import {sandboxWorkspaceRoot} from '../packages/AGI_Agent/compute/sandbox-scope.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ComputeWorker as AgentComputeWorker,createComputeServer} from '../packages/AGI_Agent/shared/runtime/compute/server.mjs';
import {ComputeWorker as NodeComputeWorker} from '../packages/AGI_Node/shared/runtime/compute/server.mjs';
import {computeProfile} from '../packages/AGI_Agent/shared/runtime/compute/profile.mjs';
import {beginCleanupEvidence,readCleanupEvidence} from '../packages/AGI_Agent/shared/runtime/compute/cleanup-evidence.mjs';
import {inventoryCompute,safeSupportReport} from '../packages/AGI_Agent/shared/runtime/compute/repair.mjs';
import {validateBundle,computerVerdict} from '../packages/AGI_Agent/src/artifacts.mjs';
import {normalizeWork} from '../packages/AGI_Agent/src/work.mjs';
import {DECLARATION} from '../packages/AGI_Agent/src/review.mjs';

const specification=JSON.parse(fs.readFileSync(new URL('../packages/AGI_Agent/examples/computer-smoke.json',import.meta.url)));
const delivery=fs.readFileSync(new URL('../packages/AGI_Agent/examples/computer-smoke.bundle.json',import.meta.url),'utf8');
const expectedFiles=validateBundle(specification,Buffer.from(delivery)).files;
const containerIDs={base:'1'.repeat(64),browser:'2'.repeat(64)};
const secrets=['PRIVATE_PROVIDER_RESPONSE_7391','OAUTH_VALUE_8391','PRIVATE_USER_CONTENT_9391'];
const success={ok:true,exitStatus:0,signal:null,elapsedMs:1,timeoutMs:30000,timedOut:false,started:true,processTerminationConfirmed:true};
const verdict=()=>({safeToReview:true,checks:specification.criteria.map(item=>({id:item.id,status:'pass',method:'Synthetic regression fixture read the actual immutable Office bytes',observed:'Exact expected public fixture bytes',files:specification.outputs.map(file=>file.name)}))});
function commandError(code='COMPUTE_DOCKER_TIMEOUT'){
 return Object.assign(Error(secrets.join(' ')+' Bearer '+secrets[1]),{code,failureCode:code,exitStatus:124,signal:null,elapsedMs:23,timeoutMs:30000,timedOut:code==='COMPUTE_DOCKER_TIMEOUT',started:true,processTerminationConfirmed:true,stderr:secrets.join(' '),stdout:secrets[2],token:secrets[1]});
}
function fixture(t,{role='agent',failTarget=null,failOnce=false,failBeforeModel=false,unconfirmedTermination=false,malformedCommandSuccess=false,inventoryUnavailable=false,retainTarget=null,observerFailure=false,observerPersistenceFailure=false,observerTerminationUnconfirmed=false,removeFailure=false}={}){
 const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'agi-cleanup-workflow-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const profileDir=path.join(home,role==='node'?'.openclaw-agi-node-compute':'.openclaw-agi-compute');
 const c={role,home,profileDir,workstation:true,workspace:path.join(profileDir,'workspace'),jobRoot:path.join(profileDir,'jobs'),inputRoot:path.join(profileDir,'input'),gatewayConfig:path.join(profileDir,'openclaw.json'),port:role==='node'?18898:18894,gatewayPort:role==='node'?18900:18896,token:'a'.repeat(64),gatewayToken:'b'.repeat(64),policyHash:'c'.repeat(64),imageID:'sha256:'+'d'.repeat(64),browserImageID:'sha256:'+'e'.repeat(64),maxRuns24h:48,maxImages24h:8,signerUID:501,isolationAcknowledged:true};
 for(const dir of [profileDir,c.jobRoot,c.inputRoot,c.workspace])fs.mkdirSync(dir,{recursive:true,mode:0o700});
 fs.writeFileSync(c.gatewayConfig,JSON.stringify(computeProfile({token:c.gatewayToken,port:c.gatewayPort,model:'openai/gpt-6-astra',workspace:c.workspace,imageID:c.imageID,browserImageID:c.browserImageID,jobRoot:c.jobRoot,inputRoot:c.inputRoot,workstation:true,role})),{mode:0o600});
 fs.writeFileSync(path.join(profileDir,'compute-settings.json'),JSON.stringify(c),{mode:0o600});
 fs.writeFileSync(path.join(profileDir,'agi-compute-profile.json'),JSON.stringify({role,version:role==='node'?'2.25.1':'1.25.1'}),{mode:0o600});
 fs.writeFileSync(path.join(profileDir,'service-error.log'),'Old failure '+secrets.join(' ')+'\n',{mode:0o600});
 fs.writeFileSync(path.join(profileDir,'service.log'),'Historical fixture run\n',{mode:0o600});
 const state={modelCalls:0,failed:0,finishCalls:0,root:null,trace:[],active:{base:[],browser:[]},capturedFiles:new Map()};
 const inventory=async(config,key,target)=>{
  assert.equal(config,c);assert.match(key,/^agent:agi-(creator|reviewer):agi-work-[a-f0-9-]{36}:workspace:[a-f0-9]{32}$/);
  assert.ok(['base','browser'].includes(target));state.trace.push('inventory:'+target);
  return inventoryUnavailable?{status:'UNAVAILABLE',containerIDs:[]}:{status:'CAPTURED',containerIDs:[...state.active[target]]};
 };
 const ComputeWorker=role==='node'?NodeComputeWorker:AgentComputeWorker;
 const worker=new ComputeWorker(c,{verifyPolicy:false,cleanupInventory:inventory,cli:async(config,args)=>{
  assert.equal(config,c);
  if(args[1]==='recreate'){
   const target=args.includes('--browser')?'browser':'base';state.trace.push('recreate:'+target);
   assert.equal(args[0],'sandbox');assert.ok(args.includes('--force'));
   if((state.modelCalls||failBeforeModel)&&target===failTarget&&(!failOnce||state.failed===0)){
    state.failed++;const error=commandError();
    if(unconfirmedTermination){error.processTerminationConfirmed=false;state.unconfirmedTraceLength=state.trace.length;}
    throw error;
   }
   if(!(state.modelCalls&&target===retainTarget))state.active[target]=[];
   return malformedCommandSuccess?{ok:true}:{...success};
  }
  assert.deepEqual(args.slice(0,2),['sandbox','explain']);
  const agent=args[args.indexOf('--agent')+1],key=args[args.indexOf('--session')+1];
  state.root=sandboxWorkspaceRoot(c,key);
  return {agentId:agent,sandbox:{scope:'session',workspaceAccess:'none',sessionIsSandboxed:true,backend:'docker',effectiveHostWorkspaceRoot:state.root}};
 }});
 worker.executionObserverFactory=async(config,scope)=>{
  assert.equal(config,c);state.trace.push('observer:start');state.observerScope=scope;
  return {capture:async(session,outputs)=>{
   assert.equal(session.root,state.root);state.trace.push('observer:capture');
   for(const file of outputs)state.capturedFiles.set(file.name,fs.readFileSync(path.join(session.root,'deliverables',file.name)));
  },finish:async(files)=>{
   state.finishCalls++;state.trace.push('observer:finish');
   if(files)for(const [name,bytes]of files)assert.deepEqual(bytes,state.capturedFiles.get(name));
   if(observerFailure)throw commandError('COMPUTE_CLI_UNAVAILABLE');
   if(removeFailure){
    const outside=path.join(home,'retained-external-evidence');fs.mkdirSync(outside,{mode:0o700});
    fs.writeFileSync(path.join(outside,'sentinel'),'preserve this file',{mode:0o600});
    fs.renameSync(c.inputRoot,c.inputRoot+'-retained');fs.symlinkSync(outside,c.inputRoot);
   }
   return observerPersistenceFailure?{status:'BLOCKED',persistence:'FAIL'}:{status:'CAPTURED',persistence:'PASS',processTerminationConfirmed:!observerTerminationUnconfirmed};
  }};
 };
 worker.chat=async(agent,prompt,data,signal,image,key)=>{
  state.modelCalls++;state.trace.push('model');assert.equal(key,state.observerScope.sessionKey);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(c.inputRoot,'job.json'))),specification);
  state.active.base=[containerIDs.base];state.active.browser=[containerIDs.browser];
  if(role==='agent'){
   assert.equal(agent,'agi-creator');
   for(const [name,bytes]of expectedFiles)fs.writeFileSync(path.join(state.root,'deliverables',name),bytes,{mode:0o600});
   return JSON.stringify({status:'complete',content:'files-ready'});
  }
  assert.equal(agent,'agi-reviewer');
  for(const [name,bytes]of expectedFiles){const file=path.join(c.inputRoot,'delivery',name);assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.statSync(file).mode&0o222,0);}
  return JSON.stringify(verdict());
 };
 const requestId=crypto.randomUUID(),run=()=>role==='agent'?worker.execute('generate',{specification:normalizeWork(specification,DECLARATION),attempt:1},{id:requestId}):worker.execute('computer-review',{specification,delivery},{id:requestId});
 return {home,c,worker,state,requestId,run,evidence:()=>readCleanupEvidence(c.profileDir)};
}
function assertNoSecrets(value){for(const secret of secrets)assert.ok(!JSON.stringify(value).includes(secret),secret);}
async function assertContained(h){
 assert.ok(fs.existsSync(path.join(h.c.profileDir,'COMPUTE_STOP')));
 assert.equal(h.worker.busy,false);assert.equal(h.worker.state.calls.length,1);
 assert.notEqual(h.worker.state.requests.at(-1).status,'complete');
 const calls=h.state.modelCalls,mutations=h.state.trace.filter(item=>item.startsWith('recreate:')).length;
 await assert.rejects(h.worker.execute('test',{}, {id:crypto.randomUUID()}),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);
 assert.equal(h.state.modelCalls,calls);assert.equal(h.state.trace.filter(item=>item.startsWith('recreate:')).length,mutations);assert.equal(h.worker.state.calls.length,1);
 assertNoSecrets(h.evidence());assertNoSecrets(fs.readFileSync(path.join(h.c.profileDir,'COMPUTE_STOP'),'utf8'));
 const evidenceDirectory=path.join(h.c.profileDir,'cleanup-evidence');
 for(const name of fs.readdirSync(evidenceDirectory))assertNoSecrets(fs.readFileSync(path.join(evidenceDirectory,name),'utf8'));
}

for(const role of ['agent','node'])test(`${role} actual Office workflow confirms both cleanup targets and removes workspaces`,async t=>{
 const h=fixture(t,{role}),result=await h.run();
 if(role==='agent'){
  const actual=validateBundle(specification,Buffer.from(result.content)).files;
  for(const [name,bytes]of expectedFiles)assert.deepEqual(actual.get(name),bytes);
 }else assert.equal(computerVerdict(specification,result).verdict,'consistent');
 assert.equal(h.state.modelCalls,1);assert.equal(h.state.finishCalls,1);assert.equal(h.worker.state.requests.at(-1).status,'complete');
 assert.equal(fs.existsSync(path.join(h.c.profileDir,'COMPUTE_STOP')),false);assert.equal(fs.existsSync(h.state.root),false);assert.equal(fs.existsSync(h.c.inputRoot),false);
 const evidence=h.evidence();assert.equal(evidence.status,'PASS');assert.equal(evidence.pending.length,0);
 for(const target of ['base','browser']){
  const records=evidence.records.filter(item=>item.stage==='sandbox-recreate'&&item.target===target);
  assert.ok(records.some(item=>item.phase==='pre-run'&&item.trigger==='preflight'));
  assert.ok(records.some(item=>item.phase==='post-run'&&item.result==='PASS'&&item.dockerBefore.containerIDs.includes(containerIDs[target])&&item.dockerAfter.containerIDs.length===0));
  assert.ok(records.every(item=>item.result==='PASS'&&item.requestId===h.requestId&&item.commandClassification===`openclaw-sandbox-recreate-${target}`));
 }
 assertNoSecrets(evidence);
});

for(const role of ['agent','node'])test(`${role} nonworkstation cleanup confirms only the base session sandbox`,async t=>{
 const h=fixture(t,{role});h.c.workstation=false;
 const agent=role==='node'?'agi-reviewer':'agi-creator',key=`agent:${agent}:agi-work-${h.requestId}`;
 await h.worker.cleanupAgent(agent,key,{phase:'pre-run',trigger:'preflight'});
 assert.deepEqual(h.state.trace.filter(item=>item.startsWith('recreate:')),['recreate:base']);
 const evidence=h.evidence();assert.equal(evidence.status,'PASS');assert.equal(evidence.records.length,1);assert.equal(evidence.records[0].target,'base');assert.equal(evidence.records[0].agent,agent);
 assert.equal(h.state.modelCalls,0);assert.equal(fs.existsSync(path.join(h.c.profileDir,'COMPUTE_STOP')),false);
});

test('a bare CLI success object without observed process completion cannot authorize inference',async t=>{
 const h=fixture(t,{malformedCommandSuccess:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 assert.equal(h.state.modelCalls,0);assert.ok(h.evidence().records.some(item=>item.target==='base'&&item.result==='FAIL'));
});

for(const role of ['agent','node'])for(const target of ['base','browser'])test(`${role} ${target} post-work recreate failure is durable, quarantines files and blocks the next admission`,async t=>{
 const h=fixture(t,{role,failTarget:target});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 assert.equal(h.state.modelCalls,1);assert.equal(h.state.finishCalls,1);assert.ok(fs.existsSync(h.state.root));assert.ok(fs.existsSync(h.c.inputRoot));
 const failure=h.evidence().records.find(item=>item.target===target&&item.result==='FAIL');assert.ok(failure);
 assert.equal(failure.phase,'post-run');assert.equal(failure.stage,'sandbox-recreate');assert.equal(failure.requestId,h.requestId);
 assert.equal(failure.failureCode,'COMPUTE_DOCKER_TIMEOUT');assert.equal(failure.exitStatus,124);assert.equal(failure.processTerminationConfirmed,true);
 assert.ok(Number.isSafeInteger(failure.elapsedMs)&&failure.elapsedMs>=0);assert.equal(failure.stopMarker,'PRESENT');
 assert.deepEqual(failure.dockerBefore.containerIDs,[containerIDs[target]]);assert.deepEqual(failure.dockerAfter.containerIDs,[containerIDs[target]]);
});

for(const target of ['base','browser'])test(`Agent failed ${target} cleanup stays stopped when the final retry succeeds`,async t=>{
 const h=fixture(t,{failTarget:target,failOnce:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 const records=h.evidence().records.filter(item=>item.stage==='sandbox-recreate'&&item.target===target&&item.phase==='post-run');
 assert.ok(records.some(item=>item.result==='FAIL'&&item.trigger==='before-collect'));
 assert.ok(records.some(item=>item.result==='PASS'&&item.trigger==='finalize'));
 assert.deepEqual(h.state.active[target],[]);assert.equal(h.evidence().status,'BLOCKED');assert.ok(fs.existsSync(h.state.root));assert.ok(fs.existsSync(h.c.inputRoot));
});

for(const role of ['agent','node'])for(const target of ['base','browser'])test(`${role} failed ${target} preflight cannot be cleared by a successful final cleanup`,async t=>{
 const h=fixture(t,{role,failTarget:target,failOnce:true,failBeforeModel:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 assert.equal(h.state.modelCalls,0);
 const records=h.evidence().records.filter(item=>item.stage==='sandbox-recreate'&&item.target===target);
 assert.ok(records.some(item=>item.result==='FAIL'&&item.phase==='pre-run'&&item.trigger==='preflight'));
 assert.ok(records.some(item=>item.result==='PASS'&&item.phase==='post-run'&&item.trigger==='finalize'));
 assert.equal(h.evidence().status,'BLOCKED');
});

test('unconfirmed cleanup process termination prevents overlapping final cleanup or Docker inventory',async t=>{
 const h=fixture(t,{failTarget:'base',failOnce:true,unconfirmedTermination:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 assert.equal(h.state.failed,1);assert.equal(h.state.finishCalls,1);
 assert.ok(!h.state.trace.slice(h.state.unconfirmedTraceLength).some(item=>item.startsWith('recreate:')||item.startsWith('inventory:')));
 assert.ok(h.evidence().records.some(item=>item.target==='base'&&item.result==='FAIL'&&item.processTerminationConfirmed===false&&item.postcondition==='UNKNOWN'));
 assert.ok(fs.existsSync(h.state.root));assert.ok(fs.existsSync(h.c.inputRoot));
});

for(const role of ['agent','node'])test(`${role} observer finalization failure has its own classification and preserves workspace evidence`,async t=>{
 const h=fixture(t,{role,observerFailure:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 const records=h.evidence().records;assert.ok(records.filter(item=>item.stage==='sandbox-recreate').every(item=>item.result==='PASS'));
 const failure=records.find(item=>item.stage==='observer-finalize'&&item.result==='FAIL');assert.ok(failure);assert.equal(failure.target,'observer');assert.equal(failure.failureCode,'COMPUTE_OBSERVER_FINALIZE_FAILED');
 assert.ok(fs.existsSync(h.state.root));assert.ok(fs.existsSync(h.c.inputRoot));assert.equal(h.state.finishCalls,1);
});

test('observer evidence persistence failure blocks completion even when finish resolves',async t=>{
 const h=fixture(t,{observerPersistenceFailure:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 assert.ok(h.evidence().records.some(item=>item.stage==='observer-finalize'&&item.failureCode==='COMPUTE_OBSERVER_FINALIZE_FAILED'));
 assert.ok(fs.existsSync(h.state.root));assert.ok(fs.existsSync(h.c.inputRoot));
});

for(const role of ['agent','node'])test(`${role} linked input directory prevents deletion, records workspace failure and preserves unrelated files`,async t=>{
 const h=fixture(t,{role,removeFailure:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 const records=h.evidence().records;assert.ok(records.filter(item=>item.stage==='sandbox-recreate').every(item=>item.result==='PASS'));
 const failure=records.find(item=>item.stage==='workspace-remove'&&item.result==='FAIL');assert.ok(failure);assert.equal(failure.target,'workspace');assert.equal(failure.failureCode,'COMPUTE_WORKSPACE_REMOVE_FAILED');
 assert.equal(fs.readFileSync(path.join(h.home,'retained-external-evidence','sentinel'),'utf8'),'preserve this file');assert.ok(fs.existsSync(h.c.inputRoot+'-retained'));assert.ok(fs.lstatSync(h.c.inputRoot).isSymbolicLink());
});

test('unavailable pre-cleanup Docker inventory blocks CLI mutation and model execution',async t=>{
 const h=fixture(t,{inventoryUnavailable:true});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 assert.equal(h.state.modelCalls,0);assert.equal(h.state.trace.filter(item=>item.startsWith('recreate:')).length,0);
 const failure=h.evidence().records.find(item=>item.stage==='sandbox-recreate'&&item.result==='FAIL');assert.ok(failure);assert.equal(failure.failureCode,'COMPUTE_CLEANUP_INVENTORY_FAILED');assert.equal(failure.commandResult,'NOT_RUN');
});

for(const target of ['base','browser'])test(`successful ${target} recreate exit cannot authorize work while its Docker object remains`,async t=>{
 const h=fixture(t,{retainTarget:target});await assert.rejects(h.run(),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);await assertContained(h);
 const failure=h.evidence().records.find(item=>item.target===target&&item.failureCode==='COMPUTE_CLEANUP_POSTCONDITION_FAILED');assert.ok(failure);
 assert.equal(failure.commandResult,'PASS');assert.equal(failure.postcondition,'FAIL');assert.deepEqual(failure.dockerAfter.containerIDs,[containerIDs[target]]);
});

for(const role of ['agent','node'])test(`${role} restarted worker cannot lose durable cleanup containment if the STOP file disappears`,async t=>{
 const h=fixture(t,{role,failTarget:'browser'});await assert.rejects(h.run(),/COMPUTE_SANDBOX_CLEANUP_FAILED/);
 fs.unlinkSync(path.join(h.c.profileDir,'COMPUTE_STOP'));
 const Worker=role==='node'?NodeComputeWorker:AgentComputeWorker;
 const restarted=new Worker(h.c,{verifyPolicy:false,cleanupInventory:h.worker.cleanupInventory,cli:h.worker.cli});
 let calls=0;restarted.chat=async()=>{calls++;return '{"status":"ready"}';};
 await assert.rejects(restarted.execute('test',{}, {id:crypto.randomUUID()}),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);
 assert.equal(calls,0);assert.equal(restarted.state.calls.length,1);assert.equal(h.evidence().status,'BLOCKED');
});

test('unfinished durable cleanup intent blocks admission after a process interruption',async t=>{
 const h=fixture(t),scope={requestId:h.requestId,sessionId:`agent:agi-creator:agi-work-${h.requestId}`,agent:'agi-creator',phase:'pre-run',stage:'sandbox-recreate',target:'base',trigger:'preflight'};
 beginCleanupEvidence(h.c,scope);
 const restarted=new AgentComputeWorker(h.c,{verifyPolicy:false,cleanupInventory:h.worker.cleanupInventory,cli:h.worker.cli});
 let calls=0;restarted.chat=async()=>{calls++;return '{"status":"ready"}';};
 await assert.rejects(restarted.execute('test',{}, {id:crypto.randomUUID()}),/^Error: COMPUTE_SANDBOX_CLEANUP_FAILED$/);
 assert.equal(calls,0);assert.equal(restarted.state.calls.length,0);assert.equal(h.evidence().pending.length,1);assert.equal(h.evidence().status,'BLOCKED');
});

test('later read-only repair exports the historical cleanup failure even with an empty current log window',async t=>{
 const h=fixture(t,{failTarget:'browser',failOnce:true});await assert.rejects(h.run(),/COMPUTE_SANDBOX_CLEANUP_FAILED/);
 const before=h.evidence(),journal=fs.readFileSync(h.worker.stateFile),settings=fs.readFileSync(path.join(h.c.profileDir,'compute-settings.json'));
 const report=await inventoryCompute({home:h.home,role:'agent',platform:'linux',dependencies:false,probePort:async()=>true,policyCheck:()=>h.c.policyHash});
 const support=safeSupportReport(report);
 assert.equal(support.currentLogs.files.length,2);assert.ok(support.currentLogs.files.every(item=>item.status==='PASS'&&item.bytesObserved===0));
 assert.deepEqual({...support.cleanupEvidence,capacity:null},{...before,capacity:null});assert.equal(support.cleanupEvidence.capacity.activeAttempts,before.attemptCount);assert.equal(support.cleanupEvidence.status,'BLOCKED');assert.ok(support.cleanupEvidence.records.some(item=>item.target==='browser'&&item.result==='FAIL'));
 assert.equal(support.checks.find(item=>item.id==='stop-marker').code,'COMPUTE_STOP_REQUIRES_RECONCILIATION');
 assert.equal(support.walletAccessed,false);assert.equal(support.settingsChanged,false);assert.equal(support.budgetsChanged,false);assert.equal(support.paidProviderCall,false);
 assert.deepEqual(fs.readFileSync(h.worker.stateFile),journal);assert.deepEqual(fs.readFileSync(path.join(h.c.profileDir,'compute-settings.json')),settings);assert.deepEqual({...h.evidence(),capacity:null},{...before,capacity:null});assertNoSecrets(support);
});

test('the locally listening service reports stopped with tool qualification still NOT_TESTED after cleanup failure',async t=>{
 const h=fixture(t,{failTarget:'base'});await assert.rejects(h.run(),/COMPUTE_SANDBOX_CLEANUP_FAILED/);
 h.worker.fetch=async()=>Response.json({data:[{id:'openclaw/agi-creator'},{id:'openclaw/agi-checker'},{id:'openclaw/agi-reviewer'}]});
 const server=createComputeServer(h.worker);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));h.c.port=server.address().port;
 const response=await fetch(`http://127.0.0.1:${h.c.port}/health`,{headers:{Authorization:'Bearer '+h.c.token}}),health=await response.json();
 assert.equal(response.status,200);assert.equal(health.maxRuns24h,48);assert.equal(health.maxImages24h,8);assert.equal(health.cleanupCapacity.activeAttempts,h.evidence().attemptCount);assert.equal(health.stopped,true);assert.equal(health.qualification.tools.status,'NOT_TESTED');assert.equal(h.state.modelCalls,1);
});

test('unconfirmed observer shutdown stops work even when its evidence was persisted',async t=>{const h=fixture(t,{observerTerminationUnconfirmed:true});await assert.rejects(h.run(),/COMPUTE_SANDBOX_CLEANUP_FAILED/);assert.equal(fs.existsSync(path.join(h.c.profileDir,'COMPUTE_STOP')),true);assert.ok(h.evidence().records.some(r=>r.stage==='observer-finalize'&&r.result==='FAIL'));assert.equal(fs.existsSync(h.state.root),true);});
