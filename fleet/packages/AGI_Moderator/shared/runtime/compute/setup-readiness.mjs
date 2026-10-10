import {roleContract,COMPUTE_ROLES} from './roles.mjs';
import {assertComputePolicy} from './policy.mjs';
// Service startup is asynchronous on macOS. Keep work stopped until each
// authenticated readiness predicate and the final on-disk policy check pass.
const need=(ok,code)=>{if(!ok)throw Error(code);};
const MAX_TEXT=8192,MAX_HISTORY=128,MAX_RESPONSE=65536;
const bool=v=>typeof v==='boolean'?v:null;
const SAFE_CODES=new Set(['SETUP_CANCELLED','SETUP_READINESS_REQUEST_TIMEOUT','SETUP_READINESS_RESPONSE_INVALID','SETUP_READINESS_RESPONSE_TOO_LARGE','OPENCLAW_GATEWAY_REQUEST_FAILED','OPENCLAW_GATEWAY_HEALTH_FAILED','OPENCLAW_GATEWAY_READINESS_TIMEOUT','COMPUTE_SERVICE_PORT_FAILED','COMPUTE_SERVICE_HEALTH_REQUEST_FAILED','COMPUTE_SERVICE_HEALTH_FAILED','COMPUTE_SERVICE_START_FAILED','COMPUTE_SERVICE_READINESS_TIMEOUT','COMPUTE_POLICY_CHANGED','COMPUTE_AUTH_REQUIRED']);
const code=v=>SAFE_CODES.has(v)?v:null;
const number=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null;
export function sanitizeServiceText(value,{secrets=[],home}={}){
  let text=String(value??'').slice(0,131072);
  for(const secret of secrets)if(typeof secret==='string'&&secret.length)text=text.replaceAll(secret,'[REDACTED]');
  if(typeof home==='string'&&home.length)text=text.replaceAll(home,'[HOME]');
  text=text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
  text=text.replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi,'[URL REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,"'}]+/gi,'[AUTH REDACTED]')
    .replace(/((?:["']?)(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|cookie|password|secret|api[_-]?key|code_verifier|oauth[_-]?code)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,'$1[REDACTED]')
    .replace(/(--(?:token|password|secret|api-key|authorization)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi,'$1[REDACTED]')
    .replace(/\b(?:sk-|sess-)[A-Za-z0-9_-]{8,}/g,'[API SECRET REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[JWT REDACTED]')
    .replace(/\b[a-f0-9]{64,}\b/gi,'[SECRET OR DIGEST REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL REDACTED]')
    .replace(/\/(?:Users|home)\/[^\s/]+/g,'[HOME]');
  return text.length>MAX_TEXT?text.slice(0,MAX_TEXT)+'\n[TRUNCATED]':text;
}
const predicates=health=>({policyHashMatches:bool(health?.policyHashMatches),stopped:bool(health?.stopped),roleMatches:bool(health?.roleMatches),gatewayReady:bool(health?.gatewayReady),policyCurrent:bool(health?.policyCurrent)});
const safeHealth=v=>v&&typeof v==='object'?{role:COMPUTE_ROLES.includes(v.role)?v.role:null,policyHash:hash(v.policyHash),stopped:bool(v.stopped),gatewayReady:bool(v.gatewayReady),policyCurrent:bool(v.policyCurrent),policyFailure:code(v.policyFailure)??(v.policyFailure?'COMPUTE_POLICY_CHANGED':null),error:code(v.error)}:null;
const safeAttempt=v=>({attempt:number(v?.attempt),elapsedMs:number(v?.elapsedMs),portReady:bool(v?.portReady),httpStatus:number(v?.httpStatus),errorCode:code(v?.errorCode),...(v?.predicates?{predicates:predicates(v.predicates),health:safeHealth(v.health)}:{}),...(Array.isArray(v?.missingModels)?{missingModels:v.missingModels.filter(x=>COMPUTE_ROLES.some(role=>roleContract(role).oauth.some(id=>'openclaw/'+id===x)))}:{})});
const safePhase=v=>({state:['pending','waiting','passed','failed','not-tested'].includes(v?.state)?v.state:'pending',attempts:number(v?.attempts)??0,elapsedMs:number(v?.elapsedMs)??0,timeoutMs:number(v?.timeoutMs),history:Array.isArray(v?.history)?v.history.slice(-MAX_HISTORY).map(safeAttempt):[],lastFailure:v?.lastFailure?safeAttempt(v.lastFailure):null});
export function safeReadinessDiagnostics(value){
  if(!value||value.schema!=='agi-setup-service-readiness/v1')return null;
  const commands={};for(const name of ['gatewayInstall','gatewayStart','computeBootstrap'])if(value.commands?.[name]){const v=value.commands[name];commands[name]={status:Number.isInteger(v.status)?v.status:null,signal:['SIGTERM','SIGKILL','SIGINT','SIGABRT'].includes(v.signal)?v.signal:null,errorCode:['ETIMEDOUT','ENOBUFS','ENOENT','EACCES'].includes(v.errorCode)?v.errorCode:null,stdout:sanitizeServiceText(v.stdout),stderr:sanitizeServiceText(v.stderr),truncated:v.truncated===true};}
  return {schema:value.schema,platform:['darwin','linux'].includes(value.platform)?value.platform:null,qualification:'LOCAL_SERVICE_TRANSPORT_ONLY',commands,gateway:safePhase(value.gateway),computePort:safePhase(value.computePort),health:safePhase(value.health),finalPolicy:{state:['pending','passed','failed'].includes(value.finalPolicy?.state)?value.finalPolicy.state:'pending',policyHashMatches:bool(value.finalPolicy?.policyHashMatches),failureCode:code(value.finalPolicy?.failureCode)}};
}
export function createReadinessDiagnostics({platform}){return safeReadinessDiagnostics({schema:'agi-setup-service-readiness/v1',platform});}
export function captureServiceCommand(diagnostics,name,run,{secrets=[],home}={}){
  need(['gatewayInstall','gatewayStart','computeBootstrap'].includes(name),'SETUP_SERVICE_DIAGNOSTICS_INVALID');
  let result;try{result=run();}catch(error){result={status:null,error,stdout:error.stdout,stderr:error.stderr};}
  diagnostics.commands[name]={status:Number.isInteger(result.status)?result.status:null,signal:result.signal??null,errorCode:result.error?.code??null,stdout:sanitizeServiceText(result.stdout,{secrets,home}),stderr:sanitizeServiceText(result.stderr,{secrets,home}),truncated:String(result.stdout??'').length>MAX_TEXT||String(result.stderr??'').length>MAX_TEXT};
  if(result.error?.message==='SETUP_CANCELLED')throw result.error;
  return result;
}
function options(input={}){
  const v={now:()=>performance.now(),sleep:ms=>new Promise(r=>setTimeout(r,ms)),gatewayTimeoutMs:90000,computePortTimeoutMs:20000,healthTimeoutMs:60000,pollIntervalMs:500,requestTimeoutMs:5000,...input};
  for(const key of ['gatewayTimeoutMs','computePortTimeoutMs','healthTimeoutMs','pollIntervalMs','requestTimeoutMs'])need(Number.isSafeInteger(v[key])&&v[key]>0&&v[key]<=120000,'SETUP_SERVICE_READINESS_OPTIONS');
  return v;
}
function cancelled(signal){need(!signal?.aborted,'SETUP_CANCELLED');}
async function bounded(run,ms,signal){
  cancelled(signal);need(ms>0,'SETUP_READINESS_REQUEST_TIMEOUT');
  const controller=new AbortController(),deadline=performance.now()+ms;let timer,abort;
  const interruption=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('SETUP_READINESS_REQUEST_TIMEOUT'));},ms);abort=()=>{controller.abort();reject(Error('SETUP_CANCELLED'));};signal?.addEventListener('abort',abort,{once:true});});
  try{const value=await Promise.race([Promise.resolve().then(()=>run(controller.signal)),interruption]);cancelled(signal);need(performance.now()<=deadline,'SETUP_READINESS_REQUEST_TIMEOUT');return value;}finally{controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function readJSON(response){
  need(response.body?.getReader,'SETUP_READINESS_RESPONSE_INVALID');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;need(size<=MAX_RESPONSE,'SETUP_READINESS_RESPONSE_TOO_LARGE');parts.push(Buffer.from(value));}const value=JSON.parse(Buffer.concat(parts).toString('utf8'));need(value&&typeof value==='object'&&!Array.isArray(value),'SETUP_READINESS_RESPONSE_INVALID');return value;}finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
async function requestJSON(fetch,url,token,signal){
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal});
  if(response.ok)return {httpStatus:response.status,body:await readJSON(response),errorCode:null};
  let body=null,errorCode=null;try{body=await readJSON(response);}catch(error){errorCode=code(error.message)??'SETUP_READINESS_RESPONSE_INVALID';}
  return {httpStatus:response.status,body,errorCode};
}
const elapsed=(o,start)=>Math.max(0,Math.floor(o.now()-start));
const record=(phase,value)=>{phase.attempts++;const saved=structuredClone({...value,attempt:phase.attempts});phase.elapsedMs=saved.elapsedMs;phase.history.push(saved);if(phase.history.length>MAX_HISTORY)phase.history.shift();return saved;};
async function pause(o,deadline,signal){cancelled(signal);const remaining=deadline-o.now();if(remaining>0)try{await bounded(()=>o.sleep(Math.min(o.pollIntervalMs,remaining)),remaining+1,signal);}catch(error){cancelled(signal);if(error.message!=='SETUP_READINESS_REQUEST_TIMEOUT')throw error;}cancelled(signal);}
function failedRequest(error,signal,fallback){cancelled(signal);return code(error.message)??fallback;}
const malformed=error=>['SETUP_READINESS_RESPONSE_INVALID','SETUP_READINESS_RESPONSE_TOO_LARGE'].includes(error.message)||error instanceof SyntaxError;
export async function waitForGatewayReadiness({c,listen,fetch,diagnostics,signal,readiness}){
  const o=options(readiness),phase=diagnostics.gateway,start=o.now(),deadline=start+o.gatewayTimeoutMs;
  phase.state='waiting';phase.timeoutMs=o.gatewayTimeoutMs;
  const required=roleContract(c.role??'agent').oauth.filter(id=>c.workstation||id!=='agi-reviewer').map(id=>'openclaw/'+id);
  try{
    while(o.now()<deadline){
      cancelled(signal);const observation={portReady:false,httpStatus:null,errorCode:null,missingModels:[...required]};let fatal=false;
      try{
        observation.portReady=await bounded(()=>listen(c.gatewayPort),Math.min(1000,deadline-o.now()),signal);
        if(observation.portReady){
          const response=await bounded(s=>requestJSON(fetch,`http://127.0.0.1:${c.gatewayPort}/v1/models`,c.gatewayToken,s),Math.min(o.requestTimeoutMs,deadline-o.now()),signal);
          observation.httpStatus=response.httpStatus;observation.errorCode=response.errorCode;
          if(response.httpStatus>=200&&response.httpStatus<300){need(Array.isArray(response.body.data),'SETUP_READINESS_RESPONSE_INVALID');observation.missingModels=required.filter(id=>!response.body.data.some(model=>model?.id===id));}
          else fatal=[401,403].includes(response.httpStatus);
        }
        need(o.now()<=deadline,'SETUP_READINESS_REQUEST_TIMEOUT');
      }catch(error){observation.errorCode=failedRequest(error,signal,'OPENCLAW_GATEWAY_REQUEST_FAILED');fatal=malformed(error);}
      const saved=record(phase,{...observation,elapsedMs:elapsed(o,start)});
      if(fatal){phase.lastFailure=saved;throw Error('OPENCLAW_GATEWAY_HEALTH_FAILED');}
      if(observation.portReady&&!observation.errorCode&&observation.httpStatus>=200&&observation.httpStatus<300&&observation.missingModels.length===0){phase.state='passed';return;}
      phase.lastFailure=saved;await pause(o,deadline,signal);
    }
    throw Error('OPENCLAW_GATEWAY_READINESS_TIMEOUT');
  }catch(error){phase.state='failed';throw error;}finally{phase.elapsedMs=elapsed(o,start);}
}
export async function waitForComputeReadiness({c,listen,fetch,diagnostics,signal,readiness}){
  const o=options(readiness),port=diagnostics.computePort,start=o.now(),deadline=start+o.computePortTimeoutMs;
  port.state='waiting';port.timeoutMs=o.computePortTimeoutMs;
  try{
    while(o.now()<deadline){
      cancelled(signal);const observation={portReady:false,errorCode:null};
      try{observation.portReady=await bounded(()=>listen(c.port),Math.min(1000,deadline-o.now()),signal);need(o.now()<=deadline,'SETUP_READINESS_REQUEST_TIMEOUT');}catch(error){observation.errorCode=failedRequest(error,signal,'COMPUTE_SERVICE_PORT_FAILED');}
      const saved=record(port,{...observation,elapsedMs:elapsed(o,start)});
      if(observation.portReady&&!observation.errorCode){port.state='passed';break;}
      port.lastFailure=saved;await pause(o,deadline,signal);
    }
    need(port.state==='passed','COMPUTE_SERVICE_START_FAILED');
  }catch(error){port.state='failed';throw error;}finally{port.elapsedMs=elapsed(o,start);}
  const phase=diagnostics.health,healthStart=o.now(),healthDeadline=healthStart+o.healthTimeoutMs;phase.state='waiting';phase.timeoutMs=o.healthTimeoutMs;
  try{
    while(o.now()<healthDeadline){
      cancelled(signal);const observation={httpStatus:null,errorCode:null,predicates:predicates(),health:null};let fatal=false;
      try{
        const response=await bounded(s=>requestJSON(fetch,`http://127.0.0.1:${c.port}/health`,c.token,s),Math.min(o.requestTimeoutMs,healthDeadline-o.now()),signal);
        observation.httpStatus=response.httpStatus;observation.errorCode=response.errorCode;observation.health=safeHealth(response.body);
        if(response.httpStatus>=200&&response.httpStatus<300){
          const health=response.body;
          observation.predicates={policyHashMatches:health.policyHash===c.policyHash,stopped:health.stopped===true,roleMatches:health.role===c.role,gatewayReady:health.gatewayReady===true,policyCurrent:health.policyCurrent===true};
          fatal=!observation.predicates.policyHashMatches||!observation.predicates.stopped||!observation.predicates.roleMatches||!observation.predicates.policyCurrent||typeof health.gatewayReady!=='boolean';
        }else fatal=[401,403].includes(response.httpStatus);
        need(o.now()<=healthDeadline,'SETUP_READINESS_REQUEST_TIMEOUT');
      }catch(error){observation.errorCode=failedRequest(error,signal,'COMPUTE_SERVICE_HEALTH_REQUEST_FAILED');fatal=malformed(error);}
      const saved=record(phase,{...observation,elapsedMs:elapsed(o,healthStart)});
      if(fatal){phase.lastFailure=saved;throw Error('COMPUTE_SERVICE_HEALTH_FAILED');}
      if(!observation.errorCode&&observation.httpStatus>=200&&observation.httpStatus<300&&Object.values(observation.predicates).every(value=>value===true)){phase.state='passed';return;}
      phase.lastFailure=saved;await pause(o,healthDeadline,signal);
    }
    throw Error('COMPUTE_SERVICE_READINESS_TIMEOUT');
  }catch(error){phase.state='failed';throw error;}finally{phase.elapsedMs=elapsed(o,healthStart);}
}
export function verifyFinalPolicy({c,policyHash,diagnostics,signal,assertPolicy=assertComputePolicy}){
  cancelled(signal);try{const matches=policyHash(c)===c.policyHash;diagnostics.finalPolicy.policyHashMatches=matches;need(matches,'COMPUTE_POLICY_CHANGED');assertPolicy(c);diagnostics.finalPolicy.state='passed';diagnostics.finalPolicy.failureCode=null;}catch(error){diagnostics.finalPolicy.state='failed';diagnostics.finalPolicy.policyHashMatches=false;diagnostics.finalPolicy.failureCode='COMPUTE_POLICY_CHANGED';throw Error('COMPUTE_POLICY_CHANGED',{cause:error});}
}
