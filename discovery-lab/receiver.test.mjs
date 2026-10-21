import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonical,validateWorkRequest} from './contract.mjs';
import {STAGES,RESOURCES,inspectDiscoveryRequest,admitDiscoveryReview,reviewDiscoveryRequest} from './receiver.mjs';

const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const vector=value=>Object.fromEntries(RESOURCES.map(key=>[key,value]));
function fixture(stage='learn',route='manager-usdc') {
  const payload={fixture:'transport-boundary-only',stage};
  const request={schema:'successor-discovery-work-request/v1',missionId:'capability-00000000-0000-4000-8000-000000000001',revision:0,
    purposeDigest:'1'.repeat(64),charterDigest:'2'.repeat(64),modelDigest:'3'.repeat(64),sourceDigest:'4'.repeat(64),
    evaluatorDigest:'5'.repeat(64),stage,inputArtifacts:[],resourceLimits:vector(1000000),executionMode:'synthetic-local',
    commission:{id:'commission-1',branch:route,route,currency:route==='manager-usdc'?'USDC6':'AGIALPHA18',capBaseUnits:'0',status:'DRAFT_NOT_SUBMITTED'},
    payloadDigest:digest(payload),payload};
  const expected=Object.fromEntries(['missionId','revision','purposeDigest','charterDigest','modelDigest','sourceDigest','evaluatorDigest'].map(key=>[key,request[key]]));
  const installed={executorId:'fixture-checker',expected,expectedCommission:{id:request.commission.id,branch:request.commission.branch,route},
    runtimeDigest:'6'.repeat(64),currentRuntimeDigest:'6'.repeat(64),stages:[...STAGES],resourceCapacity:vector(1000000),
    inspectCampaign:async()=>({accepted:true,resourceUsed:vector(0),reasons:[]})};
  return {request,installed,raw:()=>canonical(request)};
}
test('all six discriminants and both inert currency routes are transport-compatible',async()=>{
  for(const stage of STAGES)for(const route of ['manager-usdc','jobs-agialpha']) {
    const f=fixture(stage,route);assert.equal((await inspectDiscoveryRequest(f.raw())).stage,stage);
    const receipt=await reviewDiscoveryRequest(f.raw(),f.installed);
    assert.equal(receipt.state,'accepted-local-review');assert.equal(receipt.remoteExecution,'unprovisioned');
    assert.equal(receipt.organizationalIndependence,false);assert.equal(receipt.authority,'none');
    assert.ok(receipt.resourceUsed.checking>=1&&receipt.resourceUsed.memoryBytes>0&&receipt.resourceUsed.storageBytes>0);
  }
});
test('unprovisioned is the default and imported fields cannot install a checker',async()=>{
  const f=fixture();assert.equal((await reviewDiscoveryRequest(f.raw())).state,'unprovisioned');
  f.request.installed={executorId:'pretend'};assert.equal((await admitDiscoveryReview(f.raw())).receipt.state,'unsupported');
});
test('transport inspection does not manufacture semantic acceptance',async()=>{
  const f=fixture();f.installed.inspectCampaign=async()=>({accepted:false,resourceUsed:vector(0),reasons:['INVALID_CALIBRATION']});
  assert.equal((await inspectDiscoveryRequest(f.raw())).payload.fixture,'transport-boundary-only');
  const receipt=await reviewDiscoveryRequest(f.raw(),f.installed);assert.equal(receipt.state,'rejected-local-review');
  assert.deepEqual(receipt.reasons,['INVALID_CALIBRATION']);
});
test('each immutable binding and the current runtime identity must match',async()=>{
  for(const key of Object.keys(fixture().installed.expected)) {
    const f=fixture();f.installed.expected[key]=key==='revision'?1:key==='missionId'?'capability-00000000-0000-4000-8000-000000000002': 'a'.repeat(64);
    assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'rejected',key);
  }
  const f=fixture();f.installed.currentRuntimeDigest='a'.repeat(64);
  assert.deepEqual((await reviewDiscoveryRequest(f.raw(),f.installed)).reasons,['DISCOVERY_RUNTIME_CHANGED']);
});
test('logical commission identity, branch and route are frozen independently',async()=>{
  for(const key of ['id','branch','route']) {
    const f=fixture();f.installed.expectedCommission[key]=key==='route'?'jobs-agialpha':'other';
    assert.deepEqual((await admitDiscoveryReview(f.raw(),f.installed)).receipt.reasons,['DISCOVERY_COMMISSION_BINDING']);
  }
});
test('unsupported stages and modes never invoke the registered checker',async()=>{
  const f=fixture();let calls=0;f.installed.inspectCampaign=async()=>{calls++;throw Error('unreachable');};
  f.installed.stages=['think'];assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'unsupported');
  f.request.executionMode='remote';assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'unsupported');
  assert.equal(calls,0);
});
test('receiver refuses positive caps, currency mixing and submitted imports',async()=>{
  for(const [key,value] of [['capBaseUnits','1'],['currency','AGIALPHA18'],['status','SUBMITTED']]) {
    const f=fixture();f.request.commission[key]=value;assert.equal((await admitDiscoveryReview(f.raw(),f.installed)).receipt.state,'rejected');
  }
});
test('changed executable data, duplicate keys and non-finite resources refuse',async()=>{
  const f=fixture();f.request.payload.changed=true;await assert.rejects(()=>inspectDiscoveryRequest(f.raw()),/payload commitment mismatch/);
  const g=fixture();await assert.rejects(()=>inspectDiscoveryRequest(g.raw().replace('{','{"schema":"duplicate",')),/Duplicate JSON key/);
  const unsafe=g.raw().replace('\"checking\":1000000','\"checking\":9007199254740992');await assert.rejects(()=>inspectDiscoveryRequest(unsafe),/Unsafe integer/);
});
test('capacity mismatch remains unprovisioned; insufficient review budget is inconclusive',async()=>{
  const f=fixture();f.installed.resourceCapacity.search=0;
  assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'unprovisioned');
  const g=fixture();g.request.resourceLimits.checking=0;
  assert.equal((await reviewDiscoveryRequest(g.raw(),g.installed)).state,'inconclusive');
});
test('failed and over-budget checks retain cost lower bounds and never become rejection proofs',async()=>{
  const f=fixture();f.installed.inspectCampaign=async()=>{throw Error('interrupted');};
  const failed=await reviewDiscoveryRequest(f.raw(),f.installed);
  assert.equal(failed.state,'inconclusive');assert.equal(failed.resourceAccounting,'lower-bound-checker-failed');
  assert.equal(failed.resourceUsed.checking,1);
  const g=fixture();g.installed.inspectCampaign=async()=>({accepted:false,resourceUsed:{...vector(0),search:1000001},reasons:['NO_CANDIDATE']});
  const exhausted=await reviewDiscoveryRequest(g.raw(),g.installed);
  assert.equal(exhausted.state,'inconclusive');assert.ok(exhausted.reasons.includes('DISCOVERY_REVIEW_BUDGET_EXHAUSTED'));
  assert.equal(exhausted.resourceUsed.search,1000001);
});
test('previous acceptance is rechecked on every retry, with no hidden receipt store',async()=>{
  const f=fixture();let calls=0;
  f.installed.inspectCampaign=async()=>({accepted:++calls===1,resourceUsed:vector(0),reasons:calls===1?[]:['CURRENT_CHECK_FAILED']});
  assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'accepted-local-review');
  assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'rejected-local-review');assert.equal(calls,2);
});
test('malformed checker output is inconclusive and never publishes an accepted receipt',async()=>{
  const f=fixture();f.installed.inspectCampaign=async()=>({accepted:true,resourceUsed:vector(0),reasons:[],unexpected:true});
  assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'inconclusive');
});
test('storage is reserved before semantic work and current request cannot be rewritten by its checker',async()=>{
  const f=fixture();let calls=0;f.request.resourceLimits.storageBytes=0;
  f.installed.inspectCampaign=async()=>{calls++;throw Error('unreachable');};
  assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'inconclusive');assert.equal(calls,0);
  const g=fixture();g.installed.inspectCampaign=async(payload,{request})=>{
    request.revision=9;return {accepted:true,resourceUsed:vector(0),reasons:[]};
  };
  const receipt=await reviewDiscoveryRequest(g.raw(),g.installed);
  assert.equal(receipt.state,'inconclusive');assert.equal(receipt.revision,0);
  assert.deepEqual(receipt.reasons,['DISCOVERY_CHECKER_FAILED']);
});
test('exhaustion at the exact budget is inconclusive and installed identity stays source-bound',async()=>{
  const f=fixture();f.installed.inspectCampaign=async()=>({accepted:false,resourceUsed:{...vector(0),search:1000000},reasons:['BUDGET_EXHAUSTED']});
  assert.equal((await reviewDiscoveryRequest(f.raw(),f.installed)).state,'inconclusive');
  const g=fixture();g.installed.inspectCampaign=async()=>{
    g.installed.currentRuntimeDigest='a'.repeat(64);g.installed.executorId='changed';
    return {accepted:true,resourceUsed:vector(0),reasons:[]};
  };
  const receipt=await reviewDiscoveryRequest(g.raw(),g.installed);assert.equal(receipt.state,'inconclusive');
  assert.equal(receipt.runtimeDigest,'6'.repeat(64));assert.equal(receipt.executorId,'fixture-checker');
  assert.deepEqual(receipt.reasons,['DISCOVERY_CHECKER_CHANGED_CONTEXT']);
});
test('unrepresentable receipt totals are retained as explicit lower-bound inconclusive outcomes',async()=>{
  const f=fixture();f.installed.inspectCampaign=async()=>({accepted:true,resourceUsed:{...vector(0),storageBytes:Number.MAX_SAFE_INTEGER},reasons:[]});
  const receipt=await reviewDiscoveryRequest(f.raw(),f.installed);assert.equal(receipt.state,'inconclusive');
  assert.equal(receipt.resourceAccounting,'lower-bound-receipt-overflow');
  assert.equal(receipt.resourceUsed.storageBytes,Number.MAX_SAFE_INTEGER);
});
test('direct object APIs reject hidden data and getters without invoking them',async()=>{
  const f=fixture();Object.defineProperty(f.request.payload,'hidden',{value:1});
  await assert.rejects(()=>validateWorkRequest(f.request));
  const g=fixture();let calls=0;Object.defineProperty(g.request.payload,'getter',{get(){calls++;return 1;},enumerable:true});
  await assert.rejects(()=>validateWorkRequest(g.request));assert.equal(calls,0);
  const h=fixture();h.request.payload[Symbol('hidden')]=1;await assert.rejects(()=>validateWorkRequest(h.request));
  const i=fixture();i.request.inputArtifacts.extra='hidden';await assert.rejects(()=>validateWorkRequest(i.request));
});
test('checker receives remaining budget and returned reasons cannot alias later changes',async()=>{
  const f=fixture(),reasons=['COMPLETE_FINITE_CHECK'];let remaining;
  f.installed.inspectCampaign=async(payload,{limits})=>{
    remaining=limits;return {accepted:true,resourceUsed:vector(0),reasons};
  };
  const result=await reviewDiscoveryRequest(f.raw(),f.installed);
  assert.equal(remaining.checking,f.request.resourceLimits.checking-1);
  assert.equal(remaining.memoryBytes,f.request.resourceLimits.memoryBytes-Buffer.byteLength(f.raw()));
  assert.equal(remaining.storageBytes,f.request.resourceLimits.storageBytes-8192);
  reasons.push('MUTATED_AFTER_RETURN');assert.deepEqual(result.reasons,['COMPLETE_FINITE_CHECK']);
});
test('checker report semantics use one captured data frame without reading property behavior',async()=>{
  const f=fixture();let reportReads=0,reportFrames=0;
  const report=new Proxy({accepted:false,resourceUsed:vector(0),reasons:[]},{
    ownKeys(target){reportFrames++;return Reflect.ownKeys(target);},
    get(target,key,receiver){
      if(key==='then')return undefined; // Promise assimilation is separate from report data.
      reportReads++;return key==='accepted'?true:Reflect.get(target,key,receiver);
    }
  });
  f.installed.inspectCampaign=()=>report;
  const rejected=await reviewDiscoveryRequest(f.raw(),f.installed);
  assert.equal(rejected.state,'rejected-local-review');assert.equal(reportReads,0);assert.equal(reportFrames,1);
  const g=fixture();let resourceReads=0,resourceFrames=0;
  const resourceUsed=new Proxy({...vector(0),checking:-5000},{
    ownKeys(target){resourceFrames++;return Reflect.ownKeys(target);},
    get(target,key,receiver){resourceReads++;return key==='checking'?0:Reflect.get(target,key,receiver);}
  });
  g.installed.inspectCampaign=()=>({accepted:true,resourceUsed,reasons:[]});
  const malformed=await reviewDiscoveryRequest(g.raw(),g.installed);
  assert.equal(malformed.state,'inconclusive');assert.equal(malformed.resourceUsed.checking,1);
  assert.equal(resourceReads,0);assert.equal(resourceFrames,1);
});
test('unprovisioned admission attempts retain known input, checking, receipt and elapsed costs',async()=>{
  const f=fixture(),result=await reviewDiscoveryRequest(f.raw());
  assert.equal(result.state,'unprovisioned');assert.equal(result.resourceUsed.checking,1);
  assert.equal(result.resourceUsed.memoryBytes,Buffer.byteLength(f.raw()));
  assert.equal(result.resourceUsed.storageBytes,Buffer.byteLength(canonical(result)));
  assert.ok(result.resourceUsed.elapsedMs>=0);
});
test('exhausted receiver overhead precedes every stale binding decision',async()=>{
  const mismatches=[
    context=>{context.currentRuntimeDigest='a'.repeat(64);},
    ...Object.keys(fixture().installed.expected).map(key=>context=>{
      context.expected[key]=key==='revision'?1:key==='missionId'?'capability-00000000-0000-4000-8000-000000000002':'a'.repeat(64);
    }),
    ...['id','branch','route'].map(key=>context=>{context.expectedCommission[key]=key==='route'?'jobs-agialpha':'different';}),
  ];
  for(const resource of ['checking','memoryBytes','storageBytes','elapsedMs'])for(const mismatch of mismatches) {
    const f=fixture();f.request.resourceLimits[resource]=0;mismatch(f.installed);let calls=0;
    f.installed.inspectCampaign=async()=>{calls++;throw Error('must not execute');};
    const receipt=await reviewDiscoveryRequest(f.raw(),f.installed);
    assert.equal(receipt.state,'inconclusive',resource);
    assert.ok(receipt.reasons.includes('DISCOVERY_REVIEW_BUDGET_EXHAUSTED'));
    assert.equal(receipt.resourceUsed.checking,1);assert.equal(calls,0);
    assert.equal(receipt.resourceUsed.storageBytes,Buffer.byteLength(canonical(receipt)));
  }
});
test('zero checking allowance cannot inspect installed context before overhead admission',async()=>{
  const f=fixture();f.request.resourceLimits.checking=0;let reads=0;
  Object.defineProperty(f.installed,'runtimeDigest',{get(){reads++;return '6'.repeat(64);}});
  const receipt=await reviewDiscoveryRequest(f.raw(),f.installed);
  assert.equal(receipt.state,'inconclusive');assert.equal(reads,0);
});
