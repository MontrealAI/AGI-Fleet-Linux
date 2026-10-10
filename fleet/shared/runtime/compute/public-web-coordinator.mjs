import {GatewayToolObserver} from './gateway-tool-trace.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {canonical,sha256,ensure,atomicWrite} from '../src/util.mjs';
import {validateExecutionAdmission} from '../src/public-web-admission.mjs';
import {createAcceptedPublicWebGrant} from './public-web-issuer.mjs';
import {grantDigest,verifyPublicWebApproval} from './public-web-policy.mjs';
import {preparePublicWebIsolation,activatePublicWebIsolation,cleanupPublicWebIsolation} from './public-web-isolation.mjs';
import {publicBrowserPolicyReady} from './public-browser-config.mjs';
import {createPublicBrowserSession} from './public-browser-session.mjs';
import {validatePublicWebCommissioningFixture} from './public-web-commissioning.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const image=value=>/^sha256:[a-f0-9]{64}$/.test(value??'');
export const publicWebRole=kind=>kind==='generate'?'agent':['quality','computer-review'].includes(kind)?'reviewer':null;
export const publicWebSpec=(kind,input)=>kind==='computer-review'?input?.specification:input?.specification?.acceptance;
export const needsPublicWeb=(kind,input)=>Boolean(publicWebSpec(kind,input)?.publicWeb?.[publicWebRole(kind)]);
export const publicWebRequestHash=({kind,input,executionAdmission,purpose='accepted-job'})=>sha256(canonical({kind,input,executionAdmission,purpose}));
function barrier(entry){let done=false,release;entry.inflight=new Promise(resolve=>{release=resolve;});return()=>{if(!done){done=true;release();}};}
const sessionKey=(id,role)=>`agent:agi-${role==='agent'?'creator':'reviewer'}:agi-work-${id}`;
function subnet(id){const bytes=crypto.createHash('sha256').update(id).digest();return `10.${64+(bytes[0]%64)}.${bytes[1]}.${(bytes[2]%32)*8}/29`;}
// No signing key is available here. A lease allocates a stopped container; only a
// matching signer-approved v2 grant can turn that same lease into an active run.
export class PublicWebCoordinator{
 constructor(worker,{prepare=preparePublicWebIsolation,activate=activatePublicWebIsolation,cleanup=cleanupPublicWebIsolation,createSession=createPublicBrowserSession,leaseMs=60000}={}){
  this.worker=worker;this.dependencies={prepare,activate,cleanup,createSession};this.leaseMs=leaseMs;this.entries=new Map();this.dependencyMode=worker.verifyPolicy!==false&&prepare===preparePublicWebIsolation&&activate===activatePublicWebIsolation&&cleanup===cleanupPublicWebIsolation&&createSession===createPublicBrowserSession?'installed-runtime':'test-double';
  // A process restart cannot resurrect an in-memory authorization or forget a
  // possibly-live resource. Recovery remains an explicit scoped operation.
  if(worker.state.requests.some(r=>['web-preparing','web-prepared','web-active','web-closing','cleanup-required'].includes(r.status)||r.publicWeb?.cleanup==='BLOCKED')){worker.stopForCleanup();}
 }
 policy(purpose){
  this.worker.assertPolicy();const p=this.worker.c.publicWebPolicy;
  ensure(p?.enabled===true&&['accepted-job','commissioning'].includes(purpose),'COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');
  ensure(purpose==='commissioning'?['commissioning','qualified'].includes(p.mode):p.mode==='qualified','COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');
  ensure(image(p.browserImageID)&&image(p.proxyImageID)&&typeof p.operatorPublicKey==='string','COMPUTE_PUBLIC_WEB_POLICY_INVALID');
  ensure(publicBrowserPolicyReady(this.worker.c,{commissioning:purpose==='commissioning'}),'COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');
  const key=crypto.createPublicKey(p.operatorPublicKey);ensure(key.asymmetricKeyType==='ed25519','COMPUTE_PUBLIC_WEB_POLICY_INVALID');
  return p;
 }
 validate({id,kind,input,executionAdmission,purpose='accepted-job',commissioningFixture}){
  ensure(UUID.test(id??'')&&needsPublicWeb(kind,input),'COMPUTE_PUBLIC_WEB_SCOPE_REQUIRED');
  const role=publicWebRole(kind),specification=publicWebSpec(kind,input),policy=this.policy(purpose);
  validateExecutionAdmission(executionAdmission,specification,role);
  if(purpose==='commissioning'){
   const fixed=validatePublicWebCommissioningFixture({specification,fixture:commissioningFixture,executionAdmission,role,now:this.worker.now()});
   if(kind!=='computer-review')ensure(canonical(input.specification)===canonical(fixed.work),'PUBLIC_WEB_COMMISSIONING_FIXTURE');
   ensure(input.revision===undefined&&(['quality','computer-review'].includes(kind)||input.attempt===1),'PUBLIC_WEB_COMMISSIONING_FIXTURE');
  }else ensure(commissioningFixture===undefined,'PUBLIC_WEB_COMMISSIONING_FIXTURE');
  return {policy,role,specification,requestSha256:publicWebRequestHash({kind,input,executionAdmission,purpose})};
 }
 owns(id){return this.entries.has(id);}
 context(id){const entry=this.entries.get(id);return entry?{purpose:entry.purpose,commissioning:entry.purpose==='commissioning',specSha256:entry.executionAdmission.acceptedSpecSha256,role:entry.role}:null;}
 async prepare(request,record,signal){
  const {id,kind,input,executionAdmission,purpose='accepted-job',commissioningFixture}=request;
  const {policy,role,specification,requestSha256}=this.validate(request);
  ensure(this.entries.size===0,'COMPUTE_BUSY');
  const abort=new AbortController(),entry={id,kind,role,purpose,requestSha256,executionAdmission:structuredClone(executionAdmission),record,abort,prepared:null,active:null,session:null,closing:null,timer:null,leaseExpiresAt:this.worker.now()+this.leaseMs};
  const release=barrier(entry);this.entries.set(id,entry);record.status='web-preparing';record.publicWeb={purpose,taskHash:executionAdmission.acceptedSpecSha256,sourceSpecSha256:executionAdmission.sourceSpecSha256,role};this.worker.save();
  const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
  try{
   const prepared=await this.dependencies.prepare({...(this.worker.c.deploymentPlatform==='linux'?{rootless:true}:{}),taskHash:executionAdmission.acceptedSpecSha256,runtimePolicyHash:this.worker.c.policyHash,sessionID:id,browserImageID:policy.browserImageID,proxyImageID:policy.proxyImageID,subnet:subnet(id),sessionDirectory:path.join(this.worker.c.profileDir,'public-web-sessions',id)},{docker:this.worker.c.docker,signal:combined,qualificationAcknowledged:true});
   entry.prepared=prepared;combined.throwIfAborted();this.policy(purpose);
   const issuedAt=this.worker.now(),bindings={runtimePolicyHash:this.worker.c.policyHash,sessionID:id,browserContainerID:prepared.browserContainerID,browserImageID:policy.browserImageID,proxyImageID:policy.proxyImageID,browserIPv4:prepared.plan.browserIPv4,proxyIPv4:prepared.plan.proxyIPv4};
   const approvalPayload=createAcceptedPublicWebGrant({immutableSpec:specification,executionAdmission,bindings,issuedAt,purpose});
   entry.events=[];entry.approvalPayload=approvalPayload;entry.expectedGrantHash=grantDigest(approvalPayload);entry.leaseExpiresAt=Math.min(issuedAt+this.leaseMs,approvalPayload.expiresAt);
   record.status='web-prepared';record.publicWeb.grantHash=entry.expectedGrantHash;record.publicWeb.browserContainerID=prepared.browserContainerID;record.publicWeb.expiresAt=approvalPayload.expiresAt;this.worker.save();
   entry.timer=setTimeout(()=>{this.close(id,'web-expired').catch(()=>{});},Math.max(1,entry.leaseExpiresAt-this.worker.now()));entry.timer.unref();
   release();return {schema:'agi-public-web-preparation/v1',requestID:id,requestSha256,approvalPayload,expectedGrantHash:entry.expectedGrantHash,expiresAt:approvalPayload.expiresAt,purpose};
  }catch(error){release();if(error.cleanupBlocked)this.worker.stopForCleanup();await this.close(id,error.cleanupBlocked?'cleanup-required':'failed-or-uncertain');throw error;}finally{release();}
 }
 async activate(request,approval,signal){
  const checked=this.validate(request),entry=this.entries.get(request.id);
  ensure(entry&&entry.record.status==='web-prepared'&&entry.requestSha256===checked.requestSha256&&entry.purpose===(request.purpose??'accepted-job'),'COMPUTE_PUBLIC_WEB_PREPARATION_REQUIRED');
  ensure(this.worker.now()<entry.leaseExpiresAt,'COMPUTE_PUBLIC_WEB_LEASE_EXPIRED');
  const grant=verifyPublicWebApproval(approval,checked.policy.operatorPublicKey,{expectedGrantHash:entry.expectedGrantHash,now:this.worker.now()});
  ensure(grant.schema==='agi-public-web-grant/v2'&&canonical(grant)===canonical(entry.approvalPayload),'COMPUTE_PUBLIC_WEB_APPROVAL_MISMATCH');
  const release=barrier(entry);clearTimeout(entry.timer);entry.timer=null;
  const combined=signal?AbortSignal.any([signal,entry.abort.signal]):entry.abort.signal;
  const directory=entry.prepared.plan.spec.sessionDirectory,approvalFile=path.join(directory,'pending-approval.json'),authorityFile=path.join(directory,'pending-authority.pem');
  try{
   fs.writeFileSync(approvalFile,JSON.stringify(approval),{mode:0o600,flag:'wx'});fs.writeFileSync(authorityFile,checked.policy.operatorPublicKey,{mode:0o600,flag:'wx'});
   entry.active=await this.dependencies.activate(entry.prepared,{approvalFile,authorityFile,operatorPublicKey:checked.policy.operatorPublicKey,expectedGrantHash:entry.expectedGrantHash,signal:combined,qualificationAcknowledged:true,now:this.worker.now,onCleanup:result=>{if(result.status!=='PASS'){entry.record.status='cleanup-required';this.worker.save();this.worker.stopForCleanup();}entry.abort.abort(Error('COMPUTE_PUBLIC_WEB_GRANT_CLOSED'));}});
   combined.throwIfAborted();this.policy(entry.purpose);
   entry.session=await this.dependencies.createSession({prepared:entry.active,operatorPublicKey:checked.policy.operatorPublicKey,expectedGrantHash:entry.expectedGrantHash,signal:combined,checkPolicy:()=>this.policy(entry.purpose)});
   combined.throwIfAborted();this.policy(entry.purpose);entry.approval=structuredClone(approval);entry.startedAt=this.worker.now();
   entry.gateway=await new GatewayToolObserver(this.worker.c,{requestID:entry.id,agent:`agi-${entry.role==='agent'?'creator':'reviewer'}`,sessionKey:sessionKey(entry.id,entry.role)},{now:this.worker.now}).start();
   combined.throwIfAborted();this.policy(entry.purpose);entry.record.status='web-active';this.worker.save();
   entry.timer=setTimeout(()=>{this.close(entry.id,'web-expired').catch(()=>{});},Math.max(1,grant.expiresAt-this.worker.now()));entry.timer.unref();
   release();return {signal:combined,context:this.context(entry.id)};
  }catch(error){release();if(error.cleanupBlocked)this.worker.stopForCleanup();await this.close(entry.id,error.cleanupBlocked?'cleanup-required':'failed-or-uncertain');throw error;}finally{release();}
 }
 async execute({agentId,sessionKey:actual,command,signal}){
  const entry=[...this.entries.values()].find(e=>e.record.status==='web-active'&&sessionKey(e.id,e.role)===actual&&agentId===`agi-${e.role==='agent'?'creator':'reviewer'}`);
  ensure(entry&&entry.session,'COMPUTE_PUBLIC_WEB_SESSION_REQUIRED');this.policy(entry.purpose);
  ensure(this.worker.now()<entry.approvalPayload.expiresAt,'COMPUTE_PUBLIC_WEB_LEASE_EXPIRED');entry.abort.signal.throwIfAborted();signal?.throwIfAborted();
  ensure(entry.events.length<256,'COMPUTE_PUBLIC_WEB_EVENT_LIMIT');
  const event={action:command.action,startedAt:this.worker.now(),commandSHA256:sha256(canonical(command)),status:'started'};entry.events.push(event);
  const running=(async()=>{try{
   const result=await entry.session.execute(command,{signal:signal?AbortSignal.any([signal,entry.abort.signal]):entry.abort.signal});
   this.policy(entry.purpose);entry.abort.signal.throwIfAborted();
   const {image,...data}=result;event.resultSHA256=sha256(canonical(result));event.gatewayResultTextSHA256=sha256(canonical({trust:'UNTRUSTED_PUBLIC_PAGE',...data}));event.finishedAt=this.worker.now();event.status='complete';
   if(typeof result.url==='string')event.urlSHA256=sha256(result.url);
   if(entry.purpose==='commissioning'&&command.action==='snapshot')event.fixtureObservationMatches=result.url==='https://example.com/'&&result.title==='Example Domain'&&Array.isArray(result.headings)&&result.headings.find(x=>x.level==='h1')?.text==='Example Domain';
   return result;
  }catch(error){event.finishedAt=this.worker.now();event.status='failed-or-uncertain';throw error;}})();
  entry.commands??=new Set();entry.commands.add(running);try{return await running;}finally{entry.commands.delete(running);}
 }
 captureFinal(agent,key,text){const entry=[...this.entries.values()].find(e=>sessionKey(e.id,e.role)===key&&agent===`agi-${e.role==='agent'?'creator':'reviewer'}`);if(entry)entry.finalText=text;}
 async collectQualification(id,signal){
  const entry=this.entries.get(id);if(!entry||entry.purpose!=='commissioning')return;
  if(!this.worker.c.publicWebPolicy?.reviewerPublicKey){entry.qualificationFailure='PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED';return;}
  ensure(entry.active&&entry.session&&!entry.collection,'COMPUTE_PUBLIC_WEB_SESSION_REQUIRED');
  entry.collection=(async()=>{
   const {publicWebQualificationCandidateIdentity}=await import('./public-web-qualification-identity.mjs');const {collectPublicWebQualification}=await import('./public-web-qualification-collector.mjs');
   entry.identity=publicWebQualificationCandidateIdentity(this.worker.c);
   entry.observations=await collectPublicWebQualification({worker:this.worker,active:entry.active,operatorPublicKey:this.worker.c.publicWebPolicy.operatorPublicKey,expectedGrantHash:entry.expectedGrantHash,session:entry.session,signal:signal?AbortSignal.any([signal,entry.abort.signal]):entry.abort.signal,allowLocalRuntime:true});
  })();
  try{await entry.collection;}catch(error){entry.qualificationFailure=/^[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'PUBLIC_WEB_QUALIFICATION_COLLECTION_FAILED';if(signal?.aborted||entry.abort.signal.aborted)throw error;}
 }
 async persistEvidence(entry,cleanup){
  if(!entry.prepared)return;
  const gatewayTrace=entry.gateway?await entry.gateway.finish({finalText:entry.finalText,engineEvents:[],containerID:entry.prepared.browserContainerID,requireExecCorrelation:false}):{status:'BLOCKED',code:'COMMISSIONING_TRACE_NOT_STARTED'};entry.finalText=undefined;
  const evidence={schema:'agi-public-web-observation/v1',source:'protected-browser-host-observer/v1',dependencyMode:this.dependencyMode,requestID:entry.id,role:entry.role,sessionKey:sessionKey(entry.id,entry.role),purpose:entry.purpose,startedAt:entry.startedAt??null,finishedAt:this.worker.now(),runtimePolicyHash:entry.record.policyHash,browserContainerID:entry.prepared.browserContainerID,proxyContainerID:entry.active?.proxyContainerID??entry.prepared.proxyContainerID??null,grant:entry.approval??null,grantHash:entry.expectedGrantHash??null,events:entry.events??[],gatewayTrace,cleanup,status:this.dependencyMode==='installed-runtime'&&cleanup.status==='PASS'?'CAPTURED':this.dependencyMode==='test-double'?'NOT_TESTED':'BLOCKED'};
  atomicWrite(path.join(entry.prepared.plan.spec.sessionDirectory,'browser-observation.json'),JSON.stringify(evidence));
  entry.record.publicWeb.evidenceSHA256=sha256(canonical(evidence));
  if(entry.observations&&entry.identity&&cleanup.status==='PASS'){
   const {PUBLIC_WEB_QUALIFICATION_SCOPE,publicWebQualificationResiduals}=await import('./public-web-qualification.mjs'),issuedAt=this.worker.now();
   const output={schema:'agi-public-web-qualification-export/v1',payload:{schema:'agi-public-web-technical-qualification/v1',scope:PUBLIC_WEB_QUALIFICATION_SCOPE,productionQualified:false,paidSettlementQualified:false,residuals:publicWebQualificationResiduals(),issuedAt,expiresAt:issuedAt+86400000,executionFingerprint:entry.identity.executionFingerprint,candidatePolicyHash:entry.record.policyHash,observations:entry.observations,browserEvidence:evidence,executionAdmission:entry.executionAdmission},verification:entry.identity};
   atomicWrite(path.join(entry.prepared.plan.spec.sessionDirectory,'qualification-export.json'),JSON.stringify(output));entry.record.publicWeb.qualificationExportSHA256=sha256(canonical(output));
  }else if(entry.qualificationFailure)entry.record.publicWeb.qualificationFailure=entry.qualificationFailure;
 }
 async close(id,status='web-cancelled'){
  const entry=this.entries.get(id);if(!entry)return {status:'ABSENT'};if(entry.closing)return entry.closing;
  clearTimeout(entry.timer);entry.abort.abort(Error('COMPUTE_PUBLIC_WEB_GRANT_CLOSED'));
  entry.closing=(async()=>{
   await entry.inflight;await Promise.allSettled([...(entry.commands??[]),...(entry.collection?[entry.collection]:[])]);
   let failed=entry.record.status==='cleanup-required'||status==='cleanup-required';entry.record.status='web-closing';this.worker.save();
   try{await entry.session?.close();}catch{failed=true;}
   try{if(entry.active)await entry.active.close();else if(entry.prepared)await this.dependencies.cleanup(entry.prepared);}catch{failed=true;}
   failed=failed||entry.record.status==='cleanup-required';
   try{await this.persistEvidence(entry,{status:failed?'BLOCKED':'PASS',closedAt:this.worker.now()});}catch{failed=true;}
   entry.record.status=failed?'cleanup-required':status;entry.record.publicWeb={...entry.record.publicWeb,cleanup:failed?'BLOCKED':'PASS',closedAt:this.worker.now()};this.worker.save();this.entries.delete(id);
   if(failed){this.worker.stopForCleanup();throw Error('COMPUTE_SANDBOX_CLEANUP_FAILED');}
   return {status:'PASS',code:'OWNED_PUBLIC_WEB_RESOURCES_REMOVED'};
  })();return entry.closing;
 }
 async closeAll(){await Promise.all([...this.entries.keys()].map(id=>this.close(id)));}
}
