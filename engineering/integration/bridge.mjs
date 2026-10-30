// SPDX-License-Identifier: MIT
// Engineering receipt composition only; this module cannot dispatch Fleet tasks or settle work.
import {createHash} from 'node:crypto';
import {checkAllocation,extractObservedAllocation} from './independent-checker.mjs';
export const SCHEMA='agi-fleet/four-repository-computer-journey/v1';
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const sha256=raw=>createHash('sha256').update(raw).digest('hex');
const need=(condition,code)=>{if(!condition)throw Error('FOUR_REPO_'+code);};
function input(value){
  need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')==='handoffRaw|reportRaw|returnRaw','INPUT_FIELDS');
  for(const raw of Object.values(value))need(typeof raw==='string'&&Buffer.byteLength(raw)<=4_000_000,'INPUT_SIZE');
}
function installed(options){
  for(const name of ['inspectAlphaReturn','reviewObservedAllocation','createManagerDraft','inspectManagerDraft','createJobsDraft','inspectJobsDraft','retainHistory','importReturn','inspectHistory'])need(typeof options[name]==='function','INSTALLED_'+name);
}
export async function createComputerJourney(inputs,options){
  input(inputs);installed(options);
  const native=await options.inspectAlphaReturn(inputs.handoffRaw,inputs.returnRaw);
  need(native.returned.receipt.state==='review'&&native.returned.receipt.cleanup==='VERIFIED','NATIVE_INCOMPLETE');
  const callback={inspectAlphaReturn:options.inspectAlphaReturn,inspectComputerEvidence:options.inspectComputerEvidence,reviewObservedAllocation:options.reviewObservedAllocation};
  const managerRaw=await options.createManagerDraft(inputs,{...callback,budgetUSDC:options.budgetUSDC,createdAt:options.createdAt});
  const jobsRaw=await options.createJobsDraft(inputs,{...callback,amountBaseUnits:options.amountBaseUnits,createdAt:options.createdAt});
  await options.inspectManagerDraft(managerRaw,callback);await options.inspectJobsDraft(jobsRaw,callback);
  const report=JSON.parse(inputs.reportRaw);
  const constraintCheck=checkAllocation(report.mission,extractObservedAllocation(native.returned.observedText));
  need(constraintCheck.accepted,'INDEPENDENT_CONSTRAINT_CHECK');
  const retained=await options.retainHistory(native.project,inputs.handoffRaw);
  const historyRaw=await options.importReturn(native.project,inputs.handoffRaw,inputs.returnRaw,{priorRecord:retained});
  const history=await options.inspectHistory(historyRaw);
  need(history.records.length===1&&history.records[0].handoffRaw===inputs.handoffRaw&&history.records[0].returnRaw===inputs.returnRaw&&history.records[0].review===null,'HISTORY');
  const body={schema:SCHEMA,inputs,bindings:{handoffSha256:sha256(inputs.handoffRaw),returnSha256:sha256(inputs.returnRaw),reportSha256:sha256(inputs.reportRaw),projectSha256:native.handoff.projectSha256,executionContext:native.returned.executionContext,taskCommitment:native.returned.taskCommitment},
    planning:{budgetUSDC:options.budgetUSDC,amountBaseUnits:options.amountBaseUnits,createdAt:options.createdAt},routes:{managerRaw,jobsRaw},historyRaw,constraintCheck,
    qualification:{scope:'engineering-native-computer-compatibility',nativeReceiptSemanticsChecked:true,separateArithmeticCheck:true,independentlyImplementedConstraintCheck:true,independentlyControlledEconomicReview:false,independentEconomicReview:false,protectedEvaluation:false,fleetProductionDispatch:false,productionQualified:false},authority:'none',settlement:'not-connected'};
  const raw=canonical({...body,sha256:sha256(canonical(body))});need(Buffer.byteLength(raw)<=16_000_000,'OUTPUT_SIZE');return raw;
}
export async function inspectComputerJourney(raw,options){
  need(typeof raw==='string'&&Buffer.byteLength(raw)<=16_000_000,'SIZE');
  const value=JSON.parse(raw);need(canonical(value)===raw,'CANONICAL');
  const {sha256:checksum,...body}=value;need(checksum===sha256(canonical(body)),'INTEGRITY');
  const expected=await createComputerJourney(value.inputs,{...options,...value.planning});
  need(raw===expected,'SEMANTIC_BINDING');return value;
}
