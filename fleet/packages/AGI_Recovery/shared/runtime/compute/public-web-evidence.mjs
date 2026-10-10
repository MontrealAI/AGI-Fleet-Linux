import {canonical,sha256,ensure} from '../src/util.mjs';
import {verifyPublicWebApproval} from './public-web-policy.mjs';
const hash=value=>/^[a-f0-9]{64}$/.test(value??'');
export function verifyPublicWebCommissioningEvidence(evidence,{requestID,executionAdmission,policyHash,operatorPublicKey}={}){
 try{
  ensure(evidence?.schema==='agi-public-web-observation/v1'&&evidence.source==='protected-browser-host-observer/v1'&&evidence.status==='CAPTURED'&&evidence.dependencyMode==='installed-runtime','PUBLIC_WEB_ACTUAL_BROWSER_EVIDENCE_REQUIRED');
  const role=executionAdmission?.role,agent=role==='agent'?'agi-creator':'agi-reviewer';
  ensure(evidence.requestID===requestID&&evidence.role===role&&evidence.sessionKey===`agent:${agent}:agi-work-${requestID}`&&evidence.runtimePolicyHash===policyHash,'PUBLIC_WEB_BROWSER_EVIDENCE_BINDING');
  const grant=verifyPublicWebApproval(evidence.grant,operatorPublicKey,{expectedGrantHash:evidence.grantHash,now:evidence.grant?.payload?.issuedAt});
  ensure(grant.schema==='agi-public-web-grant/v2'&&grant.purpose==='commissioning'&&grant.sessionID===requestID&&grant.taskHash===executionAdmission.acceptedSpecSha256&&grant.sourceSpecSha256===executionAdmission.sourceSpecSha256&&grant.runtimeSha256===executionAdmission.runtimeSha256&&grant.role===role&&grant.chainId===executionAdmission.chainId&&grant.manager===executionAdmission.manager&&grant.jobID===executionAdmission.jobID&&grant.runtimePolicyHash===policyHash&&grant.browserContainerID===evidence.browserContainerID,'PUBLIC_WEB_BROWSER_EVIDENCE_BINDING');
  ensure(hash(evidence.proxyContainerID)&&evidence.cleanup?.status==='PASS'&&Number.isSafeInteger(evidence.startedAt)&&Number.isSafeInteger(evidence.finishedAt)&&evidence.startedAt>=grant.issuedAt&&evidence.finishedAt>=evidence.startedAt,'PUBLIC_WEB_BROWSER_CLEANUP_REQUIRED');
  const trace=evidence.gatewayTrace;
  ensure(trace?.source==='openclaw-sqlite-observer/v1'&&trace.status==='CAPTURED'&&trace.openclawVersion==='2026.9.5'&&trace.requestID===requestID&&trace.agent===agent&&trace.sessionKey===evidence.sessionKey&&trace.beforeSeq===0&&hash(trace.sessionIDSHA256)&&hash(trace.runIDSHA256)&&hash(trace.finalResponseSHA256)&&trace.startedAt>=evidence.startedAt&&trace.finishedAt>=trace.startedAt&&trace.finishedAt<=evidence.finishedAt&&Array.isArray(trace.calls)&&trace.calls.length<=500,'PUBLIC_WEB_GATEWAY_TOOL_EVIDENCE_REQUIRED');
  ensure(Array.isArray(evidence.events)&&evidence.events.length>0&&evidence.events.length<=256,'PUBLIC_WEB_BROWSER_EVENT_LIMIT');
  let previous=0;const correlated=[];
  for(const event of evidence.events){
   if(event.status!=='complete')continue;
   ensure(event.startedAt>=evidence.startedAt&&event.finishedAt>=event.startedAt&&event.finishedAt<grant.expiresAt&&event.finishedAt<=evidence.finishedAt&&hash(event.commandSHA256)&&hash(event.resultSHA256)&&hash(event.gatewayResultTextSHA256),'PUBLIC_WEB_BROWSER_EVENT_BINDING');
   const call=trace.calls.find(c=>c.tool==='agi_public_browser'&&c.isError===false&&Number.isSafeInteger(c.callSeq)&&c.callSeq>previous&&Number.isSafeInteger(c.resultSeq)&&c.resultSeq>c.callSeq&&c.resultSeq<=trace.afterSeq&&c.argumentsSHA256===event.commandSHA256&&c.resultTextSHA256===event.gatewayResultTextSHA256&&hash(c.toolCallSHA256)&&hash(c.resultSHA256));
   ensure(call,'PUBLIC_WEB_GATEWAY_TOOL_CORRELATION_REQUIRED');previous=call.resultSeq;correlated.push(event);
  }
  const navigation=correlated.findIndex(e=>e.action==='navigate'&&e.urlSHA256===sha256('https://example.com/'));
  ensure(navigation>=0&&correlated.some((e,i)=>i>navigation&&e.action==='snapshot'&&e.urlSHA256===sha256('https://example.com/')&&e.fixtureObservationMatches===true),'PUBLIC_WEB_ACTUAL_NAVIGATION_REQUIRED');
  return {status:'PASS',actualBrowserInteraction:true,completedToolCalls:correlated.length,grantHash:evidence.grantHash,cleanup:'PASS',scope:'Fresh Gateway tool calls correlated with protected browser host observations for this synthetic fixture. Physical isolation, independent external review and production qualification are not implied.',productionQualified:false};
 }catch(error){return {status:'BLOCKED',code:/^PUBLIC_WEB_[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'PUBLIC_WEB_BROWSER_EVIDENCE_INVALID',actualBrowserInteraction:false,productionQualified:false};}
}
