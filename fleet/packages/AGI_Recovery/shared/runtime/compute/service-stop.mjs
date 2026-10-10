import {COMPUTE_ROLES,roleContract} from './roles.mjs';
// A closed port is not proof that a KeepAlive LaunchAgent is unloaded.
// Shutdown is asynchronous: confirm both jobs, both ports and recognized
// runtime sockets within one bounded interval before touching profile state.
const need=(ok,code)=>{if(!ok)throw Error(code);};
const cancelled=signal=>need(!signal?.aborted,'SETUP_CANCELLED');
const FAILURE_CODES=new Set(['SETUP_CANCELLED','SETUP_SERVICE_IDENTITY','SETUP_SERVICE_STOP_OPTIONS','SETUP_SERVICE_STOP_UNCONFIRMED','COMPUTE_PROFILE_STILL_RUNNING','SETUP_RUNTIME_SOCKET_STILL_PRESENT','PUBLIC_BROWSER_SOCKET_INVALID','PUBLIC_BROWSER_SOCKET_SYMLINK','PUBLIC_BROWSER_SOCKET_PERMISSIONS','PUBLIC_BROWSER_SOCKET_EXISTS','PUBLIC_BROWSER_SOCKET_CHANGED']);
const boolean=value=>value===true;
const PRINT_CLASSIFICATIONS=new Set(['absent','loaded','rejected','invalid-result','command-failed']);
const exitStatus=value=>Number.isSafeInteger(value)&&value>=0&&value<=255?value:null;
function safePrintEvidence(value){
  if(!value||!Number.isSafeInteger(value.attempt)||value.attempt<1||(value.status!==null&&exitStatus(value.status)===null)||!PRINT_CLASSIFICATIONS.has(value.classification))return null;
  return {attempt:value.attempt,status:exitStatus(value.status),classification:value.classification,badRequestPrefix:boolean(value.badRequestPrefix)};
}
export function safeServiceStopDiagnostics(value){
  if(value?.schema!=='agi-service-stop/v1')return null;
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  return {schema:value.schema,state:['waiting','passed','failed'].includes(value.state)?value.state:'failed',elapsedMs:count(value.elapsedMs),timeoutMs:count(value.timeoutMs),attempts:count(value.attempts),servicesAbsent:{compute:boolean(value.servicesAbsent?.compute),gateway:boolean(value.servicesAbsent?.gateway)},portsClosed:{compute:boolean(value.portsClosed?.compute),gateway:boolean(value.portsClosed?.gateway)},socketsAbsent:boolean(value.socketsAbsent),launchctlPrint:{compute:safePrintEvidence(value.launchctlPrint?.compute),gateway:safePrintEvidence(value.launchctlPrint?.gateway)},failureCode:FAILURE_CODES.has(value.failureCode)?value.failureCode:null};
}
const cleanResult=result=>result&&exitStatus(result.status)!==null&&!result.error&&!result.signal&&(result.code==null||['OK','FAILED'].includes(result.code))&&[result.stdout,result.stderr].every(value=>value==null||typeof value==='string');
function classifyPrint(result,label,uid,attempt){
  const evidence={attempt,status:exitStatus(result?.status),classification:'invalid-result',badRequestPrefix:false};
  if(!cleanResult(result))return evidence;
  // Match complete lines, never a substring or a loosely trimmed identity.
  // macOS exit 113 can prefix the exact absence line with "Bad request.".
  // Empty lines and CRLF are transport formatting; all other text must match.
  const lines=(String(result.stderr??'')+'\n'+String(result.stdout??'')).split(/\r?\n/).filter(line=>line!=='');
  evidence.badRequestPrefix=lines[0]==='Bad request.';
  const expected=`Could not find service "${label}" in domain for user gui: ${uid}`;
  const exactAbsence=lines.length===1&&lines[0]===expected||lines.length===2&&lines[0]==='Bad request.'&&lines[1]===expected;
  if(result.status!==0){evidence.classification=exactAbsence?'absent':'rejected';return evidence;}
  // A successful print means loaded, hence continued bounded polling. Never
  // interpret contradictory absence or permission-error text as a loaded job.
  evidence.classification=lines.some(line=>/Could not find service|Bad request\.|permission denied|operation not permitted|not privileged/i.test(line))?'rejected':'loaded';
  return evidence;
}
async function bounded(run,ms,signal,code){
  cancelled(signal);need(ms>0,code);
  const controller=new AbortController(),deadline=performance.now()+ms;let timer,abort;
  const interruption=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error(code));},ms);abort=()=>{controller.abort();reject(Error('SETUP_CANCELLED'));};signal?.addEventListener('abort',abort,{once:true});});
  try{const result=await Promise.race([Promise.resolve().then(()=>run(controller.signal)),interruption]);cancelled(signal);need(performance.now()<=deadline,code);return result;}
  finally{controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function stopManagedServices({uid,labels,ports,run,probePort,checkSockets=()=>true,signal,timeoutMs=20000,pollIntervalMs=250,requestTimeoutMs=5000,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),diagnostics={},onDiagnostics=()=>{}}){
  const contract=COMPUTE_ROLES.map(role=>roleContract(role)).find(c=>Array.isArray(labels)&&labels.includes(c.computeLabel));
  need(contract,'SETUP_SERVICE_IDENTITY');const expectedLabels=[contract.computeLabel,contract.gatewayLabel],expectedPorts=[contract.port,contract.gatewayPort];
  need(Number.isSafeInteger(uid)&&uid>0&&Array.isArray(labels)&&labels.length===2&&new Set(labels).size===2&&expectedLabels.every(label=>labels.includes(label))&&Array.isArray(ports)&&ports.length===2&&new Set(ports).size===2&&expectedPorts.every(port=>ports.includes(port)),'SETUP_SERVICE_IDENTITY');
  for(const value of [timeoutMs,pollIntervalMs,requestTimeoutMs])need(Number.isSafeInteger(value)&&value>0&&value<=120000,'SETUP_SERVICE_STOP_OPTIONS');
  for(const value of [run,probePort,checkSockets,now,sleep,onDiagnostics])need(typeof value==='function','SETUP_SERVICE_STOP_OPTIONS');
  const start=now(),wallStart=performance.now(),deadline=start+timeoutMs,wallDeadline=wallStart+timeoutMs;let lastTime=start;
  need(Number.isFinite(start),'SETUP_SERVICE_STOP_OPTIONS');
  const clock=()=>{const value=now();need(Number.isFinite(value)&&value>=lastTime,'SETUP_SERVICE_STOP_OPTIONS');lastTime=value;return value;};
  const remaining=()=>Math.min(deadline-clock(),wallDeadline-performance.now());
  const elapsed=()=>Math.max(0,Math.floor(Math.max(lastTime-start,performance.now()-wallStart)));
  Object.assign(diagnostics,{schema:'agi-service-stop/v1',state:'waiting',attempts:0,elapsedMs:0,timeoutMs,servicesAbsent:{compute:false,gateway:false},portsClosed:{compute:false,gateway:false},socketsAbsent:false,launchctlPrint:{compute:null,gateway:null},failureCode:null});
  const failCode=()=>!Object.values(diagnostics.servicesAbsent).every(Boolean)?'SETUP_SERVICE_STOP_UNCONFIRMED':!Object.values(diagnostics.portsClosed).every(Boolean)?'COMPUTE_PROFILE_STILL_RUNNING':'SETUP_RUNTIME_SOCKET_STILL_PRESENT';
  const inspectSockets=async()=>{const value=await bounded(s=>checkSockets(s),Math.min(requestTimeoutMs,remaining()),signal,'SETUP_RUNTIME_SOCKET_STILL_PRESENT');need(typeof value==='boolean','SETUP_SERVICE_STOP_UNCONFIRMED');return value;};
  const command=async(args,limit,observe)=>{
    const ms=Math.min(limit,remaining());let result;
    try{result=await bounded(s=>run('/bin/launchctl',args,{timeoutMs:Math.max(1,Math.floor(ms)),signal:s,captureStderr:true}),ms,signal,'SETUP_SERVICE_STOP_UNCONFIRMED');}
    catch(error){cancelled(signal);throw Error('SETUP_SERVICE_STOP_UNCONFIRMED',{cause:error});}
    observe?.(result);need(remaining()>0,'SETUP_SERVICE_STOP_UNCONFIRMED');need(cleanResult(result),'SETUP_SERVICE_STOP_UNCONFIRMED');return result;
  };
  try{
    cancelled(signal);let bootoutFailure=null;
    for(const label of labels){
      cancelled(signal);
      // Already-unloaded jobs may return different ordinary nonzero statuses
      // (including macOS status 5). The following exact print proves absence.
      try{await command(['bootout',`gui/${uid}/${label}`],15000);}
      catch(error){cancelled(signal);bootoutFailure??=error;}
    }
    if(bootoutFailure)throw bootoutFailure;
    while(remaining()>0){
      cancelled(signal);const observation={servicesAbsent:{compute:false,gateway:false},portsClosed:{compute:false,gateway:false},socketsAbsent:false};Object.assign(diagnostics,observation,{attempts:diagnostics.attempts+1});
      for(const [index,label] of expectedLabels.entries()){
        const role=index===0?'compute':'gateway',attempt=diagnostics.attempts;
        diagnostics.launchctlPrint[role]={attempt,status:null,classification:'command-failed',badRequestPrefix:false};
        await command(['print',`gui/${uid}/${label}`],requestTimeoutMs,result=>{diagnostics.launchctlPrint[role]=classifyPrint(result,label,uid,attempt);});
        const classification=diagnostics.launchctlPrint[role].classification;
        need(classification==='loaded'||classification==='absent','SETUP_SERVICE_STOP_UNCONFIRMED');
        observation.servicesAbsent[role]=classification==='absent';
      }
      for(const [index,port] of expectedPorts.entries()){
        let listening;try{listening=await bounded(s=>probePort(port,s),Math.min(requestTimeoutMs,remaining()),signal,'COMPUTE_PROFILE_STILL_RUNNING');}catch(error){cancelled(signal);throw Error('COMPUTE_PROFILE_STILL_RUNNING',{cause:error});}
        need(typeof listening==='boolean','SETUP_SERVICE_STOP_UNCONFIRMED');observation.portsClosed[index===0?'compute':'gateway']=!listening;
      }
      // A socket checker may reclaim a strictly validated stale endpoint; it
      // must never run until both jobs are unloaded and both ports are closed.
      if(Object.values(observation.servicesAbsent).every(Boolean)&&Object.values(observation.portsClosed).every(Boolean))observation.socketsAbsent=await inspectSockets();
      Object.assign(diagnostics,observation,{elapsedMs:elapsed()});
      need(remaining()>0,failCode());
      if(Object.values(observation.servicesAbsent).every(Boolean)&&Object.values(observation.portsClosed).every(Boolean)&&observation.socketsAbsent){diagnostics.state='passed';return true;}
      const delay=Math.min(pollIntervalMs,remaining());if(delay>0)await bounded(s=>sleep(delay,s),remaining()+1,signal,failCode());
    }
    throw Error(failCode());
  }catch(error){diagnostics.state='failed';diagnostics.elapsedMs=elapsed();diagnostics.failureCode=FAILURE_CODES.has(error.message)?error.message:'SETUP_SERVICE_STOP_UNCONFIRMED';error.serviceStopDiagnostics=safeServiceStopDiagnostics(diagnostics);throw error;}
  finally{diagnostics.elapsedMs=elapsed();try{const notified=onDiagnostics(safeServiceStopDiagnostics(diagnostics));if(notified&&typeof notified.catch==='function')notified.catch(()=>{});}catch{}}
}

// Read-only observers share the exact fail-closed service absence classifier.
export {classifyPrint as classifyLaunchctlPrint};
