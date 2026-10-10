import os from 'node:os';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {runtimeEnvironment,runtimeFailureCode,RUNTIME_FAILURES} from './runtime-env.mjs';
import {boundedJSON} from '../src/review.mjs';

export const CLI_ERROR_CODES=new Set([...RUNTIME_FAILURES,'COMPUTE_CLI_OUTPUT_LIMIT','COMPUTE_CLI_UNAVAILABLE','COMPUTE_CLI_CANCELLED','COMPUTE_CLI_TIMEOUT','COMPUTE_CLI_RESPONSE_INVALID','COMPUTE_CLI_TERMINATION_UNCONFIRMED','COMPUTE_INFERENCE_FAILED']);
const SIGNALS=new Set(Object.keys(os.constants.signals)),OUTPUT_LIMIT=1048576,STDERR_LIMIT=8192;
const TERMINATE_GRACE_MS=2000,TERMINATE_BOUND_MS=3000,MAX_ELAPSED_MS=2147483647;
const CLEANUP_SUCCESS=Symbol('cleanup-success');
function cliError(code,metadata){const safe=CLI_ERROR_CODES.has(code)?code:'COMPUTE_INFERENCE_FAILED';return Object.assign(Error(safe),metadata,{code:safe,failureCode:safe});}
function abortCode(signal){return signal?.reason?.name==='TimeoutError'||signal?.reason?.code==='ETIMEDOUT'?'COMPUTE_CLI_TIMEOUT':'COMPUTE_CLI_CANCELLED';}

// Error evidence contains fixed classifications and scalar execution facts only.
// The diagnostic adapter returns bounded stdout for its caller to parse and sanitize.
export function runCLI(c,args,signal,{timeoutMs=null}={}) {return runCommand(c,args,signal,{timeoutMs});}
export function runDiagnosticCommand(c,executable,args,{signal,timeoutMs=5000}={}) {return runCommand(c,args,signal,{timeoutMs,executable,diagnostic:true});}
function runCommand(c,args,signal,{timeoutMs=null,executable=null,diagnostic=false}={}) {
  const startedAt=performance.now(),limit=Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=MAX_ELAPSED_MS?timeoutMs:null;
  return new Promise((resolve,reject)=>{
    let child,started=false,closed=false,exitStatus=null,exitSignal=null,done=false,stopCode=null;
    let chunks=[],size=0,stderr=Buffer.alloc(0),deadline,killTimer,boundTimer,pollTimer;
    const groupAbsent=()=>{
      if(!started)return true;
      try{process.kill(-child.pid,0);return false;}catch(error){return error.code==='ESRCH';}
    };
    const metadata=(confirmed=closed&&groupAbsent())=>({exitStatus,signal:exitSignal,elapsedMs:Math.min(MAX_ELAPSED_MS,Math.max(0,Math.ceil(performance.now()-startedAt))),timeoutMs:limit,timedOut:stopCode==='COMPUTE_CLI_TIMEOUT',started,processTerminationConfirmed:confirmed});
    const finish=(code,value,confirmed)=>{
      if(done)return;done=true;
      for(const timer of [deadline,killTimer,boundTimer,pollTimer])clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      const facts=metadata(confirmed);
      chunks=[];stderr=Buffer.alloc(0);
      if(code){child?.stdout?.destroy();child?.stderr?.destroy();child?.unref();reject(cliError(code,facts));}
      else resolve(diagnostic?{...value,...facts,failureCode:null}:value===CLEANUP_SUCCESS?{ok:true,...facts,failureCode:null}:value);
    };
    const kill=signalName=>{if(started)try{process.kill(-child.pid,signalName);}catch{}};
    const settled=()=>{if(stopCode&&closed&&groupAbsent())finish(stopCode,null,true);};
    const stop=code=>{
      if(done||stopCode)return;
      stopCode=code;
      if(!started)return finish(code,null,true);
      kill('SIGTERM');
      killTimer=setTimeout(()=>{kill('SIGKILL');settled();},TERMINATE_GRACE_MS);
      boundTimer=setTimeout(()=>{kill('SIGKILL');finish(stopCode,null,closed&&groupAbsent());},TERMINATE_BOUND_MS);
      pollTimer=setInterval(settled,25);
      settled();
    };
    const abort=()=>stop(abortCode(signal));
    if(signal?.aborted)return abort();
    if(diagnostic&&(!c.docker||executable!==c.docker||!Array.isArray(args)||!['ps','inspect'].includes(args[0])))return finish('COMPUTE_CLI_UNAVAILABLE',null,true);
    let env;
    try{env=runtimeEnvironment(c);}catch(error){return finish(error?.message,null,true);}
    if(signal?.aborted)return abort();
    try{child=spawn(diagnostic?executable:c.openclaw,args,{env,cwd:c.profileDir,stdio:['ignore','pipe','pipe'],detached:true,shell:false});started=Number.isInteger(child.pid)&&child.pid>0;}
    catch{return finish('COMPUTE_CLI_UNAVAILABLE',null,true);}
    child.stdout.on('data',chunk=>{
      if(done||stopCode)return;
      size+=chunk.length;
      if(size>OUTPUT_LIMIT){chunks=[];return stop('COMPUTE_CLI_OUTPUT_LIMIT');}
      chunks.push(chunk);
    });
    child.stderr.on('data',chunk=>{
      if(done||stopCode)return;
      stderr=chunk.length>=STDERR_LIMIT?Buffer.from(chunk.subarray(-STDERR_LIMIT)):Buffer.concat([stderr,chunk]).subarray(-STDERR_LIMIT);
    });
    child.stdout.on('error',()=>stop('COMPUTE_CLI_UNAVAILABLE'));
    child.stderr.on('error',()=>stop('COMPUTE_CLI_UNAVAILABLE'));
    child.on('error',()=>{if(started)stop('COMPUTE_CLI_UNAVAILABLE');else finish('COMPUTE_CLI_UNAVAILABLE',null,true);});
    child.on('close',(status,signalName)=>{
      closed=true;exitStatus=Number.isSafeInteger(status)?status:null;exitSignal=SIGNALS.has(signalName)?signalName:null;
      if(done)return;
      if(stopCode)return settled();
      if(signal?.aborted)return abort();
      if(status!==0||signalName){const code=runtimeFailureCode({status,signal:signalName,stderr:stderr.toString('utf8')},{dockerOnly:diagnostic});return groupAbsent()?finish(code,null,true):stop(code);}
      if(diagnostic||args[0]==='sandbox'&&args[1]==='recreate'){
        if(!groupAbsent())return stop('COMPUTE_CLI_TERMINATION_UNCONFIRMED');
        return finish(null,diagnostic?{stdout:Buffer.concat(chunks).toString('utf8')}:CLEANUP_SUCCESS,true);
      }
      try{finish(null,boundedJSON(Buffer.concat(chunks)));}catch{finish('COMPUTE_CLI_RESPONSE_INVALID',null);}
    });
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    if(limit!==null&&!done)deadline=setTimeout(()=>stop('COMPUTE_CLI_TIMEOUT'),Math.max(1,limit-(performance.now()-startedAt)));
  });
}
