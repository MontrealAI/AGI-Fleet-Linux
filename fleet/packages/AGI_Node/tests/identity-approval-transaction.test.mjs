import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Companion,COMPANION_DEFAULT} from '../src/control/companion.mjs';
import {Controller} from '../src/control/controller.mjs';
const role='node';
const oldPolicy='0cab1f69064a1bc37e429fa0206ad245a0ef175f0786ce8112dc52bd91165ac8';
const proposedPolicy='fff3d1c45e3545d38969684511b6c47b88b039e53abbc74498673f27ce8016be';
const answer=()=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"status":"ready"}'}}]});
async function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-approval-transaction-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 let now=1800000000000,calls=0,healthReads=0,afterDispatch=null,gate=null;
 const health={policyCurrent:true,protocol:'agi-compute/v2',role,uid:(process.getuid?.()??0)+1001,auth:'chatgpt-oauth',policyHash:proposedPolicy,gatewayReady:true,configuredCapabilities:['desktop','files','computer-review'],capabilities:['desktop','files'],runs24h:0,images24h:0};
 const c=new Companion(home,()=> 'c'.repeat(64),{now:()=>now,fetchImpl:async(url,options)=>{if(url.endsWith('/health')){healthReads++;return Response.json(health);}calls++;afterDispatch?.();if(gate)await gate;return answer();}});
 await c.configure({...COMPANION_DEFAULT,enabled:true,acknowledged:true,mode:'workstation',autoBrief:true,maxCalls24h:128});
 c.state.computePolicy=oldPolicy;c.state.lastError='COMPANION_COMPUTE_POLICY_CHANGED';c.state.nextAt=now+3600000;c.persist();
 t.after(()=>c.close());
 return {c,home,health,now:()=>now,calls:()=>calls,reads:()=>healthReads,advance:ms=>{now+=ms;},afterDispatch:fn=>{afterDispatch=fn;},gate:promise=>{gate=promise;},async proposal(){const h=await c.inspectComputeIdentity();return {policyHash:h.policyHash,proposalID:h.proposal.id,revision:h.proposal.revision,acknowledge:true};}};
}
test('reported old/v3 policy pair commits reviewed candidate once, preserves allowance and survives relaunch',async t=>{
 const f=await fixture(t),input=await f.proposal(),before=f.c.state.calls.length;
 const result=await f.c.approveComputeIdentity(input);
 assert.equal(result.approvalStatus,'committed');assert.equal(result.persisted,true);assert.equal(result.policyHash,proposedPolicy);
 assert.equal(f.c.state.calls.length,before+1);assert.equal(f.calls(),1);assert.equal(f.reads(),3);
 const disk=JSON.parse(fs.readFileSync(f.c.stateFile));assert.equal(disk.computePolicy,proposedPolicy);assert.equal(disk.approvalHistory[0].status,'committed');assert.equal(disk.approvalHistory[0].previousPolicyHash,oldPolicy);assert.equal(disk.approvalHistory[0].previousFailureCode,'COMPANION_COMPUTE_POLICY_CHANGED');
 const restarted=new Companion(f.home,()=> 'c'.repeat(64),{now:f.now});assert.equal(restarted.stateError,undefined);assert.equal(restarted.state.computePolicy,proposedPolicy);assert.equal(restarted.state.approvalHistory[0].operationID,result.operationID);assert.equal(restarted.status().automaticBriefs.suspended,true);await restarted.close();
});
test('read-only review neither reserves a slot nor changes pacing and exposes unknown compute limit honestly',async t=>{
 const f=await fixture(t),before=fs.readFileSync(f.c.stateFile,'utf8');await f.proposal();await f.proposal();f.c.status();
 assert.equal(fs.readFileSync(f.c.stateFile,'utf8'),before);assert.equal(f.c.state.calls.length,0);assert.equal(f.calls(),0);
 assert.deepEqual(f.c.status().limits,{configuredSignerCalls24h:128,computeRuns24h:null,computeImages24h:null,effectiveCalls24h:null});assert.equal(f.c.status().usage.actualProviderCalls,null);assert.equal(f.c.status().usage.billableUsage,null);
});
test('automatic status explanations are suspended in commissioning and cannot consume the approval slot',async t=>{
 const f=await fixture(t);let tick;const interval=globalThis.setInterval;globalThis.setInterval=fn=>{tick=fn;return {unref(){}};};
 try{f.c.startAutomatic(()=>({}),()=>true);}finally{globalThis.setInterval=interval;}
 await tick();assert.equal(f.calls(),0);assert.equal(f.c.state.calls.length,0);assert.equal(f.c.state.failures,0);
 const input=await f.proposal();await f.c.approveComputeIdentity(input);assert.equal(f.calls(),1);
});
test('an enabled background timer health check detects later drift without a reservation or cooldown extension',async t=>{
 const f=await fixture(t);f.c.automaticReady=true;f.c.state.nextAt=0;f.c.state.lastError=null;f.c.persist();let tick;
 const interval=globalThis.setInterval;globalThis.setInterval=fn=>{tick=fn;return {unref(){}};};try{f.c.startAutomatic(()=>({}),()=>true);}finally{globalThis.setInterval=interval;}
 const before=fs.readFileSync(f.c.stateFile,'utf8');await tick();assert.equal(f.calls(),0);assert.equal(f.c.state.calls.length,0);assert.equal(f.c.awaitingIdentityApproval,true);assert.equal(fs.readFileSync(f.c.stateFile,'utf8'),before);
});
test('ordinary connection test still rejects the proposed identity and cannot confer approval',async t=>{
 const f=await fixture(t);f.c.state.nextAt=0;f.c.persist();await assert.rejects(f.c.request('test',{}, {cacheMs:0}),/COMPANION_COMPUTE_POLICY_CHANGED/);assert.equal(f.c.state.computePolicy,oldPolicy);assert.equal(f.calls(),0);
});
for(const phase of ['before','after'])test('exact identity drift '+phase+' probe prevents binding and retains failure audit',async t=>{
 const f=await fixture(t),input=await f.proposal();if(phase==='before')f.health.uid++;else f.afterDispatch(()=>{f.health.uid++;});
 await assert.rejects(f.c.approveComputeIdentity(input),/COMPANION_COMPUTE_APPROVAL_CHANGED/);assert.equal(f.c.state.computePolicy,oldPolicy);assert.equal(f.c.state.approvalHistory.at(-1).status,'failed');assert.equal(f.c.state.approvalHistory.at(-1).failureCode,'COMPANION_COMPUTE_APPROVAL_CHANGED');assert.equal(f.calls(),phase==='before'?0:1);
});
test('stale tab review cannot replace a later successful binding',async t=>{
 const f=await fixture(t),tab1=await f.proposal(),tab2=await f.proposal();await f.c.approveComputeIdentity(tab1);
 await assert.rejects(f.c.approveComputeIdentity(tab2),/COMPANION_COMPUTE_APPROVAL_CHANGED/);assert.equal(f.calls(),1);assert.equal(f.c.state.computePolicy,proposedPolicy);
});
test('expired proposal is rejected before reservation or provider request',async t=>{
 const f=await fixture(t),input=await f.proposal();f.advance(600001);await assert.rejects(f.c.approveComputeIdentity(input),/COMPANION_COMPUTE_APPROVAL_EXPIRED/);assert.equal(f.calls(),0);assert.equal(f.c.state.calls.length,0);
});
test('provider cooldown and local daily allowance remain enforced; failed outcomes survive later success',async t=>{
 const f=await fixture(t),input=await f.proposal();f.c.state.lastError='COMPANION_RATE_LIMITED';f.c.state.nextAt=f.now()+60000;f.c.persist();
 await assert.rejects(f.c.approveComputeIdentity(input),/COMPANION_COOLDOWN/);assert.equal(f.c.state.approvalHistory.at(-1).failureCode,'COMPANION_COOLDOWN');assert.equal(f.c.state.computePolicy,oldPolicy);assert.equal(f.calls(),0);
 f.advance(61000);f.c.state.calls=Array(128).fill(f.now());f.c.persist();await assert.rejects(f.c.approveComputeIdentity(input),/COMPANION_DAILY_LIMIT/);assert.equal(f.calls(),0);
 f.advance(86400001);const retry=await f.proposal();await f.c.approveComputeIdentity(retry);assert.equal(f.c.state.approvalHistory.length,3);assert.deepEqual(f.c.state.approvalHistory.map(x=>x.status),['failed','failed','committed']);
});
test('cancellation rejects late provider success and remains durable',async t=>{
 const f=await fixture(t),input=await f.proposal();let release;f.gate(new Promise(r=>{release=r;}));const promise=f.c.approveComputeIdentity(input);await new Promise(r=>setImmediate(r));assert.equal(f.calls(),1);
 const cancellation=f.c.cancel();release();await assert.rejects(promise,/COMPANION_CANCELLED/);await cancellation;
 assert.equal(f.c.state.computePolicy,oldPolicy);assert.equal(f.c.state.approvalHistory.at(-1).status,'cancelled');assert.equal(JSON.parse(fs.readFileSync(f.c.stateFile)).computePolicy,oldPolicy);
});
test('explicit approval reservation rejects a simultaneous competing request and concurrent approval',async t=>{
 const f=await fixture(t),input=await f.proposal();let release;f.gate(new Promise(r=>{release=r;}));const promise=f.c.approveComputeIdentity(input);await new Promise(r=>setImmediate(r));
 await assert.rejects(f.c.request('brief',{}),/COMPANION_BUSY/);await assert.rejects(f.c.approveComputeIdentity(input),/COMPANION_BUSY/);release();await promise;assert.equal(f.calls(),1);assert.equal(f.c.state.calls.length,1);
});
test('CAS prevents a stale process from restoring old binding or removing audit history',async t=>{
 const f=await fixture(t),stale=new Companion(f.home,()=> 'c'.repeat(64),{now:f.now}),input=await f.proposal();await f.c.approveComputeIdentity(input);const bytes=fs.readFileSync(f.c.stateFile,'utf8');
 assert.throws(()=>stale.persist(),/COMPANION_STATE_CONFLICT/);assert.equal(fs.readFileSync(f.c.stateFile,'utf8'),bytes);assert.equal(stale.stateError,true);await stale.close();
});
test('concurrent persisted state change during probe rejects late commit without overwriting newer evidence',async t=>{
 const f=await fixture(t),input=await f.proposal();let release;f.gate(new Promise(r=>{release=r;}));const pending=f.c.approveComputeIdentity(input);await new Promise(r=>setImmediate(r));
 const newer=new Companion(f.home,()=> 'c'.repeat(64),{now:f.now});const newerBytes=fs.readFileSync(f.c.stateFile,'utf8');release();await assert.rejects(pending,/COMPANION_STATE_CONFLICT/);assert.equal(fs.readFileSync(f.c.stateFile,'utf8'),newerBytes);assert.equal(JSON.parse(newerBytes).computePolicy,oldPolicy);assert.equal(JSON.parse(newerBytes).approvalHistory[0].status,'interrupted');await newer.close();
});
test('commit guard rechecks stopped authorization after provider success',async t=>{
 const f=await fixture(t),input=await f.proposal();let stopped=true;f.afterDispatch(()=>{stopped=false;});
 await assert.rejects(f.c.approveComputeIdentity(input,{validateCommit:()=>{if(!stopped)throw Error('STOP_BEFORE_CHANGING_SETTINGS');}}),/STOP_BEFORE_CHANGING_SETTINGS/);assert.equal(f.c.state.computePolicy,oldPolicy);assert.equal(f.c.state.approvalHistory.at(-1).failureCode,'STOP_BEFORE_CHANGING_SETTINGS');
});
test('arbitrary upstream text is absent from durable approval audit',async t=>{
 const f=await fixture(t),input=await f.proposal(),original=f.c.fetch,secret='SYNTHETIC_PROVIDER_TOKEN_AND_TEXT';f.c.fetch=async(url,options)=>url.endsWith('/health')?original(url,options):Promise.reject(Error(secret));
 await assert.rejects(f.c.approveComputeIdentity(input),/COMPANION_UNAVAILABLE/);assert.equal(fs.readFileSync(f.c.stateFile,'utf8').includes(secret),false);assert.equal(f.c.state.approvalHistory.at(-1).failureCode,'COMPANION_UNAVAILABLE');
});

test('authorization override cannot bypass the reviewed proposal transaction',async t=>{
 const f=await fixture(t);await assert.rejects(f.c.request('test',{}, {cacheMs:0,authorizePolicyHash:proposedPolicy}),/COMPANION_COMPUTE_APPROVAL_INVALID/);assert.equal(f.calls(),0);assert.equal(f.c.state.calls.length,0);
});
test('directory fsync uncertainty after binding rename blocks restart behind durable marker',async t=>{
 const f=await fixture(t),input=await f.proposal(),original=fs.fsyncSync;let failed=false;
 fs.fsyncSync=fd=>{if(!failed&&fs.fstatSync(fd).isDirectory()&&JSON.parse(fs.readFileSync(f.c.stateFile)).computePolicy===proposedPolicy){failed=true;throw Object.assign(Error('Synthetic disk failure'),{code:'EIO'});}return original(fd);};
 try{await assert.rejects(f.c.approveComputeIdentity(input));}finally{fs.fsyncSync=original;}
 assert.equal(failed,true);assert.equal(fs.existsSync(f.c.stateFile+'.approval-pending'),true);assert.equal(f.c.stateError,true);
 const restarted=new Companion(f.home,()=> 'c'.repeat(64),{now:f.now});assert.equal(restarted.stateError,true);assert.equal(restarted.status().lastError,'COMPANION_APPROVAL_RECONCILIATION_REQUIRED');assert.equal(restarted.status().connected,false);await assert.rejects(restarted.request('test',{}),/COMPANION_STATE_INVALID/);await restarted.close();
});
test('marker removal failure discloses reconciliation and blocks further work after known durable commit',async t=>{
 const f=await fixture(t),input=await f.proposal(),original=fs.unlinkSync;
 fs.unlinkSync=file=>{if(file===f.c.stateFile+'.approval-pending')throw Object.assign(Error('Synthetic unlink failure'),{code:'EACCES'});return original(file);};
 let result;try{result=await f.c.approveComputeIdentity(input);}finally{fs.unlinkSync=original;}
 assert.equal(result.approvalStatus,'committed');assert.equal(result.reconciliationRequired,true);assert.equal(result.persisted,true);assert.equal(f.c.status().connected,false);await assert.rejects(f.c.request('test',{}),/COMPANION_APPROVAL_RECONCILIATION_REQUIRED/);
 const restarted=new Companion(f.home,()=> 'c'.repeat(64),{now:f.now});assert.equal(restarted.stateError,true);await restarted.close();
});

test('actual controller stopped guard permits its own exact approval while blocking unrelated setting changes',async t=>{
 const f=await fixture(t),input=await f.proposal(),controller=Object.assign(Object.create(Controller.prototype),{home:f.home,config:{dataDir:f.home},companion:f.c,vault:{unlocked:true},dbRead:fn=>fn({prepare:()=>({get:()=>null})}),invalidate(){}});
 const result=await controller.approveComputeIdentity(input);assert.equal(result.approvalStatus,'committed');assert.equal(f.calls(),1);
});
for(const code of ['COMPUTE_DAILY_LIMIT','COMPUTE_IMAGE_DAILY_LIMIT','COMPUTE_BUSY','COMPUTE_CLI_TIMEOUT'])test('preserved compute protocol retains safe local classification '+code,async t=>{
 const f=await fixture(t),input=await f.proposal(),original=f.c.fetch;f.c.fetch=async(url,options)=>url.endsWith('/health')?original(url,options):Response.json({error:code,detail:'SYNTHETIC_PRIVATE_DETAIL'},{status:503});
 await assert.rejects(f.c.approveComputeIdentity(input),new RegExp(code));assert.equal(f.c.state.approvalHistory.at(-1).failureCode,code);assert.equal(fs.readFileSync(f.c.stateFile,'utf8').includes('SYNTHETIC_PRIVATE_DETAIL'),false);
 if(code.includes('DAILY_LIMIT')){assert.equal(f.c.status().pacing.cause,'daily_allowance_exhausted');assert.equal(f.c.status().pacing.nextAttemptAt,null);assert.equal(f.c.status().pacing.source,'compute');}
 assert.equal(f.c.status().usage.actualProviderCalls,null);
});

test('proposal expiry during provider response prevents late approval',async t=>{
 const f=await fixture(t),input=await f.proposal();f.afterDispatch(()=>f.advance(600001));await assert.rejects(f.c.approveComputeIdentity(input),/COMPANION_COMPUTE_APPROVAL_EXPIRED/);assert.equal(f.c.state.computePolicy,oldPolicy);assert.equal(f.c.state.approvalHistory.at(-1).failureCode,'COMPANION_COMPUTE_APPROVAL_EXPIRED');
});

for(const phase of ['start','commit'])test('controller mutation at '+phase+' prevents identity approval and late audit overwrite',async t=>{
 const f=await fixture(t),input=await f.proposal(),controller=Object.assign(Object.create(Controller.prototype),{home:f.home,config:{dataDir:f.home},companion:f.c,vault:{unlocked:true},dbRead:fn=>fn({prepare:()=>({get:()=>null})}),invalidate(){}});
 if(phase==='start')controller.operation='Restoring backup';else f.afterDispatch(()=>{controller.operation='Restoring backup';});
 await assert.rejects(controller.approveComputeIdentity(input),/OPERATION_IN_PROGRESS/);assert.equal(f.c.state.computePolicy,oldPolicy);assert.equal(f.calls(),phase==='start'?0:1);
 if(phase==='commit')assert.equal(f.c.state.approvalHistory.at(-1).failureCode,'OPERATION_IN_PROGRESS');
});
