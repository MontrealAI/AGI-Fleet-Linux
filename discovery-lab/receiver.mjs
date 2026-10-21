import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {REQUEST_SCHEMA, STAGES, RESOURCE_KEYS, BINDING_KEYS, canonical, parseWorkRequest, validateResources, validateBindings} from './contract.mjs';
export {REQUEST_SCHEMA, STAGES};
export const RECEIPT_SCHEMA = 'agi-fleet/discovery-review/v1';
export const RESOURCES = RESOURCE_KEYS;
export const RECEIPT_RESERVATION_BYTES = 8192;
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const zero = () => Object.fromEntries(RESOURCES.map(key=>[key,0]));
const resources = validateResources;
const reason = (error,fallback) => typeof error?.code==='string'&&/^[A-Z0-9_:-]{1,120}$/.test(error.code)?error.code:fallback;
const need=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const keys=(value,expected)=>need(value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key)),'FIELDS_INVALID');
const freeze = value => {
  if(value&&typeof value==='object') { for(const child of Object.values(value))freeze(child);Object.freeze(value); }
  return value;
};
const snapshotInstalled = installed => JSON.parse(canonical(Object.fromEntries(
  ['executorId','runtimeDigest','currentRuntimeDigest','expected','expectedCommission','stages','resourceCapacity'].map(key=>[key,installed[key]]))));
export const inspectDiscoveryRequest = parseWorkRequest;

const bindings = BINDING_KEYS;
function installedContext(installed) {
  need(installed&&typeof installed==='object','DISCOVERY_INSTALLED_CONTEXT_REQUIRED');
  need(identity(installed.executorId)&&hash(installed.runtimeDigest)&&hash(installed.currentRuntimeDigest),'DISCOVERY_INSTALLED_IDENTITY');
  validateBindings(installed.expected);
  keys(installed.expectedCommission,['id','branch','route']);
  need(identity(installed.expectedCommission.id)&&identity(installed.expectedCommission.branch)
    &&['manager-usdc','jobs-agialpha'].includes(installed.expectedCommission.route),'DISCOVERY_INSTALLED_COMMISSION');
  need(Array.isArray(installed.stages)&&installed.stages.every(stage=>STAGES.includes(stage)),'DISCOVERY_INSTALLED_STAGES');
  resources(installed.resourceCapacity);
  need(typeof installed.inspectCampaign==='function','DISCOVERY_INSTALLED_CHECKER_REQUIRED');
}
function receipt(request,raw,state,reasons,used,installed=null) {
  return {schema:RECEIPT_SCHEMA,state,reasons,missionId:request?.missionId??null,revision:request?.revision??null,
    stage:request?.stage??null,requestDigest:raw.length<=2_000_000&&Buffer.byteLength(raw)<=2_000_000?digest(raw):null,payloadDigest:request?.payloadDigest??null,
    sourceDigest:request?.sourceDigest??null,evaluatorDigest:request?.evaluatorDigest??null,
    commission:request?.commission??null,
    executorId:installed?.executorId??null,runtimeDigest:installed?.currentRuntimeDigest??null,
    executionMode:'synthetic-local',scope:'bounded-synthetic-semantic-review',resourceUsed:used,
    resourceAccounting:'admission-only-known-input-and-receipt-bytes',
    authority:'none',remoteExecution:'unprovisioned',settlement:'not-connected',
    organizationalIndependence:false,protectedHoldout:false};
}
function finalize(result,request) {
  const used=result.resourceUsed,checkerStorage=used.storageBytes;
  const sizeReceipt=()=>{
    for(let i=0;i<8;i++) {
      const next=checkerStorage+Buffer.byteLength(canonical(result));
      need(Number.isSafeInteger(next),'DISCOVERY_RESOURCE_OVERFLOW');
      if(next===used.storageBytes)return;
      used.storageBytes=next;
    }
    need(false,'DISCOVERY_RECEIPT_SIZE');
  };
  try {
    sizeReceipt();
    if(request&&RESOURCES.some(key=>used[key]>request.resourceLimits[key])) {
      result.state='inconclusive';
      result.reasons=[...result.reasons.filter(value=>value!=='DISCOVERY_REVIEW_BUDGET_EXHAUSTED').slice(0,31),'DISCOVERY_REVIEW_BUDGET_EXHAUSTED'];
      sizeReceipt();
    }
  } catch(error) {
    result.state='inconclusive';result.reasons=[reason(error,'DISCOVERY_RECEIPT_SIZE')];
    result.resourceAccounting='lower-bound-receipt-overflow';
  }
  return result;
}

/** Configuration and checker functions come only from the installed caller. */
export async function admitDiscoveryReview(raw,installed=null) {
  let request=null;
  const started=performance.now(),used=zero(),text=typeof raw==='string'?raw:'';
  used.checking=1;used.memoryBytes=text.length<=2_000_000?Buffer.byteLength(text):text.length;
  const respond=(state,reasons,context=null)=>{
    const result=receipt(request,text,state,reasons,used,context);
    used.elapsedMs=Math.ceil(performance.now()-started);
    if(text.length>2_000_000)result.resourceAccounting='lower-bound-oversized-input';
    return {request,receipt:finalize(result,request),installedSnapshot:context?snapshotInstalled(context):null};
  };
  try { request=await inspectDiscoveryRequest(raw); }
  catch(error) {
    const unsupported=/Unsupported Discovery Lab|mode is not provisioned/.test(error.message??'');
    return respond(unsupported?'unsupported':'rejected',[reason(error,'DISCOVERY_MALFORMED')]);
  }
  if(request.resourceLimits.checking<used.checking||request.resourceLimits.memoryBytes<used.memoryBytes
    ||request.resourceLimits.elapsedMs<Math.max(1,Math.ceil(performance.now()-started))
    ||request.resourceLimits.storageBytes<RECEIPT_RESERVATION_BYTES)
    return respond('inconclusive',['DISCOVERY_REVIEW_BUDGET_EXHAUSTED']);
  if(installed===null) return respond('unprovisioned',['DISCOVERY_EXECUTOR_UNPROVISIONED']);
  try { installedContext(installed); }
  catch(error) { return respond('unprovisioned',[reason(error,'DISCOVERY_INSTALLED_CONTEXT_INVALID')]); }
  if(installed.currentRuntimeDigest!==installed.runtimeDigest)
    return respond('rejected',['DISCOVERY_RUNTIME_CHANGED'],installed);
  if(bindings.some(key=>installed.expected[key]!==request[key]))
    return respond('rejected',['DISCOVERY_STALE_BINDING'],installed);
  if(['id','branch','route'].some(key=>installed.expectedCommission[key]!==request.commission[key]))
    return respond('rejected',['DISCOVERY_COMMISSION_BINDING'],installed);
  if(!installed.stages.includes(request.stage))
    return respond('unsupported',['DISCOVERY_STAGE_NOT_ADMITTED'],installed);
  if(RESOURCES.some(key=>request.resourceLimits[key]>installed.resourceCapacity[key]))
    return respond('unprovisioned',['DISCOVERY_EXECUTOR_CAPACITY'],installed);
  return respond('admitted-local-review',[],installed);
}

/** A fresh installed semantic check is mandatory even for previously accepted input. */
export async function reviewDiscoveryRequest(raw,installed=null) {
  const started=performance.now();
  const admission=await admitDiscoveryReview(raw,installed);
  if(admission.receipt.state!=='admitted-local-review') return admission.receipt;
  const {request,installedSnapshot}=admission,used={...admission.receipt.resourceUsed,storageBytes:0},before=canonical(request);
  const installedBefore=canonical(installedSnapshot),checker=installed.inspectCampaign;
  freeze(request);
  let checked;
  try {
    need(canonical(snapshotInstalled(installed))===installedBefore,'DISCOVERY_CHECKER_CHANGED_CONTEXT');
    const remaining=Object.fromEntries(RESOURCES.map(key=>[key,Math.max(0,request.resourceLimits[key]-used[key])]));
    remaining.storageBytes=Math.max(0,remaining.storageBytes-RECEIPT_RESERVATION_BYTES);
    remaining.elapsedMs=Math.max(0,request.resourceLimits.elapsedMs-Math.ceil(performance.now()-started));
    need(remaining.checking>0&&remaining.elapsedMs>0,'DISCOVERY_REVIEW_BUDGET_EXHAUSTED');
    checked=await checker(request.payload,{request,limits:freeze(remaining)});
    checked=JSON.parse(canonical(checked));
    need(canonical(request)===before,'DISCOVERY_CHECKER_MUTATED_REQUEST');
    need(canonical(snapshotInstalled(installed))===installedBefore,'DISCOVERY_CHECKER_CHANGED_CONTEXT');
    keys(checked,['accepted','resourceUsed','reasons']);resources(checked.resourceUsed);
    need(typeof checked.accepted==='boolean'&&Array.isArray(checked.reasons)&&checked.reasons.length<=32
      &&checked.reasons.every(reason=>typeof reason==='string'&&/^[A-Z0-9_:-]{1,120}$/.test(reason)),'DISCOVERY_CHECKER_RESULT');
    for(const key of RESOURCES) {
      const next=used[key]+checked.resourceUsed[key];need(Number.isSafeInteger(next),'DISCOVERY_RESOURCE_OVERFLOW');used[key]=next;
    }
  } catch(error) {
    used.elapsedMs=Math.ceil(performance.now()-started);
    const original=JSON.parse(before);
    const failed=receipt(original,raw,'inconclusive',[reason(error,'DISCOVERY_CHECKER_FAILED')],used,installedSnapshot);
    failed.resourceAccounting='lower-bound-checker-failed';return finalize(failed,original);
  }
  used.elapsedMs=Math.max(used.elapsedMs,Math.ceil(performance.now()-started));
  const incomplete=checked.reasons.some(code=>/(?:BUDGET_EXHAUSTED|SEARCH_TRUNCATED|CHECK_INCOMPLETE)$/.test(code));
  const result=receipt(request,raw,incomplete?'inconclusive':checked.accepted?'accepted-local-review':'rejected-local-review',checked.reasons,used,installedSnapshot);
  result.resourceAccounting='reported-model-work-plus-input-and-receipt-bytes';
  return finalize(result,request);
}
