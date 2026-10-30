import {need,keys,uuid,digest,canonical,parseStrict} from '../contracts.mjs';
import {STORAGE_LIMITS,encodeOutcome} from './capacity.mjs';

// Reconciliation records what can be established; it never turns an uncertain
// attempt into successful work and never releases its budget reservation.
function record(runtime, input, principal) {
  runtime.scope(principal,'reconciliation');
  keys(input,['run']);
  const row=runtime.store.db.prepare('SELECT * FROM runs WHERE id=?').get(uuid(input.run));
  need(row,'RUN_UNKNOWN');
  const value=parseStrict(row.value),result=row.result?parseStrict(row.result):null;
  return {row,value,result,commitment:digest({id:row.id,actor:row.actor,grant:row.grant_id,state:row.state,value,result})};
}

function proof(runtime, value, result) {
  const computer=value.admission?.binding?.computer,computerObservation=result?.observation;
  if(value.spendUSDC==='0'&&value.authority==='none'&&value.inference==='scripted-zero-cost'&&/^[a-f0-9]{64}$/.test(computer?.runtimeIdentity||'')&&computer?.evidenceClass==='NATIVE_ALPHA_SCRIPTED_REHEARSAL'&&
    value.host?.alphaComputerRuntimeIdentity===computer.runtimeIdentity&&computerObservation?.runtimeIdentity===computer.runtimeIdentity&&
    computerObservation.backend==='native-alpha-computer-scripted/v1'&&computerObservation.evidenceClass==='NATIVE_ALPHA_SCRIPTED_REHEARSAL'&&
    computerObservation.processGroupGone===true&&computerObservation.containerClosed===true&&computerObservation.providerCalls===0)
    return {eligible:true,kind:'recorded-scripted-computer-closure',observationSha256:digest(computerObservation),runtimeIdentity:computer.runtimeIdentity,
      externalEffects:'No live model requests or transaction authority; retained public read and fixed browser actions remain historical.'};
  // A future provider/signer adapter must implement its own external-action
  // reconciliation. The offline rule cannot be borrowed by another backend.
  if(value.host?.backend!=='linux-bwrap-offline/v1'||value.host.authority!=='bounded-offline-only'||value.inference!=='none'||value.spendUSDC!=='0')
    return {eligible:false,reason:'EXTERNAL_RECONCILIATION_REQUIRED'};
  const observation=result?.observation;
  if(observation?.backend==='linux-bwrap-offline/v1'&&observation.launchAttempted===false&&
    observation.reason==='EXECUTION_HOST_CHANGED'&&result.error==='EXECUTION_HOST_CHANGED'&&observation.network==='none'&&observation.providerCalls===0)
    return {eligible:true,kind:'recorded-launch-refusal',observationSha256:digest(observation),externalEffects:'none; task launcher was not invoked'};
  if(observation?.backend==='linux-bwrap-offline/v1'&&observation.processGroupGone===true&&observation.privateNamespacesEnded===true&&observation.network==='none'&&observation.providerCalls===0)
    return {eligible:true,kind:'recorded-sandbox-closure',observationSha256:digest(observation),externalEffects:'none; offline backend only'};
  // Alpha uses its own fixed native transport. A synthetic grant/host fixture,
  // asserted EOF, missing phase or mismatched runtime cannot prove closure.
  const alpha=value.admission?.binding?.alpha,phases=observation?.phases;
  if(alpha?.evidenceClass==='REVIEWED_NATIVE_PACKAGE'&&/^[a-f0-9]{64}$/.test(alpha.runtimeIdentity||'')&&
    value.host.alphaRuntimeIdentity===alpha.runtimeIdentity&&observation?.runtimeIdentity===alpha.runtimeIdentity&&
    observation.backend==='linux-bwrap-alpha/v1'&&observation.evidenceClass==='NATIVE_FIXED_ALPHA_IPC'&&
    observation.processGroupGone===true&&observation.privateNamespacesEnded===true&&observation.network==='none'&&observation.providerCalls===0&&
    Array.isArray(phases)&&phases.length>=1&&phases.length<=2&&phases.every((phase,index)=>
      phase?.backend==='linux-bwrap-alpha/v1'&&phase.evidenceClass==='NATIVE_FIXED_ALPHA_IPC'&&phase.phase===(index===0?'validate':'work')&&
      phase.processGroupGone===true&&phase.privateNamespacesEnded===true&&phase.namespaceLifetimeEOF===true&&phase.network==='none'&&phase.providerCalls===0&&
      Number.isSafeInteger(phase.status?.childPid)&&phase.status.childPid>0&&
      ['pid','net','mnt','ipc','uts'].every(name=>Number.isSafeInteger(phase.status?.namespaces?.[name])&&phase.status.namespaces[name]>0)))
    return {eligible:true,kind:'recorded-alpha-sandbox-closure',observationSha256:digest(observation),runtimeIdentity:alpha.runtimeIdentity,externalEffects:'none; fixed offline Alpha backend only'};
  const current=runtime.backend.inspect();
  if(current.backend==='linux-bwrap-offline/v1'&&typeof current.bootId==='string'&&typeof value.host.bootId==='string'&&current.bootId!==value.host.bootId)
    return {eligible:true,kind:'observed-host-reboot',previousBoot:value.host.bootId,currentBoot:current.bootId,externalEffects:'none; offline backend only'};
  return {eligible:false,reason:'POSITIVE_CLEANUP_EVIDENCE_REQUIRED'};
}

export function inspectReconciliation(runtime,input,principal) {
  const {row,value,result,commitment}=record(runtime,input,principal);
  need(row.state==='uncertain','RUN_NOT_UNCERTAIN');
  need(!runtime.active.has(row.id),'CLEANUP_PENDING');
  return {schema:'agi-fleet/local-reconciliation-plan/v1',run:row.id,actor:row.actor,commitment,
    ...proof(runtime,value,result),disposition:'closed-without-success',budget:'reservation-retained',
    authority:'none',confirmationRequired:true,replayAllowed:false};
}

export function reconcile(runtime,input,principal) {
  runtime.scope(principal,'reconcile');
  keys(input,['run','commitment','confirm']);
  need(input.confirm===true,'CONFIRM_REQUIRED');
  return runtime.store.transaction(()=>{
    const plan=inspectReconciliation(runtime,{run:input.run},principal);
    need(plan.commitment===input.commitment,'RECONCILIATION_CHANGED');
    need(plan.eligible,plan.reason);
    const row=runtime.store.db.prepare('SELECT result FROM runs WHERE id=?').get(input.run);
    const result=row.result?parseStrict(row.result):null;
    const receipt={schema:'agi-fleet/local-reconciliation/v1',run:input.run,priorCommitment:plan.commitment,
      recordedAt:runtime.now(),proof:plan,priorOutcome:result,disposition:'closed-without-success',authority:'none',replayAllowed:false};
    runtime.store.db.prepare("UPDATE runs SET state='reconciled',result=? WHERE id=? AND state='uncertain'").run(encodeOutcome(receipt,STORAGE_LIMITS.runReservation),input.run);
    runtime.store.event('run-reconciled',{run:input.run,priorCommitment:plan.commitment,receiptSha256:digest(receipt)});
    // STOP, revocation and existing reservations deliberately remain durable.
    return {run:input.run,state:'reconciled',receipt,next:'Inspect all other uncertain work, then explicitly resume and reactivate.'};
  });
}
