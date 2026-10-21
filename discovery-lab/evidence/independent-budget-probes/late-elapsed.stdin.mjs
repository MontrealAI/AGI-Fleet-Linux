import fs from 'node:fs';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {canonical} from './discovery-lab/contract.mjs';import {RESOURCES,admitDiscoveryReview} from './discovery-lab/receiver.mjs';
const q=JSON.parse(fs.readFileSync('./discovery-lab/fixtures/transport-request.json','utf8'));
const vector=x=>Object.fromEntries(RESOURCES.map(k=>[k,x]));q.resourceLimits=vector(1000000);q.resourceLimits.elapsedMs=15;
const installed={executorId:'independent-probe',runtimeDigest:'6'.repeat(64),currentRuntimeDigest:'a'.repeat(64),expected:Object.fromEntries(['missionId','revision','purposeDigest','charterDigest','modelDigest','sourceDigest','evaluatorDigest'].map(k=>[k,q[k]])),expectedCommission:Object.fromEntries(['id','branch','route'].map(k=>[k,q.commission[k]])),stages:['learn','think','design','strategise','execute','evolve'],resourceCapacity:vector(1000000),inspectCampaign:async()=>{throw Error('must not execute');}};
Object.defineProperty(installed,'executorId',{get(){const t=performance.now();while(performance.now()-t<20){}return 'independent-probe';}});
const {receipt:r}=await admitDiscoveryReview(canonical(q),installed);
assert.equal(r.state,'inconclusive');assert(r.resourceUsed.elapsedMs>q.resourceLimits.elapsedMs);assert(r.reasons.includes('DISCOVERY_RUNTIME_CHANGED'));assert(r.reasons.includes('DISCOVERY_REVIEW_BUDGET_EXHAUSTED'));
console.log(JSON.stringify({lateElapsedOverrunConverted:true,used:r.resourceUsed.elapsedMs,limit:q.resourceLimits.elapsedMs,reasons:r.reasons}));
