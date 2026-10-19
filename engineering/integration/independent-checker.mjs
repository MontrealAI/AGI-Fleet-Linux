// SPDX-License-Identifier: MIT
// Separate bounded implementation: no Jobs checker or arithmetic module is imported.
import {parseStrict} from '../../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';
const requireValue=(value,code)=>{if(!value)throw Error('FLEET_ALLOCATION_'+code);};
function integer(value,min,max,name){requireValue(Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max,name);return value;}
function exact(value,fields){requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...fields].sort().join('|'),'FIELDS');}
export function extractObservedAllocation(text){
  requireValue(typeof text==='string'&&Buffer.byteLength(text)<=400_000,'OBSERVATION');
  const parts=text.split('SUCCESSOR_COMPUTER_RESULT');requireValue(parts.length===2,'RESULT_MARKER');const raw=parts[1].trimStart();requireValue(raw.startsWith('{'),'RESULT_JSON');
  let depth=0,quoted=false,escaped=false;
  for(let index=0;index<raw.length;index++){
    const char=raw[index];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
    else if(char==='"')quoted=true;else if(char==='{'||char==='[')depth++;else if(char==='}'||char===']'){depth--;if(depth===0)return parseStrict(raw.slice(0,index+1),400_000);}
  }
  throw Error('FLEET_ALLOCATION_RESULT_JSON');
}
export function checkAllocation(mission,observed){
  requireValue(mission&&observed&&observed.plan&&observed.check,'MISSING');
  exact(mission.requirements,['earlyUnits','earlyDay','totalUnits','finalDay','budgetCents']);
  const required=mission.requirements;
  integer(required.totalUnits,1,40,'TOTAL');integer(required.earlyUnits,0,required.totalUnits,'EARLY');integer(required.earlyDay,1,365,'EARLY_DAY');integer(required.finalDay,required.earlyDay,365,'FINAL_DAY');integer(required.budgetCents,0,1_000_000_000,'BUDGET');
  requireValue(Array.isArray(mission.suppliers)&&mission.suppliers.length>=1&&mission.suppliers.length<=3,'SUPPLIERS');
  const quotes=new Map();
  for(const quote of mission.suppliers){
    requireValue(typeof quote.id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(quote.id)&&!quotes.has(quote.id),'QUOTE_ID');
    integer(quote.unitCents,0,10_000_000,'UNIT_PRICE');integer(quote.freightCents,0,10_000_000,'FREIGHT');integer(quote.deliveryDay,1,365,'DELIVERY_DAY');quotes.set(quote.id,quote);
  }
  requireValue(Array.isArray(observed.plan.allocations)&&observed.plan.allocations.length>=1&&observed.plan.allocations.length<=3,'ALLOCATIONS');
  const used=new Set();let units=0,early=0,cost=0,allOnTime=true,allEarly=true;
  for(const allocation of observed.plan.allocations){
    exact(allocation,['supplierId','units']);requireValue(quotes.has(allocation.supplierId)&&!used.has(allocation.supplierId),'UNKNOWN_OR_DUPLICATE');
    const quantity=integer(allocation.units,1,40,'QUANTITY'),quote=quotes.get(allocation.supplierId);used.add(allocation.supplierId);
    units+=quantity;cost+=quantity*quote.unitCents+quote.freightCents;
    if(quote.deliveryDay<=required.earlyDay)early+=quantity;else allEarly=false;
    if(quote.deliveryDay>required.finalDay)allOnTime=false;
  }
  const checks={totalUnits:units===required.totalUnits,earlyUnits:early>=required.earlyUnits,finalDeadline:allOnTime,budget:cost<=required.budgetCents,
    formulation:observed.formulation==='actual_requirements'||observed.formulation==='all_early'&&used.size===1&&allEarly,
    claimedCost:observed.plan.costCents===cost,claimedTotals:observed.check.totals?.totalUnits===units&&observed.check.totals?.earlyUnits===early&&observed.check.totals?.costCents===cost,
    noPurchase:observed.purchaseExecuted===false,mission:observed.missionDigest===mission.digest};
  const feasible=checks.totalUnits&&checks.earlyUnits&&checks.finalDeadline&&checks.budget&&checks.formulation;
  checks.claimedValidity=observed.check.valid===feasible;
  return {schema:'agi-fleet/independent-supplier-constraint-check/v1',accepted:Object.values(checks).every(Boolean)&&feasible,checks,
    recomputed:{totalUnits:units,earlyUnits:early,costCents:cost},independentlyImplementedConstraintCheck:true,independentlyControlledEconomicReview:false,
    sourceAuthenticityEstablished:false,protectedEvaluation:false,productionQualified:false,authority:'none'};
}
