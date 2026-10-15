import {VERSION,canonical,digest,packagePolicy,need} from '../contracts.mjs';
import {validateTaskInput} from '../worker.mjs';
import {publicOnly} from '../../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';
import {validateAlphaInput} from '../alpha/contract.mjs';
import {ALPHA_PACKAGE_HELP,ALPHA_SOURCE_COMMIT,inspectAlphaPackage} from '../alpha/package.mjs';

export const OFFLINE_LIMITS=Object.freeze({wallMs:15000,cpuSeconds:10,heapMiB:128,outputBytes:2000000,modelCalls:0,spendUSDC:'0',actions:1});
const HELP={
  ALPHA_PACKAGE_UNPROVISIONED:ALPHA_PACKAGE_HELP,
  ALPHA_RUNTIME_REBIND_REQUIRED:'The pinned Alpha installation or its runtime identity changed. Rerun doctor, explicitly reactivate the actor and request a new grant.',
  ALPHA_PACKAGE_MISSING:ALPHA_PACKAGE_HELP,
  ALPHA_ADAPTER_REQUALIFICATION_REQUIRED:ALPHA_PACKAGE_HELP,
  ALPHA_PACKAGE_REVIEW_REQUIRED:ALPHA_PACKAGE_HELP,
  ALPHA_TRUST_LOCK_INVALID:ALPHA_PACKAGE_HELP,
  ALPHA_TRUST_LOCK_MISSING:ALPHA_PACKAGE_HELP,
  ALPHA_DEPENDENCY_LOCK_CHANGED:ALPHA_PACKAGE_HELP,
  ALPHA_OUTPUT_BUDGET_EXCEEDED:'This mission exceeds Fleet’s conservative output budget before execution. Reduce supplied text, source metadata, schedule operations, allocation population or forecast holdout/horizon. Fleet supports a stricter subset than Alpha; no grant or work budget is reserved.',
  ALPHA_WORK_KIND_DENIED:'Alpha accepts only supplied-input allocation, schedule, forecast and research. Code, model and network work are not allowed.',
  ALPHA_MARKET_DENIED:'This adapter accepts the explicit agijobsv0-jobregistry-v2 work-spec namespace. Manager USDC and Jobs v0 AGIALPHA remain separate; this action grants neither settlement authority.',
  ACTIVATION_REQUIRED:'Activate this actor on the current supported Linux host before preparing work.',
  PLATFORM_NOT_QUALIFIED:'Native Local Skills execution is implemented only on Linux x64/ARM64; Mac local mode still needs its own implementation.',
  NODE_VERSION_UNSUPPORTED:'Use Node >=24.19.0 <25, then rerun the host check.',
  SANDBOX_PREREQUISITE_MISSING:'Install the documented trusted bubblewrap/prlimit prerequisites; do not fall back to a host shell.',
  SANDBOX_NAMESPACE_DENIED:'This host does not permit the required isolation. Use a compatible engineering host without weakening the sandbox.',
  WORKSPACE_NOT_QUALIFIED:'Browser and desktop workspaces are not implemented in this Local Skills preview.',
  ROLE_ACTION_DENIED:'Choose an action declared by this role package. Policy inspection does not execute or sign protocol actions.',
  RUNTIME_UNAVAILABLE:'Custom missions have no execution adapter. Use the bounded analyst or website format or wait for an implemented adapter.',
  KNOWN_REVIEW_CONFLICT:'This reviewer has known common control with the producer. It cannot satisfy independent review.',
  INDEPENDENT_REVIEW_NOT_QUALIFIED:'Verified independent eligibility and placement are not implemented; local Node checks remain internal.',
  INTAKE_PAUSED:'Resume intake explicitly before preparing or dispatching more work.',
  STOP_RECONCILIATION_REQUIRED:'Keep STOP in place, reconcile outstanding uncertainty, then explicitly reactivate.',
  RUNTIME_REBIND_REQUIRED:'The source changed. Restart and explicitly reactivate; old grants must not inherit new code.',
  PACKAGE_REBIND_REQUIRED:'The role descriptor changed. Explicitly reactivate and prepare a fresh grant.',
  HOST_REBIND_REQUIRED:'The machine/session or executable identity changed. Explicitly reactivate on the checked host.',
  OFFLINE_CONFIGURATION_REQUIRED:'This adapter supports no provider/model calls, network access, browser or desktop. New routes require implementation and their own admission.',
};
const OUTSIDE=new Set(['PLATFORM_NOT_QUALIFIED','WORKSPACE_NOT_QUALIFIED','ROLE_ACTION_DENIED','RUNTIME_UNAVAILABLE','KNOWN_REVIEW_CONFLICT','OFFLINE_CONFIGURATION_REQUIRED']);
function problem(code,taskFormat=false){return {code,kind:OUTSIDE.has(code)||taskFormat?'OUTSIDE_SCOPE':'MISSING_PREREQUISITE',help:HELP[code]||'Correct the exact task format or host prerequisite, then request a fresh admission check.'};}

// Derive from the existing role package and host descriptor; no second action registry.
// Qualification observations never come from a task, imported capsule or a green fixture.
export function evaluateAdmission({actor,task,host,source,currentSource,hostId,at,paused,stopped,nativeBackend=false}) {
  const pkg=packagePolicy(actor.role),issues=[];
  let valid=true,alpha=null;
  try {
    validateTaskInput(actor.role,task);
    if(task.action==='alpha-run')alpha=validateAlphaInput(task.input);
    const publicView=structuredClone(task);
    if(task.action==='protocol-inspect'){
      need(/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(publicView.input?.config?.gatewayURL),'GATEWAY_LOOPBACK_REQUIRED');
      delete publicView.input.config.gatewayURL;
    }
    publicOnly(canonical(publicView));
    if(task.input.mission?.kind==='custom')need(false,'RUNTIME_UNAVAILABLE');
    if(actor.role==='node'&&task.review==='independent'){
      need(task.sourceActor!==actor.id&&task.sourceController!==actor.controller,'KNOWN_REVIEW_CONFLICT');
      need(false,'INDEPENDENT_REVIEW_NOT_QUALIFIED');
    }
  }catch(e){valid=false;const code=e.code||e.message;issues.push(problem(code,code!=='INDEPENDENT_REVIEW_NOT_QUALIFIED'));}
  if(valid&&alpha){
    // A synthetic backend is an internal test seam, never a native trust root.
    // Native admission independently checks the fixed installation. An asserted
    // positive host descriptor (including a replaced inspect method) is not trust.
    if(nativeBackend){
      const installed=inspectAlphaPackage();
      if(!installed.supported)issues.push(problem(installed.code));
      else if(host.alphaRun?.supported!==true||host.alphaRun.runtimeIdentity!==installed.runtimeIdentity||actor.host?.alphaRuntimeIdentity!==installed.runtimeIdentity)issues.push(problem('ALPHA_RUNTIME_REBIND_REQUIRED'));
    }else if(host.alphaRun?.supported!==true)issues.push(problem(host.alphaRun?.code||'ALPHA_PACKAGE_UNPROVISIONED'));
    else if(host.alphaRun?.sourceCommit!==ALPHA_SOURCE_COMMIT||!/^synthetic-/.test(host.alphaRun?.packageSha256||''))issues.push(problem('ALPHA_PACKAGE_REVIEW_REQUIRED'));
  }
  if(!host.supported)issues.push(problem(host.code||'SANDBOX_UNAVAILABLE'));
  if((host.platform||process.platform)!=='linux'||!['x64','arm64'].includes(host.arch||process.arch))issues.push(problem('PLATFORM_NOT_QUALIFIED'));
  if((host.inference&&host.inference!=='none')||(host.network&&host.network!=='none')||(host.browser&&host.browser!=='BLOCKED')||(host.desktop&&host.desktop!=='BLOCKED'))issues.push(problem('OFFLINE_CONFIGURATION_REQUIRED'));
  if(stopped||actor.stopped)issues.push(problem('STOP_RECONCILIATION_REQUIRED'));
  if(paused)issues.push(problem('INTAKE_PAUSED'));
  if(!actor.active||actor.host?.host!==hostId)issues.push(problem('ACTIVATION_REQUIRED'));
  else {
    if(pkg.sha256!==actor.packageSha256||pkg.registry!==actor.registrySha256)issues.push(problem('PACKAGE_REBIND_REQUIRED'));
    if(source!==currentSource||actor.host.sourceSha256!==currentSource)issues.push(problem('RUNTIME_REBIND_REQUIRED'));
    if(host.identity!==actor.host.identity)issues.push(problem('HOST_REBIND_REQUIRED'));
  }
  const family=valid?(alpha?.kind||task.input.mission?.kind||task.action):null;
  const binding={mode:'local-skills',platform:host.platform||process.platform,arch:host.arch||process.arch,machine:hostId,
    session:host.bootId||null,backend:host.backend||null,hostIdentity:host.identity||null,runtime:VERSION,sourceSha256:currentSource,
    node:process.versions.node,packageSha256:pkg.sha256,registrySha256:pkg.registry,actor:actor.id,role:actor.role,controller:actor.controller,generation:actor.generation,
    provider:{route:'none',model:null,authentication:'not-required',modelCalls:0},
    tools:{actions:pkg.policy.actions,capabilities:pkg.policy.capabilities,network:host.network||'none',inference:host.inference||'none',files:host.files||'per-run input only',browser:host.browser||'BLOCKED',desktop:host.desktop||'BLOCKED'},
    taskFamily:family,taskSha256:digest(task),permissions:'bounded-offline-only',review:{kind:task?.review??null,sourceActor:task?.sourceActor??null,sourceController:task?.sourceController??null,independent:false},
    ...(alpha?{alpha:{sourceCommit:ALPHA_SOURCE_COMMIT,market:alpha.market,specSha256:alpha.specHash,normalizedMissionSemanticSha256:alpha.normalizedMissionSemanticSha256,outputBudget:alpha.budget,packageSha256:host.alphaRun?.packageSha256??null,trustLockSha256:host.alphaRun?.trustLockSha256??null,runtimeIdentity:host.alphaRun?.runtimeIdentity??null,adapterSha256:host.alphaRun?.adapterSha256??null,treeSha256:host.alphaRun?.treeSha256??null,evidenceClass:nativeBackend?(issues.length?'NATIVE_ADMISSION_BLOCKED':'REVIEWED_NATIVE_PACKAGE'):'SYNTHETIC_OR_UNVERIFIED'}}:{})};
  const status=issues.some(i=>i.kind==='OUTSIDE_SCOPE')?'OUTSIDE_SCOPE':issues.length?'MISSING_PREREQUISITE':'SUPPORTABLE';
  return {schema:'agi-fleet/local-admission/v1',status,checkedAt:at,expiresAt:at+300000,recheck:'authorization and immediately before durable dispatch reservation',issues,
    binding,bindingSha256:digest(binding),
    qualification:{implemented:'BOUNDED_OFFLINE_ONLY',componentTested:'REQUIRES_EXACT_SOURCE_EVIDENCE',nativeTested:'REQUIRES_EXACT_SOURCE_EVIDENCE',
      hostProbe:host.supported?(nativeBackend?'NATIVE_HOST_PROBE_PASS':'SYNTHETIC_OR_UNVERIFIED_PROBE'):'BLOCKED',
      liveObserved:'NOT_RUN',operationallyQualified:false,independentlyReviewed:'NOT_VERIFIED',commerciallyMeasured:'NOT_RUN',productionQualified:false},
    acceptedContract:status==='SUPPORTABLE'?{taskSha256:digest(task),inputs:'exact supplied task bytes; public nonpersonal data only',rights:task.input.mission?.rights||'caller must hold rights; not verified by byte inspection',
      requestedResult:task.input.mission?.purpose||task.action,operation:task.action,taskFamily:family,
      deliverables:alpha?['alpha-result.json','alpha-spec-validation.json']:family==='analyst'?['report.html','result.json','method.json']:family==='website'?['index.html','method.json']:task.action==='successor-check'?['checker receipt']:task.action==='evidence-inspect'?['evidence-report.json']:['protocol-inspection.json'],
      checks:alpha?'exact spec, normalized mission and result hashes; Alpha self-check only; no independent review or settlement authority':task.action==='successor-run'||task.action==='successor-check'?'fixed deterministic artifact checker; descriptive purpose and business acceptance are not evaluated':task.action==='evidence-inspect'?'byte hashes only; no correctness or authorship claim':'policy on supplied snapshot; no chain freshness or transaction claim',
      authority:'bounded-offline-only; no signing or settlement',limits:OFFLINE_LIMITS,deadline:at+300000,recovery:'one-use grant; failed/uncertain reservations remain consumed; explicit STOP reconciliation; no restored authority'}:null};
}

export function requireAdmission(report,previous=null) {
  if(report.status!=='SUPPORTABLE'){
    const code=report.issues[0]?.code||'ADMISSION_BLOCKED';throw Object.assign(new Error(code),{code,admission:report});
  }
  need(!previous||previous.bindingSha256===report.bindingSha256,'CAPABILITY_DRIFT_REAUTHORIZE');
  return report;
}
