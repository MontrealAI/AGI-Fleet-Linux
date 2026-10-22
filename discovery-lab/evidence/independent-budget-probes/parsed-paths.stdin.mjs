import fs from 'node:fs';
import assert from 'node:assert/strict';
import {canonical} from './discovery-lab/contract.mjs';
import {RESOURCES,reviewDiscoveryRequest,admitDiscoveryReview} from './discovery-lab/receiver.mjs';
const original=JSON.parse(fs.readFileSync('./discovery-lab/fixtures/transport-request.json','utf8'));
const vector=x=>Object.fromEntries(RESOURCES.map(k=>[k,x]));
const config=q=>({executorId:'independent-probe',runtimeDigest:'6'.repeat(64),currentRuntimeDigest:'6'.repeat(64),expected:Object.fromEntries(['missionId','revision','purposeDigest','charterDigest','modelDigest','sourceDigest','evaluatorDigest'].map(k=>[k,q[k]])),expectedCommission:Object.fromEntries(['id','branch','route'].map(k=>[k,q.commission[k]])),stages:['learn','think','design','strategise','execute','evolve'],resourceCapacity:vector(1000000000),inspectCampaign:async()=>{throw Error('checker must not run');}});
let cases=0;
for(const path of ['missing','invalid','unsupported-stage','capacity'])for(const resource of ['checking','memoryBytes','storageBytes','elapsedMs'])for(const entry of [admitDiscoveryReview,reviewDiscoveryRequest]) {
 const q=structuredClone(original); q.resourceLimits=vector(1000000);q.resourceLimits[resource]=0;
 let installed=config(q);
 if(path==='missing')installed=null;
 if(path==='invalid')installed.executorId='';
 if(path==='unsupported-stage')installed.stages=[];
 if(path==='capacity')installed.resourceCapacity.search=0;
 const output=await entry(canonical(q),installed),r=output.receipt??output;
 assert.equal(r.state,'inconclusive',path+' '+resource);
 assert(r.reasons.includes('DISCOVERY_REVIEW_BUDGET_EXHAUSTED'));
 assert.equal(r.resourceUsed.storageBytes,Buffer.byteLength(canonical(r)));
 cases++;
}
console.log(JSON.stringify({independentParsedPathCases:cases,passed:true}));
