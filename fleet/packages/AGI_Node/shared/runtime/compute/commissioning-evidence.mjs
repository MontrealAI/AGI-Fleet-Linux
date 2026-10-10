import {canonical,sha256,ensure} from '../src/util.mjs';
import {computerVerdict} from '../src/artifacts.mjs';
import {verifyPlan,verifyFixtureDelivery,corruptFixtureDelivery} from './commissioning-fixture.mjs';
import {verifyGatewayTrace} from './gateway-tool-trace.mjs';
import {verifyLocalControls} from './controlled-controls.mjs';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const image=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v);
const same=(a,b)=>canonical(a)===canonical(b);
export function verifyExecCapture(session,request,expectedFiles=[]){
 ensure(session&&session.status==='CAPTURED'&&session.source==='docker-engine-observer/v1'&&session.requestID===request.id&&session.agent===request.agent&&session.sessionKey===`agent:${request.agent}:agi-work-${request.id}`,'COMMISSIONING_SESSION');
 const inspection=session.inspect,container=inspection?.Id;
 ensure(hash(container)&&image(inspection.Image)&&inspection.Image===session.expectedImageID&&Number.isSafeInteger(session.startedAt)&&Number.isSafeInteger(session.finishedAt)&&session.startedAt<=session.finishedAt,'COMMISSIONING_CONTAINER');
 ensure(inspection.HostConfig?.NetworkMode==='none'&&inspection.HostConfig?.Privileged===false&&inspection.HostConfig?.ReadonlyRootfs===true,'COMMISSIONING_ISOLATION');
 ensure(session.explain?.agentId===request.agent&&session.explain?.sandbox?.sessionIsSandboxed===true&&session.explain.sandbox.scope==='session'&&session.explain.sandbox.backend==='docker'&&session.explain.sandbox.workspaceAccess==='none','COMMISSIONING_SANDBOX_EXPLAIN');
 ensure(same(session.explainArguments,['sandbox','explain','--agent',request.agent,'--session',session.sessionKey,'--json']),'COMMISSIONING_SESSION_ATTRIBUTION');
 const workspace=session.explain.sandbox.workspaceSHA256;
 ensure(hash(workspace)&&inspection.Mounts?.some(m=>m.sourceSHA256===workspace&&m.Destination==='/workspace'&&m.RW===true),'COMMISSIONING_WORKSPACE_ATTRIBUTION');
 ensure(Array.isArray(session.beforeContainerIDs)&&!session.beforeContainerIDs.includes(container)&&Array.isArray(session.afterContainerIDs)&&!session.afterContainerIDs.includes(container),'COMMISSIONING_RECREATION');
 ensure(Array.isArray(session.unrelatedBefore)&&same([...session.unrelatedBefore].sort(),[...(session.unrelatedAfter??[])].sort()),'COMMISSIONING_UNRELATED_WORK');
 ensure(Array.isArray(session.events)&&session.events.length<=2000,'COMMISSIONING_TOOL_EVENTS_REQUIRED');
 // Legacy Engine events have second precision. The observer requests the stream
 // from startedAt and requires a fresh container, so use that second's lower bound.
 const eventTime=e=>Number.isSafeInteger(e.timeMS)?e.timeMS:e.time*1000;
 const events=session.events.filter(e=>e.Type==='container'&&e.Actor?.ID===container&&Number.isSafeInteger(e.time)&&eventTime(e)>=(Number.isSafeInteger(e.timeMS)?session.startedAt:Math.floor(session.startedAt/1000)*1000)&&eventTime(e)<=(Number.isSafeInteger(e.timeMS)?session.finishedAt:Math.floor(session.finishedAt/1000)*1000));
 const success=events.some((e,i)=>{if(e.Action!=='exec_create'||!hash(e.Actor.Attributes?.execID))return false;const execID=e.Actor.Attributes.execID;return events.some((s,j)=>j>i&&s.Action==='exec_start'&&s.Actor.Attributes?.execID===execID&&eventTime(s)>=eventTime(e)&&events.some((d,k)=>k>j&&d.Action==='exec_die'&&d.Actor.Attributes?.execID===execID&&d.Actor.Attributes?.exitCode==='0'&&eventTime(d)>=eventTime(s)));});
 ensure(success,'COMMISSIONING_ACTUAL_EXEC_REQUIRED');
 for(const f of expectedFiles){const observed=session.artifacts?.find(a=>a.name===f.name);ensure(observed&&observed.readMethod==='docker-cp'&&observed.containerID===container&&observed.path==='/workspace/deliverables/'+f.name&&observed.sha256===f.sha256&&observed.bytes===f.bytes,'COMMISSIONING_CONTAINER_ARTIFACT');}
 return {containerID:container,imageID:inspection.Image,requestID:request.id,eventsSHA256:sha256(canonical(session.events)),inspectionSHA256:sha256(canonical(inspection)),proofScope:'sandbox-process-execution',modelToolAttribution:false};
}
export function verifyComputeJournal(record,request){
 ensure(record?.schema===1&&Array.isArray(record.requests)&&Array.isArray(record.calls),'COMMISSIONING_JOURNAL');
 const hits=record.requests.filter(r=>r.id===request.id);
 ensure(hits.length===1&&hits[0].kind===request.kind&&hits[0].status==='complete'&&record.calls.includes(hits[0].at),'COMMISSIONING_CHARGED_REQUEST');
 return {requestID:request.id,kind:request.kind,chargedAt:hits[0].at};
}
export function verifyInteractiveCapture(capability,plan,evidence){
 ensure(['browser','desktop'].includes(capability),'COMMISSIONING_CAPABILITY');
 ensure(evidence?.source==='controlled-fixture-observer/v1'&&evidence.runID===plan.runID&&evidence.capability===capability,'COMMISSIONING_INTERACTIVE_SOURCE');
 const challenge=plan.privateOracle[capability+'Challenge'];
 ensure(evidence.fixtureSHA256===sha256(evidence.fixtureBytes)&&!evidence.prompt.includes(challenge)&&evidence.fixtureBytes.includes(challenge),'COMMISSIONING_UNPREDICTABLE_FIXTURE');
 ensure(evidence.observedValue===challenge&&evidence.effect?.value===challenge&&evidence.effect?.action==='submit'&&evidence.effect?.requestID===evidence.requestID,'COMMISSIONING_INTERACTIVE_EFFECT');
 ensure(Array.isArray(evidence.toolEvents)&&evidence.toolEvents.length>0&&evidence.toolEvents.every(e=>e.requestID===evidence.requestID&&e.source==='observer'),'COMMISSIONING_INTERACTIVE_EVENTS');
 if(capability==='browser')ensure(evidence.toolEvents.some(e=>e.tool==='browser'&&e.action==='navigate'&&e.target===evidence.fixtureURL)&&evidence.toolEvents.some(e=>e.tool==='browser'&&e.action==='click')&&hash(evidence.domSHA256)&&evidence.domSHA256===sha256(evidence.domBytes),'COMMISSIONING_BROWSER_PROOF');
 else ensure(evidence.toolEvents.some(e=>e.tool==='agi-desktop'&&e.action==='type')&&evidence.toolEvents.some(e=>e.tool==='agi-desktop'&&e.action==='click')&&image(evidence.imageID)&&hash(evidence.screenshotSHA256)&&evidence.screenshotSHA256===sha256(Buffer.from(evidence.screenshotPNG,'base64')),'COMMISSIONING_DESKTOP_PROOF');
 return {capability,fixtureSHA256:evidence.fixtureSHA256,independentThirdParty:false};
}
export function verifyCommissioningCapture(plan,capture=null,{now=Date.now(),localControls=null}={}){
 verifyPlan(plan);const gates=[];
 const add=(id,status,code,detail)=>gates.push({id,status,code,detail});
 const check=(id,fn)=>{try{add(id,'PASS','VERIFIED_CAPTURE',fn());}catch(e){add(id,'FAIL',String(e.message).replace(/[^A-Z0-9_: ]/g,'').slice(0,140));}};
 if(!capture){for(const id of ['normal-pipeline','artifact-reconciliation','exec-creator','exec-reviewer','negative-review'])add(id,'NOT_TESTED','CAPTURE_REQUIRED');}
 else if(capture.schema!=='agi-commissioning-capture/v1'||capture.runID!==plan.runID||capture.releaseSHA256!==plan.releaseSHA256)add('capture','FAIL','CAPTURE_SCOPE');
 else {
  check('normal-pipeline',()=>{
   ensure(capture.transport?.source==='agent-companion/v1'&&capture.transport.requests?.length===3,'COMMISSIONING_NORMAL_PIPELINE');
   const names=['creator','reviewer','negativeReviewer'];
   for(const [i,name]of names.entries()){const request=capture.requests?.[name],transport=capture.transport.requests[i];ensure(id(request?.id)&&request.id===transport.id&&request.kind===(i?'computer-review':'generate')&&transport.status===200&&request.agent===(i?'agi-reviewer':'agi-creator'),'COMMISSIONING_REQUEST_SCOPE');verifyComputeJournal(capture.computeJournal,request);}
   ensure(new Set(names.map(n=>capture.requests[n].id)).size===3,'COMMISSIONING_DUPLICATE_REQUEST');
   ensure(capture.policyBefore===capture.policyAfter&&hash(capture.policyBefore),'COMMISSIONING_POLICY_DRIFT');
   ensure(capture.startedAt>=plan.createdAt&&capture.finishedAt>=capture.startedAt&&capture.finishedAt<=plan.expiresAt&&capture.finishedAt<=now,'COMMISSIONING_CAPTURE_TIME');
   return {requests:3,policySHA256:capture.policyBefore,dependencyMode:capture.dependencyMode??'unverified'};
  });
  check('artifact-reconciliation',()=>verifyFixtureDelivery(plan,capture.delivery));
  const files=(()=>{try{return verifyFixtureDelivery(plan,capture.delivery).files;}catch{return [];}})();
  for(const name of ['creator','reviewer','negativeReviewer']){if(!capture.sessions?.[name])add('exec-'+name,'BLOCKED','AUTHORITATIVE_TRACE_ADAPTER_REQUIRED');else if(capture.sessions[name].status==='BLOCKED')add('exec-'+name,'BLOCKED',capture.sessions[name].code??'OBSERVER_UNAVAILABLE');else check('exec-'+name,()=>verifyExecCapture(capture.sessions[name],capture.requests?.[name],name==='creator'?files:[]));}
  check('positive-review',()=>{ensure(computerVerdict(plan.specification,capture.review).verdict==='consistent','COMMISSIONING_VALID_RESULT_REJECTED');return {thirdPartyIndependent:false};});
  check('negative-review',()=>{ensure(capture.negativeDelivery===corruptFixtureDelivery(plan,capture.delivery),'COMMISSIONING_NEGATIVE_CONTROL');ensure(computerVerdict(plan.specification,capture.negativeReview).verdict==='concern'&&capture.negativeReview.checks.some(c=>c.id==='totals'&&c.status==='fail'),'COMMISSIONING_BAD_RESULT_ACCEPTED');return {deliberatelyIncorrectDeliveryRejected:true};});
 }
 for(const capability of ['browser','desktop']){if(!capture?.[capability])add(capability,'NOT_TESTED','DISTINCT_CONTROLLED_FIXTURE_REQUIRED');else check(capability,()=>verifyInteractiveCapture(capability,plan,capture[capability]));}
 for(const name of ['creator','reviewer','negativeReviewer']){
  const session=capture?.sessions?.[name],trace=session?.gatewayTrace;
  if(!trace||trace.status==='BLOCKED')add('model-tool-'+name,'BLOCKED',trace?.code??'GATEWAY_TOOL_TRACE_REQUIRED');
  else check('model-tool-'+name,()=>verifyGatewayTrace(trace,capture.requests?.[name],session));
 }
 if(localControls?.validation?.status==='BLOCKED')add('local-controls','BLOCKED',localControls.validation.code);
 else if(localControls)check('local-controls',()=>verifyLocalControls(plan,localControls));
 else add('local-controls','NOT_TESTED','EXPLICIT_OFFLINE_CONTROL_PROBE_REQUIRED');
 add('public-web','BLOCKED','LIVE_DNS_AND_BROWSER_ACCEPTANCE_REQUIRED');
 add('physical-mac','NOT_TESTED','PHYSICAL_APPLE_SILICON_EVIDENCE_REQUIRED');
 add('independent-third-party','NOT_TESTED','UNRELATED_REVIEWER_REQUIRED');
 add('soak-72-hours','NOT_TESTED','REAL_ELAPSED_OBSERVATION_REQUIRED');
 add('paid-settlement','NOT_TESTED','NO_PAYMENT_RUN_AUTHORIZED');
 return {schema:'agi-commissioning-report/v1',runID:plan.runID,releaseSHA256:plan.releaseSHA256,evaluatedAt:now,status:gates.some(g=>g.status==='FAIL')?'FAIL':gates.some(g=>g.status==='BLOCKED')?'BLOCKED':'NOT_TESTED',gates,dependencyMode:capture?.dependencyMode??'not-executed',productionQualified:false,assurance:'Checks establish consistency of captured evidence and independently recomputed synthetic artifacts. Supplied records are not cryptographic proof of truthful capture, provider identity, hardware or unrelated organizational control. Mocked evidence never qualifies real operation.'};
}
