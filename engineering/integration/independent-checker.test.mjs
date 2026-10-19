// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAllocation,extractObservedAllocation} from './independent-checker.mjs';
const mission={digest:'synthetic-mission',requirements:{earlyUnits:10,earlyDay:7,totalUnits:40,finalDay:14,budgetCents:51000},suppliers:[{id:'stellar',unitCents:1200,freightCents:1000,deliveryDay:7},{id:'laurentian',unitCents:700,freightCents:2000,deliveryDay:12},{id:'boreal',unitCents:1400,freightCents:0,deliveryDay:5}]};
const observed={missionDigest:mission.digest,formulation:'actual_requirements',purchaseExecuted:false,plan:{allocations:[{supplierId:'stellar',units:10},{supplierId:'laurentian',units:30}],costCents:36000},check:{valid:true,totals:{totalUnits:40,earlyUnits:10,costCents:36000}}};
test('separate implementation sums exact integer costs and freight once per used supplier',()=>{
  const result=checkAllocation(mission,observed);assert.equal(result.accepted,true);assert.deepEqual(result.recomputed,{totalUnits:40,earlyUnits:10,costCents:36000});assert.equal(result.independentlyImplementedConstraintCheck,true);assert.equal(result.independentlyControlledEconomicReview,false);
});
for(const [name,mutate] of Object.entries({
  price:(m)=>m.suppliers[0].unitCents++,freight:(m)=>m.suppliers[1].freightCents++,
  earlyDeadline:(m)=>m.suppliers[0].deliveryDay=8,finalDeadline:(m)=>m.suppliers[1].deliveryDay=15,
  quantity:(_,o)=>o.plan.allocations[0].units=9,claimedCost:(_,o)=>o.plan.costCents--,
  claimedTotal:(_,o)=>o.check.totals.totalUnits=41,claimedEarly:(_,o)=>o.check.totals.earlyUnits=40,
  budget:(m)=>m.requirements.budgetCents=35999,formulation:(_,o)=>o.formulation='all_early',
  purchase:(_,o)=>o.purchaseExecuted=true,mission:(_,o)=>o.missionDigest='other-mission',
}))test('refuses altered '+name+' without trusting a validity claim',()=>{const m=structuredClone(mission),o=structuredClone(observed);mutate(m,o);assert.equal(checkAllocation(m,o).accepted,false);});
for(const [name,mutate] of Object.entries({
  duplicate:(_,o)=>o.plan.allocations.push({...o.plan.allocations[0]}),unknown:(_,o)=>o.plan.allocations[0].supplierId='unknown',
  fractional:(_,o)=>o.plan.allocations[0].units=9.5,negative:(_,o)=>o.plan.allocations[0].units=-1,
  duplicateQuote:(m)=>m.suppliers.push({...m.suppliers[0]}),nonfinite:(m)=>m.suppliers[0].unitCents=Infinity,
}))test('rejects malformed '+name+' before producing acceptance',()=>{const m=structuredClone(mission),o=structuredClone(observed);mutate(m,o);assert.throws(()=>checkAllocation(m,o));});
test('no freight is charged for a supplier absent from the positive allocation',()=>{const m=structuredClone(mission);m.suppliers[2].freightCents=999999;assert.equal(checkAllocation(m,observed).recomputed.costCents,36000);});
test('screen extraction retains the exact bounded object and refuses ambiguous markers and duplicate keys',()=>{
  assert.deepEqual(extractObservedAllocation('Screen\nSUCCESSOR_COMPUTER_RESULT '+JSON.stringify(observed)+'\nEnd'),observed);
  assert.throws(()=>extractObservedAllocation('SUCCESSOR_COMPUTER_RESULT {} SUCCESSOR_COMPUTER_RESULT {}'));
  assert.throws(()=>extractObservedAllocation('SUCCESSOR_COMPUTER_RESULT {"a":1,"a":2}'));
  assert.throws(()=>extractObservedAllocation('SUCCESSOR_COMPUTER_RESULT {'));
});
