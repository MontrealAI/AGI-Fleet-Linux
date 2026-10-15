// Fixed Alpha stdin IPC. No task-selected executable, module, path or environment.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {need,keys,parseStrict} from '../contracts.mjs';
import {requireAlphaRuntime} from './package.mjs';
import {validateAlphaInput,validateAlphaSpecValidation,validateAlphaOutput} from './contract.mjs';

const BIN='/usr/bin/bwrap',LIMIT='/usr/bin/prlimit';
const UTF8=new TextDecoder('utf-8',{fatal:true});
export const ALPHA_IPC_LIMITS=Object.freeze({wallMs:15000,cpuSecondsPerPhase:5,addressSpaceBytes:4294967296,fileBytes:1048576,openFiles:128,stderrBytes:8192,statusBytes:16384});
const NAMESPACES=['pid','net','mnt','ipc','uts'];
function trustedTool(file){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&(s.mode&0o022)===0,'SANDBOX_EXECUTABLE_UNTRUSTED');}
function namespaceIds(){return Object.fromEntries(NAMESPACES.map(name=>{const value=fs.readlinkSync('/proc/self/ns/'+name),match=new RegExp('^'+name+':\\[(\\d+)\\]$').exec(value);need(match,'ALPHA_NAMESPACE_UNOBSERVABLE');return [name,Number(match[1])];}));}
export function alphaSandboxArguments(rootfs,phase){
  need(['validate','work'].includes(phase),'ALPHA_PHASE_INVALID');
  need(typeof rootfs==='string'&&rootfs.startsWith('/')&&!rootfs.includes('\0'),'ALPHA_ROOTFS_INVALID');
  return ['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--clearenv',
    '--ro-bind',rootfs,'/','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--chdir','/tmp',
    '--setenv','HOME','/nonexistent','--setenv','LANG','C.UTF-8','--setenv','OPENBLAS_NUM_THREADS','1','--setenv','OMP_NUM_THREADS','1',
    '--json-status-fd','3','--sync-fd','4','--','/opt/alpha/python/bin/python3.12','-I','-S','-B','/opt/alpha/launch-'+phase+'.py'];
}
export function parseAlphaStatus(raw,hostNamespaces,{requireExit=true}={}){
  need(Buffer.isBuffer(raw)&&raw.length<=ALPHA_IPC_LIMITS.statusBytes,'ALPHA_STATUS_INVALID');
  const lines=UTF8.decode(raw).trim().split('\n');need(lines.length>0&&lines.length<=2&&lines.every(x=>x.trim()),'ALPHA_STATUS_INVALID');
  const start=parseStrict(lines[0],ALPHA_IPC_LIMITS.statusBytes);
  keys(start,['child-pid',...NAMESPACES.map(n=>n+'-namespace'),'cgroup-namespace'],['child-pid',...NAMESPACES.map(n=>n+'-namespace')]);
  need(Number.isSafeInteger(start['child-pid'])&&start['child-pid']>0,'ALPHA_STATUS_INVALID');
  for(const name of NAMESPACES)need(Number.isSafeInteger(start[name+'-namespace'])&&start[name+'-namespace']>0&&start[name+'-namespace']!==hostNamespaces[name],'ALPHA_NAMESPACE_NOT_PRIVATE');
  if(Object.hasOwn(start,'cgroup-namespace'))need(Number.isSafeInteger(start['cgroup-namespace'])&&start['cgroup-namespace']>0,'ALPHA_STATUS_INVALID');
  let exitCode=null;if(lines.length===2){const end=parseStrict(lines[1],1024);keys(end,['exit-code']);need(Number.isInteger(end['exit-code'])&&end['exit-code']>=0&&end['exit-code']<=255,'ALPHA_STATUS_INVALID');exitCode=end['exit-code'];}
  if(requireExit)need(exitCode!==null,'ALPHA_STATUS_EXIT_MISSING');
  return {childPid:start['child-pid'],namespaces:Object.fromEntries(NAMESPACES.map(n=>[n,start[n+'-namespace']])),exitCode};
}

// Internal transport test seam. Production callers always use runAlphaPhase,
// whose tools, namespace observation, process signaling and clock are fixed.
export async function exerciseAlphaTransport({rootfs,phase,stdin,outputLimit,deadline,signal},io){
  need(Buffer.isBuffer(stdin)&&stdin.length<=512000&&Number.isSafeInteger(outputLimit)&&outputLimit>0&&outputLimit<=512000,'ALPHA_IPC_INPUT_INVALID');
  signal?.throwIfAborted();need(io.now()<deadline,'RUN_TIMEOUT');
  const started=io.now(),hostNamespaces=io.namespaceIds();
  const args=['--cpu=5:5','--as=4294967296:4294967296','--fsize=1048576:1048576','--nofile=128:128','--',BIN,...alphaSandboxArguments(rootfs,phase)];
  return await new Promise((resolve,reject)=>{
    let child;try{child=io.spawn(LIMIT,args,{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe','pipe','pipe'],detached:true,shell:false});}catch(error){reject(Object.assign(Error('SANDBOX_LAUNCH_FAILED'),{code:'SANDBOX_LAUNCH_FAILED',observation:{launchAttempted:true,processGroupGone:false,privateNamespacesEnded:false}}));return;}
    let stdout=[],stderr=[],status=[],bytes=0,errors=0,statusBytes=0,problem=null,syncEnded=false,syncBytes=0,closed=false,exited=false,settled=false,exitStatus=null,exitSignal=null;
    let cleanupTimer;
    const groupGone=()=>{if(!Number.isInteger(child.pid)||child.pid<=0)return false;try{io.kill(-child.pid,0);return false;}catch(e){return e.code==='ESRCH';}};
    const kill=code=>{problem??=code;if(!exited&&Number.isInteger(child.pid)&&child.pid>0)try{io.kill(-child.pid,'SIGKILL');}catch{};if(!cleanupTimer)cleanupTimer=setTimeout(()=>finish(true),1000);};
    const abort=()=>kill('RUN_CANCELLED');
    const timer=setTimeout(()=>kill('RUN_TIMEOUT'),Math.max(1,deadline-io.now()));
    function finish(forced=false){
      if(settled||!forced&&!closed)return;
      if(!forced&&!syncEnded)return;
      settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);signal?.removeEventListener('abort',abort);
      let metadata=null,metadataError=null;
      try{metadata=parseAlphaStatus(Buffer.concat(status),hostNamespaces,{requireExit:false});}catch(e){metadataError=e.code||'ALPHA_STATUS_INVALID';}
      const gone=groupGone(),clean=gone&&syncEnded&&syncBytes===0&&metadata!==null;
      const errorText=Buffer.concat(stderr).toString('utf8').trim();
      const observation={backend:'linux-bwrap-alpha/v1',phase,launchAttempted:true,exitStatus,signal:exitSignal,stderr:/^[A-Z0-9_]{1,100}$/.test(errorText)?errorText:(errorText?'REDACTED_NON_CODE_STDERR':''),processGroupGone:gone,privateNamespacesEnded:clean,namespaceLifetimeEOF:syncEnded,status:metadata,stdoutBytes:bytes,stderrBytes:errors,statusBytes,wallMilliseconds:Math.ceil(io.now()-started),cpuLimitSeconds:5,addressSpaceBytes:ALPHA_IPC_LIMITS.addressSpaceBytes,network:'none',providerCalls:0,evidenceClass:io.evidenceClass};
      // EOF is accepted only together with private kernel namespace metadata from
      // trusted bwrap and process-group termination. It is never task output.
      try{
        need(clean,metadataError||'CLEANUP_UNCONFIRMED');need(!problem,problem);need(closed&&exitStatus===0&&metadata.exitCode===0,'ALPHA_WORKER_FAILED');
        const output=UTF8.decode(Buffer.concat(stdout));resolve({output,observation});
      }catch(e){e.observation=observation;reject(e);}
      if(forced){for(const stream of child.stdio??[])stream?.destroy?.();child.unref?.();}
    }
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>outputLimit)kill('ALPHA_OUTPUT_SIZE');else stdout.push(b);});
    child.stderr.on('data',b=>{errors+=b.length;if(errors>ALPHA_IPC_LIMITS.stderrBytes)kill('ERROR_LIMIT');else stderr.push(b);});
    child.stdio[3].on('data',b=>{statusBytes+=b.length;if(statusBytes>ALPHA_IPC_LIMITS.statusBytes)kill('ALPHA_STATUS_LIMIT');else status.push(b);});
    child.stdio[4].on('data',b=>{syncBytes+=b.length;kill('ALPHA_LIFETIME_CHANNEL_INVALID');});
    child.stdio[4].on('end',()=>{syncEnded=true;finish();});
    for(const stream of [child.stdout,child.stderr,child.stdio[3],child.stdio[4]])stream.on('error',()=>kill('ALPHA_IPC_FAILED'));
    child.stdin.on('error',()=>kill('ALPHA_STDIN_FAILED'));
    child.on('error',()=>kill('SANDBOX_LAUNCH_FAILED'));
    child.on('exit',()=>{exited=true;});
    child.on('close',(code,sig)=>{closed=true;exitStatus=code;exitSignal=sig;finish();});
    child.stdin.end(stdin);
    if(signal?.aborted)abort();
  });
}
export async function runAlphaPhase(options){
  trustedTool(BIN);trustedTool(LIMIT);
  return exerciseAlphaTransport(options,{spawn,kill:process.kill,now:()=>performance.now(),namespaceIds,evidenceClass:'NATIVE_FIXED_ALPHA_IPC'});
}

// Two fixed phases share one deadline; the second can never start unless the
// pinned validator's exact canonical mission was independently checked first.
// Test runners are explicitly labeled; they cannot become runtime admission.
export async function exerciseAlphaSequence({input,signal,revalidate},runner,{now=()=>performance.now(),evidenceClass='SYNTHETIC_ALPHA_SEQUENCE'}={}){
  const started=now(),deadline=started+ALPHA_IPC_LIMITS.wallMs,spec=validateAlphaInput(input),stdin=Buffer.from(spec.raw,'utf8');
  need(typeof revalidate==='function','ALPHA_REVALIDATION_REQUIRED');
  const observations=[];let inFlight=null;
  async function phase(name,outputLimit){
    signal?.throwIfAborted();await revalidate();signal?.throwIfAborted();need(now()<deadline,'RUN_TIMEOUT');
    inFlight=name;const result=await runner({phase:name,stdin:Buffer.from(stdin),outputLimit,deadline,signal});
    observations.push(result.observation);inFlight=null;need(now()<=deadline,'RUN_TIMEOUT');
    need(result.observation?.processGroupGone===true&&result.observation?.privateNamespacesEnded===true,'CLEANUP_UNCONFIRMED');return result.output;
  }
  const observation=()=>({backend:'linux-bwrap-alpha/v1',launchAttempted:observations.length>0,
    processGroupGone:observations.every(x=>x?.processGroupGone===true),privateNamespacesEnded:observations.every(x=>x?.privateNamespacesEnded===true),
    phases:observations,wallMilliseconds:Math.ceil(now()-started),limits:ALPHA_IPC_LIMITS,network:'none',providerCalls:0,evidenceClass});
  try{
    const alphaValidation=await phase('validate',spec.budget.validatorBytes);validateAlphaSpecValidation(input,alphaValidation);
    const alphaOutput=await phase('work',spec.budget.wireBytes),result={alphaOutput,alphaValidation};validateAlphaOutput(input,result);
    signal?.throwIfAborted();await revalidate();need(now()<=deadline,'RUN_TIMEOUT');
    return {result,observation:observation()};
  }catch(error){
    if(error.observation)observations.push(error.observation);
    else if(inFlight)observations.push({phase:inFlight,launchAttempted:true,processGroupGone:false,privateNamespacesEnded:false});
    error.observation=observation();throw error;
  }
}
export async function executeAlpha({role,task,signal,expectedHost,revalidate,inspectHost}){
  need(role==='agent'&&task?.action==='alpha-run','ROLE_ACTION_DENIED');validateAlphaInput(task.input);
  let runtime;
  try{runtime=requireAlphaRuntime();}catch(e){e.observation={backend:'linux-bwrap-alpha/v1',launchAttempted:false,processGroupGone:true,privateNamespacesEnded:true,network:'none',providerCalls:0};throw e;}
  need(expectedHost&&typeof expectedHost.identity==='string'&&expectedHost.alphaRuntimeIdentity===runtime.runtimeIdentity,'ALPHA_EXECUTION_BINDING_REQUIRED');
  need(typeof inspectHost==='function'&&typeof revalidate==='function','ALPHA_REVALIDATION_REQUIRED');
  const check=async()=>{
    signal?.throwIfAborted();await revalidate();const current=requireAlphaRuntime(),host=inspectHost();
    need(current.runtimeIdentity===runtime.runtimeIdentity&&host.alphaRun?.runtimeIdentity===runtime.runtimeIdentity,'ALPHA_RUNTIME_CHANGED');
    need(host.supported&&host.identity===expectedHost.identity&&host.backend===expectedHost.backend&&(host.bootId??null)===(expectedHost.bootId??null),'EXECUTION_HOST_CHANGED');
  };
  try{const result=await exerciseAlphaSequence({input:task.input,signal,revalidate:check},options=>runAlphaPhase({...options,rootfs:runtime.rootfs}),{evidenceClass:'NATIVE_FIXED_ALPHA_IPC'});result.observation.runtimeIdentity=runtime.runtimeIdentity;return result;}
  catch(error){if(error.observation)error.observation.runtimeIdentity=runtime.runtimeIdentity;throw error;}
}
