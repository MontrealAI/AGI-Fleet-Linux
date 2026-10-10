// Signer-only identity approval. This file carries no compute execution authority.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {acquireFileLease} from '../wallet-lease.mjs';
import {atomicWrite, readJSON, canonical, sha256, ensure} from '../util.mjs';

const HASH=/^[a-f0-9]{64}$/;
const LOCAL_REVIEW_ERRORS=new Set(['COMPANION_COMPUTE_POLICY_CHANGED','COMPANION_COMPUTE_APPROVAL_CHANGED']);
const APPROVAL_ERRORS=new Set(['OPERATION_IN_PROGRESS','COMPUTE_DAILY_LIMIT','COMPUTE_IMAGE_DAILY_LIMIT','COMPUTE_BUSY','COMPUTE_CLI_TIMEOUT','COMPANION_COMPUTE_APPROVAL_INVALID','COMPANION_COMPUTE_APPROVAL_CHANGED','COMPANION_COMPUTE_APPROVAL_EXPIRED','COMPANION_STATE_CONFLICT','COMPANION_STATE_INVALID','COMPANION_APPROVAL_HISTORY_FULL','COMPANION_APPROVAL_RECONCILIATION_REQUIRED','COMPANION_CANCELLED','COMPANION_BUSY','COMPANION_COOLDOWN','COMPANION_DAILY_LIMIT','COMPANION_RATE_LIMITED','COMPANION_AUTH_FAILED','COMPANION_TOKEN_REQUIRED','COMPANION_COMPUTE_CLEANUP_REQUIRED','COMPANION_COMPUTE_UNAVAILABLE','COMPANION_COMPUTE_POLICY_CHANGED','COMPANION_RESPONSE_INVALID','COMPANION_OUTPUT_LIMIT','COMPANION_ENDPOINT_DISABLED','COMPANION_UNAVAILABLE','COMPANION_DISABLED','NODE_LOCKED','STOP_BEFORE_CHANGING_SETTINGS','COMPANION_ACTIVE_WORK_IDENTITY_LOCKED','COMPANION_CLOCK_CHANGED','COMPANION_SEPARATE_COMPUTE_USER_REQUIRED','COMPANION_WORKSTATION_REQUIRED']);
export const approvalFailureCode=error=>APPROVAL_ERRORS.has(error?.code??error?.message)?(error.code??error.message):'COMPANION_UNAVAILABLE';
export function identityProjection(h){return {policyHash:h.policyHash,protocol:h.protocol,role:h.role,uid:h.uid,auth:h.auth,configuredCapabilities:[...h.configuredCapabilities].sort(),reviewerFingerprint:h.publicWeb?.reviewerFingerprint??null};}
export const identityDigest=h=>sha256(canonical(identityProjection(h)));
export const configurationDigest=c=>sha256(canonical({config:c.config,tokenHash:sha256(c.getToken()??'')}));

// Every state writer participates in this short synchronous CAS. A stale process
// cannot restore an earlier binding, allowance or audit history over a new commit.
export function persistCompanionState(c,next=c.state){
  let release;
  const marker=c.stateFile+'.approval-pending';
  try{
    release=acquireFileLease(c.stateFile+'.lease.sqlite','COMPANION_STATE_CONFLICT');
    const disk=fs.existsSync(c.stateFile)?readJSON(c.stateFile):null;
    ensure((disk?.stateRevision??0)===c.stateRevision,'COMPANION_STATE_CONFLICT');
    ensure(!fs.existsSync(marker),'COMPANION_APPROVAL_RECONCILIATION_REQUIRED');
    const saved={...next,stateRevision:c.stateRevision+1};
    const bindingChanged=(disk?.computePolicy??null)!==(saved.computePolicy??null)||(disk?.bindingRevision??0)!==(saved.bindingRevision??0)||(disk?.publicWebReviewerPublicKey??null)!==(saved.publicWebReviewerPublicKey??null);
    if(bindingChanged)atomicWrite(marker,JSON.stringify({schema:1,operationID:saved.approvalHistory?.at(-1)?.operationID??null,previousPolicyHash:disk?.computePolicy??null,proposedPolicyHash:saved.computePolicy??null,stateRevision:saved.stateRevision,previousRevision:disk?.bindingRevision??0,candidateRevision:saved.bindingRevision??0,phase:"binding-write",reviewedIdentityDigest:saved.approvalHistory?.at(-1)?.reviewedIdentityDigest??null}));
    atomicWrite(c.stateFile,JSON.stringify(saved));
    c.state=saved;c.stateRevision=saved.stateRevision;
    // The state rename and directory fsync have succeeded. Removal is only
    // housekeeping: a retained marker blocks restart pending evidence review.
    if(bindingChanged){try{fs.unlinkSync(marker);const dir=fs.openSync(path.dirname(marker),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch{c.approvalPersistenceUncertain=true;}}
  }catch(error){c.stateError=true;throw error;}finally{release?.();}
}
export function validateApprovalState(s){
  ensure(s.stateRevision===undefined||(Number.isSafeInteger(s.stateRevision)&&s.stateRevision>=0),'COMPANION_STATE_INVALID');
  ensure(s.bindingRevision===undefined||(Number.isSafeInteger(s.bindingRevision)&&s.bindingRevision>=0),'COMPANION_STATE_INVALID');
  ensure(s.dispatches===undefined||(Array.isArray(s.dispatches)&&s.dispatches.length<=1000&&s.dispatches.every(Number.isSafeInteger)),'COMPANION_STATE_INVALID');
  ensure(s.approvalHistory===undefined||(Array.isArray(s.approvalHistory)&&s.approvalHistory.length<=4096&&s.approvalHistory.every(x=>x&&/^[a-f0-9-]{36}$/.test(x.operationID??'')&&HASH.test(x.reviewedPolicyHash??'')&&HASH.test(x.reviewedIdentityDigest??'')&&(x.previousPolicyHash===null||HASH.test(x.previousPolicyHash??''))&&Number.isSafeInteger(x.revision)&&Number.isSafeInteger(x.startedAt)&&['pending','committed','failed','cancelled','interrupted'].includes(x.status)&&(x.failureCode===null||APPROVAL_ERRORS.has(x.failureCode))&&(x.previousFailureCode===null||APPROVAL_ERRORS.has(x.previousFailureCode))&&Object.keys(x).every(k=>['operationID','proposalID','reviewedPolicyHash','reviewedIdentityDigest','previousPolicyHash','revision','startedAt','status','failureCode','previousFailureCode','completedAt'].includes(k)))),'COMPANION_STATE_INVALID');
}
export function createProposal(c,h){
  const now=c.now();c.proposals??=new Map();
  for(const [id,p]of c.proposals)if(p.expiresAt<=now)c.proposals.delete(id);
  while(c.proposals.size>=16)c.proposals.delete(c.proposals.keys().next().value);
  const proposal={id:crypto.randomUUID(),revision:c.state.bindingRevision??0,expiresAt:now+600000,identityDigest:identityDigest(h)};
  c.proposals.set(proposal.id,{...proposal,policyHash:h.policyHash,previousPolicyHash:c.state.computePolicy??null,configurationDigest:configurationDigest(c)});
  c.awaitingIdentityApproval=h.policyHash!==c.state.computePolicy;
  return proposal;
}
export function approvalStatus(c){
  const now=c.now(),used=c.state.calls.filter(t=>t>now-86400000).length,error=c.state.lastError;
  let cause=c.approvalPersistenceUncertain||c.stateFailureCode==='COMPANION_APPROVAL_RECONCILIATION_REQUIRED'?'approval_reconciliation_required':c.pending||c.approvalReservation?'request_in_progress':error==='COMPANION_COMPUTE_CLEANUP_REQUIRED'?'cleanup_reconciliation_required':error==='COMPANION_AUTH_FAILED'||error==='COMPANION_TOKEN_REQUIRED'?'authentication_required':used>=c.config.maxCalls24h||['COMPUTE_DAILY_LIMIT','COMPUTE_IMAGE_DAILY_LIMIT'].includes(error)?'daily_allowance_exhausted':error==='COMPUTE_BUSY'?'request_in_progress':error==='COMPANION_RATE_LIMITED'&&c.state.nextAt>now?'provider_rate_limit':c.state.nextAt>now&&!LOCAL_REVIEW_ERRORS.has(error)?'local_pacing':c.awaitingIdentityApproval?'awaiting_identity_approval':error==='COMPANION_COMPUTE_UNAVAILABLE'||error==='COMPANION_UNAVAILABLE'?'compute_unavailable':'ready';
  const nextAt=['COMPUTE_DAILY_LIMIT','COMPUTE_IMAGE_DAILY_LIMIT'].includes(error)?null:cause==='daily_allowance_exhausted'?Math.min(...c.state.calls.filter(t=>t>now-86400000))+86400000:c.state.nextAt>now?c.state.nextAt:null;
  const history=c.state.approvalHistory??[];
  const limit=c.observedCompute?.maxRuns24h??null;
  return {cleanupCapacity:c.observedCompute?.cleanupCapacity??null,reconciliationRequired:!!c.approvalPersistenceUncertain||c.stateFailureCode==='COMPANION_APPROVAL_RECONCILIATION_REQUIRED',bindingRevision:c.state.bindingRevision??0,approval:{active:c.approvalReservation??null,last:history.at(-1)??null,history:structuredClone(history),awaitingApproval:!!c.awaitingIdentityApproval},pacing:{cause,nextAttemptAt:nextAt,remainingMs:nextAt===null?0:Math.max(0,nextAt-now),source:['COMPUTE_DAILY_LIMIT','COMPUTE_IMAGE_DAILY_LIMIT','COMPUTE_BUSY','COMPUTE_CLI_TIMEOUT'].includes(error)?'compute':'signer',localRetryAt:c.state.nextAt>now?c.state.nextAt:null},usage:{attemptedRequests24h:null,reservedSlots24h:used,dispatchedRequests24h:(c.state.dispatches??[]).filter(t=>t>now-86400000).length,actualProviderCalls:null,toolRuns:null,images:null,billableUsage:null,computeReservedRuns24h:c.observedCompute?.runs24h??null,computeReservedImages24h:c.observedCompute?.images24h??null},limits:{configuredSignerCalls24h:c.config.maxCalls24h,computeRuns24h:limit,computeImages24h:c.observedCompute?.maxImages24h??null,effectiveCalls24h:c.config.mode==='bounded'?c.config.maxCalls24h:limit===null?null:Math.min(c.config.maxCalls24h,limit)},automaticBriefs:{enabled:c.config.autoBrief,suspended:!c.automaticReady||!!c.awaitingIdentityApproval||!!c.approvalReservation,reason:!c.automaticReady?'commissioning_session':c.awaitingIdentityApproval?'identity_approval':c.approvalReservation?'explicit_approval':null}};
}
export function assertApprovalCurrent(c,context,h){
  ensure(context.generation===c.generation&&!context.cancelled,'COMPANION_CANCELLED');
  ensure(context.proposal.expiresAt>c.now(),'COMPANION_COMPUTE_APPROVAL_EXPIRED');
  ensure(context.proposal.revision===(c.state.bindingRevision??0)&&context.proposal.previousPolicyHash===(c.state.computePolicy??null)&&context.proposal.configurationDigest===configurationDigest(c),'COMPANION_COMPUTE_APPROVAL_CHANGED');
  ensure(context.proposal.identityDigest===identityDigest(h),'COMPANION_COMPUTE_APPROVAL_CHANGED');
  context.validateCommit?.();
}
export function completeApprovalState(state,context,now){
  const history=state.approvalHistory.map(x=>x.operationID===context.operationID?{...x,status:'committed',completedAt:now,failureCode:null}:x);
  return {...state,approvalHistory:history,bindingRevision:(state.bindingRevision??0)+1};
}
export async function approveReviewedIdentity(c,input,{validateCommit=()=>{}}={}){
  ensure(input&&Object.keys(input).every(k=>['policyHash','proposalID','revision','acknowledge'].includes(k))&&input.acknowledge===true&&HASH.test(input.policyHash??'')&&typeof input.proposalID==='string'&&Number.isSafeInteger(input.revision),'COMPANION_COMPUTE_APPROVAL_INVALID');
  ensure(!c.stateError,'COMPANION_STATE_INVALID');
  ensure(!c.approvalReservation&&!c.pending,'COMPANION_BUSY');
  const proposal=c.proposals?.get(input.proposalID);
  ensure(proposal&&proposal.policyHash===input.policyHash&&proposal.revision===input.revision,'COMPANION_COMPUTE_APPROVAL_INVALID');
  ensure(proposal.expiresAt>c.now(),'COMPANION_COMPUTE_APPROVAL_EXPIRED');
  ensure(proposal.revision===(c.state.bindingRevision??0)&&proposal.previousPolicyHash===(c.state.computePolicy??null)&&proposal.configurationDigest===configurationDigest(c),'COMPANION_COMPUTE_APPROVAL_CHANGED');
  ensure((c.state.approvalHistory??[]).length<4096,'COMPANION_APPROVAL_HISTORY_FULL');
  const operationID=crypto.randomUUID(),context={operationID,proposal,generation:c.generation,validateCommit};
  c.approvalReservation=operationID;c.automaticReady=false;
  try{
    const record={operationID,proposalID:proposal.id,reviewedPolicyHash:proposal.policyHash,reviewedIdentityDigest:proposal.identityDigest,previousPolicyHash:proposal.previousPolicyHash,revision:proposal.revision,startedAt:c.now(),status:'pending',failureCode:null,previousFailureCode:APPROVAL_ERRORS.has(c.state.lastError)?c.state.lastError:null};
    const next={...c.state,approvalHistory:[...(c.state.approvalHistory??[]),record]};
    // A proved pre-dispatch identity rejection is not a provider rate limit.
    // Retain any actual dispatch pacing; never clear a provider 429 or daily cap.
    if(LOCAL_REVIEW_ERRORS.has(next.lastError))next.nextAt=Math.max(c.now(),(next.dispatches?.at(-1)??0)+30000);
    c.persist(next);
    const result=await c.request('test',{purpose:'approve-compute-identity'},{cacheMs:0,authorizePolicyHash:input.policyHash,approvalContext:context});
    c.proposals.delete(proposal.id);c.awaitingIdentityApproval=false;c.automaticReady=true;
    return {...result,policyHash:c.state.computePolicy,operationID,approvalStatus:'committed',bindingRevision:c.state.bindingRevision,persisted:true,reconciliationRequired:!!c.approvalPersistenceUncertain};
  }catch(error){
    if(!c.stateError){const now=c.now(),code=approvalFailureCode(error);c.persist({...c.state,approvalHistory:(c.state.approvalHistory??[]).map(x=>x.operationID===operationID&&x.status==='pending'?{...x,status:code==='COMPANION_CANCELLED'?'cancelled':'failed',completedAt:now,failureCode:code}:x)});}
    throw error;
  }finally{if(c.approvalReservation===operationID)c.approvalReservation=null;}
}
