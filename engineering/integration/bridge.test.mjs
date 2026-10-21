// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createComputerJourney,inspectComputerJourney,sha256} from './bridge.mjs';
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const syntheticMission={digest:'synthetic-mission',requirements:{earlyUnits:1,earlyDay:7,totalUnits:1,finalDay:14,budgetCents:10},suppliers:[{id:'fixture',unitCents:1,freightCents:1,deliveryDay:7}]};
const syntheticObserved={missionDigest:'synthetic-mission',formulation:'actual_requirements',purchaseExecuted:false,plan:{allocations:[{supplierId:'fixture',units:1}],costCents:2},check:{valid:true,totals:{totalUnits:1,earlyUnits:1,costCents:2}}};
const inputs={handoffRaw:'synthetic-handoff',returnRaw:'synthetic-return',reportRaw:JSON.stringify({mission:syntheticMission})};
function collaborators(){
  const create=asset=>async(value,options)=>canonical({asset,inputs:value,proposed:asset==='USDC'?options.budgetUSDC:options.amountBaseUnits,createdAt:options.createdAt,authority:'none'});
  return {inspectAlphaReturn:async()=>({handoff:{projectSha256:'a'.repeat(64)},project:{id:'synthetic-project'},returned:{observedText:'PROTOCOL DOUBLE NO BROWSER\nSUCCESSOR_COMPUTER_RESULT '+JSON.stringify(syntheticObserved),executionContext:'b'.repeat(64),taskCommitment:'c'.repeat(64),receipt:{state:'review',cleanup:'VERIFIED'}}}),
    reviewObservedAllocation:async()=>({accepted:true}),createManagerDraft:create('USDC'),createJobsDraft:create('AGIALPHA'),inspectManagerDraft:async raw=>JSON.parse(raw),inspectJobsDraft:async raw=>JSON.parse(raw),
    retainHistory:async(project,handoffRaw)=>canonical({project,records:[{handoffRaw,returnRaw:null,review:null}]}),
    importReturn:async(project,handoffRaw,returnRaw)=>canonical({project,records:[{handoffRaw,returnRaw,review:null}]}),inspectHistory:async raw=>JSON.parse(raw),budgetUSDC:'25.00',amountBaseUnits:'7000000000000000000',createdAt:'2026-10-19T00:00:00.000Z'};
}
test('synthetic orchestration preserves exact native bytes, distinct proposals and pending human review',async()=>{
  const options=collaborators(),raw=await createComputerJourney(inputs,options),value=await inspectComputerJourney(raw,options);
  assert.deepEqual(value.inputs,inputs);assert.equal(value.bindings.returnSha256,sha256(inputs.returnRaw));
  assert.equal(JSON.parse(value.routes.managerRaw).asset,'USDC');assert.equal(JSON.parse(value.routes.jobsRaw).asset,'AGIALPHA');
  assert.equal(JSON.parse(value.historyRaw).records[0].review,null);assert.equal(value.qualification.fleetProductionDispatch,false);assert.equal(value.qualification.independentEconomicReview,false);
});
for(const field of ['inputs','routes','historyRaw','qualification','authority','settlement'])test('a resealed '+field+' substitution cannot inherit the supported observation',async()=>{
  const options=collaborators(),value=JSON.parse(await createComputerJourney(inputs,options));
  if(field==='inputs')value.inputs.returnRaw+='changed';
  if(field==='routes')value.routes.jobsRaw=value.routes.managerRaw;
  if(field==='historyRaw')value.historyRaw='{}';
  if(field==='qualification')value.qualification.independentEconomicReview=true;
  if(field==='authority')value.authority='approved';
  if(field==='settlement')value.settlement='funded';
  delete value.sha256;value.sha256=sha256(canonical(value));
  await assert.rejects(inspectComputerJourney(canonical(value),options));
});
test('interrupted native session and fabricated human review fail before a result can be returned',async()=>{
  const incomplete=collaborators();incomplete.inspectAlphaReturn=async()=>({returned:{receipt:{state:'interrupted',cleanup:'VERIFIED'}}});
  await assert.rejects(createComputerJourney(inputs,incomplete),/NATIVE_INCOMPLETE/);
  const reviewed=collaborators();reviewed.importReturn=async()=>canonical({records:[{handoffRaw:inputs.handoffRaw,returnRaw:inputs.returnRaw,review:{decision:'useful'}}]});
  await assert.rejects(createComputerJourney(inputs,reviewed),/HISTORY/);
});
test('code-installed inspectors are mandatory; imported bytes cannot supply functions',async()=>{
  const options=collaborators();delete options.inspectAlphaReturn;await assert.rejects(createComputerJourney(inputs,options),/INSTALLED/);
  await assert.rejects(createComputerJourney({...inputs,inspectAlphaReturn:'forged-code'},collaborators()),/INPUT_FIELDS/);
});
test('noncanonical duplicate-key wrapper is rejected before receiver execution',async()=>{
  const raw=await createComputerJourney(inputs,collaborators());
  await assert.rejects(inspectComputerJourney(raw.replace('"schema":','"schema":"forged","schema":'),collaborators()),/CANONICAL/);
});
