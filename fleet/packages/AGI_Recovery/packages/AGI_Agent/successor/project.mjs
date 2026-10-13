import {createRequire} from 'node:module';
import {validateReceiptBinding} from './receipt.mjs';
import {fail, keys, canonical, parseStrict, sha256} from './vendor/manager/site/assets/successor/safe.mjs';
import {inspectCapsule, freezeCandidate, runCandidate, exportCapsule, compareCandidates} from './vendor/manager/site/assets/successor/model.mjs';
import {validateImprovement} from './vendor/manager/site/assets/successor/jobs.mjs';
import {checkArtifacts} from './vendor/manager/site/assets/successor/checker.mjs';
import {compileComputerWork} from './vendor/manager/scripts/successor/adapter.mjs';
const require=createRequire(import.meta.url);
export const computer=require('./vendor/manager/scripts/economics/computer-work.cjs');
export const REQUEST='agi-fleet/successor-request/v1';

export async function inspectRequest(value) {
  const request=typeof value==='string'?parseStrict(value,6000000):value;
  keys(request,['schema','capsule','plan'],'FLEET_REQUEST_FIELDS');
  fail(request.schema===REQUEST&&typeof request.capsule==='string','FLEET_REQUEST');
  const inspected=await inspectCapsule(request.capsule), state=inspected.capsule.payload.state;
  await validateImprovement(request.plan);
  fail(request.plan.missionSha256===await sha256(state.mission),'FLEET_MISSION_CHANGED');
  fail(request.plan.candidateSha256===state.active&&state.active!==null,'FLEET_INCUMBENT_CHANGED');
  return {request,inspected,state,project:await sha256(state.mission),revision:inspected.capsule.sha256,requestSha256:await sha256(request)};
}

export async function compileRequest(value,context,now=Math.floor(Date.now()/1000)) {
  const inspected=await inspectRequest(value);
  const compiled=await compileComputerWork(inspected.request.plan,context,now);
  return {...inspected,compiled};
}

export async function validateSidecarProject(capsule,handoff,files) {
  const inspected=await inspectCapsule(capsule),state=inspected.capsule.payload.state,spec=handoff.specification;
  fail(spec.profile==='computer-work/v2','FLEET_SIDECAR_PROJECT_PROFILE');
  computer.validateComputerWork(spec);
  const plan=state.plans.find(p=>p.commitment===spec.coordination.parentSpecSha256);
  fail(plan&&plan.missionSha256===await sha256(state.mission),'FLEET_SIDECAR_PROJECT_PLAN');
  fail(plan.candidateSha256===null?state.mission.kind==='custom':state.candidates.some(c=>c.id===plan.candidateSha256),'FLEET_SIDECAR_PROJECT_INCUMBENT');
  fail(spec.title===plan.draft.fields.title.slice(0,160)&&spec.prompt===plan.goal&&spec.inputs.length===plan.immutableInputs.length,'FLEET_SIDECAR_PROJECT_SCOPE');
  for(let i=0;i<spec.inputs.length;i++){const input=spec.inputs[i],expected=plan.immutableInputs[i];fail(input.name===expected.name&&input.sha256===expected.sha256&&input.maxBytes===Buffer.byteLength(expected.content),'FLEET_SIDECAR_PROJECT_INPUT');}
  // Custom work retains format-checked historical evidence only. It cannot
  // create a locally checked candidate or inherit operating authority.
  if(state.mission.kind==='custom')return;
  const source=inspected.capsule.payload.sourceManifest;fail(source?.engineSha256,'FLEET_SOURCE_REQUIRED');
  const matches=c=>c&&files.size===c.files.length+1&&files.has('checker-results.json')&&c.files.every(f=>files.get(f.name)?.equals(Buffer.from(f.content)));
  if(matches(state.candidates.find(c=>c.id===plan.candidateSha256)))return;
  const improved=await freezeCandidate(state.mission,'improved',source.engineSha256);
  fail(matches(improved),'FLEET_SIDECAR_PROJECT_ARTIFACTS');
}

export async function checkReturnedWork(request,handoff,receipt,studioAPI) {
  const {state,inspected}=await inspectRequest(request);
  studioAPI.validateHandoff(handoff);
  fail(handoff.specification.coordination.parentSpecSha256===request.plan.commitment,'FLEET_PLAN_CHANGED');
  validateReceiptBinding(handoff,receipt,'node');
  const verdict=studioAPI.computerVerdict(handoff.specification,{safeToReview:receipt.review?.safeToReview,checks:receipt.review?.checks});
  const {files}=studioAPI.validateBundle(handoff.specification,Buffer.from(handoff.delivery));
  const source=inspected.capsule.payload.sourceManifest;
  fail(source?.engineSha256,'FLEET_SOURCE_REQUIRED');
  const proposed=await runCandidate(state,'improved',source.engineSha256);
  const delivered=proposed.candidate.files.map(expected=>{
    const actual=files.get(expected.name);fail(actual,'FLEET_MISSING_ARTIFACT');
    return {...expected,content:actual.toString('utf8')};
  });
  const checks=checkArtifacts(state.mission,'improved',delivered);
  const exact=proposed.candidate.files.every(expected=>files.get(expected.name)?.equals(Buffer.from(expected.content)));
  const accepted=verdict.verdict==='consistent'&&checks.passed&&exact;
  const before=state.candidates.find(c=>c.id===state.active);
  const result={schema:'agi-fleet/successor-checked-result/v1',project:await sha256(state.mission),requestSha256:await sha256(request),
    specificationSha256:handoff.specHash,deliverySha256:handoff.deliveryHash,reviewSha256:await sha256(receipt),
    outcome:accepted?'accepted':'rejected',checks,exactReusableMethod:exact,
    comparison:accepted?compareCandidates(before,proposed.candidate):{outcome:'regression',recommendation:'retain'},
    selected:state.active,proposed:accepted?proposed.candidate.id:null,independentController:'UNVERIFIED',
    qualification:'NOT_RUN',authority:'none',payment:'unfunded',providerParticipation:'See separate compute observations; receipt is not provider attestation',
    capsule:await exportCapsule(accepted?proposed.state:state,source)};
  return {...result,sha256:await sha256(result)};
}
