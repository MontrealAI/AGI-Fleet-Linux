import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {ROOT,need,keys,digest,canonical,parseStrict} from '../contracts.mjs';

import {inspectAlphaPackage} from '../alpha/package.mjs';
import {executeAlpha} from '../alpha/ipc.mjs';
import {inspectComputerInstallation} from '../computer/profile.mjs';
import {executeComputer} from '../computer/backend.mjs';

const BIN='/usr/bin/bwrap', LIMIT='/usr/bin/prlimit';
function trusted(file,own=false) { const s=fs.statSync(file);need(s.isFile()&&(s.uid===0||own&&s.uid===process.getuid())&&!(s.mode&0o022),'SANDBOX_EXECUTABLE_UNTRUSTED');return fs.realpathSync(file); }
export function sandboxArguments() {
  const a=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--clearenv','--setenv','PATH','/usr/bin','--setenv','HOME','/nonexistent','--setenv','LANG','C.UTF-8','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--chdir','/tmp'];
  for(const dir of ['/lib','/lib64','/usr/lib','/usr/lib64'])if(fs.existsSync(dir))a.push('--ro-bind',dir,dir);
  a.push('--ro-bind',trusted(process.execPath,true),'/node','--dir','/app','--dir','/app/fleet');
  for(const rel of ['local-runtime','fleet/shared','fleet/successor','fleet/node_modules','fleet/packages/AGI_Agent/src/admission-core','fleet/packages/AGI_Node/src']) {
    const file=path.join(ROOT,rel);need(fs.statSync(file).isDirectory(),'INSTALLATION_INCOMPLETE');a.push('--ro-bind',file,'/app/'+rel);
  }
  return a;
}
// Kernel namespace identifiers are uint64-scale decimal IDs, not unbounded
// worker text. Together with safe integers, these fields have a fixed JSON
// ceiling before they enter a successful native receipt.
export function validateWorkerObservation(w){
  keys(w,['pidNamespace','networkNamespace','userCPUMicroseconds','systemCPUMicroseconds','maxRSSKiB','taskMilliseconds']);
  need(/^pid:\[\d{1,20}\]$/.test(w.pidNamespace)&&/^net:\[\d{1,20}\]$/.test(w.networkNamespace),'WORKER_OBSERVATION_INVALID');
  for(const key of ['userCPUMicroseconds','systemCPUMicroseconds','maxRSSKiB','taskMilliseconds'])need(Number.isSafeInteger(w[key])&&w[key]>=0,'WORKER_OBSERVATION_INVALID');
  return w;
}
export class LinuxSandbox {
  constructor({computerConfigFile=null}={}){this.computerConfigFile=computerConfigFile;}
  inspect() {
    const {profile:privateProfile,...alphaComputer}=inspectComputerInstallation(this.computerConfigFile);
    const report={schema:'agi-fleet/local-host/v1',platform:process.platform,arch:process.arch,backend:'linux-bwrap-offline/v1',execution:'this host',inference:'none',network:'none',files:'per-run input only; no host writes',browser:'BLOCKED',desktop:'BLOCKED',productionQualified:false,physical:'NOT_RUN',supported:false,alphaRun:inspectAlphaPackage(),alphaComputer};
    try {
      need(process.platform==='linux'&&['x64','arm64'].includes(process.arch),'PLATFORM_NOT_QUALIFIED');
      need(process.versions.node.split('.')[0]==='24'&&Number(process.versions.node.split('.')[1])>=19,'NODE_VERSION_UNSUPPORTED');
      trusted(BIN);trusted(LIMIT);
      const p=spawnSync(BIN,[...sandboxArguments(),'--','/node','--version'],{encoding:'utf8',timeout:5000,maxBuffer:8192,env:{PATH:'/usr/bin:/bin'}});
      if(p.error||p.status!==0||p.stdout.trim()!==process.version){
        const reason=String(p.stderr||'');
        const code=p.error?.code==='ETIMEDOUT'?'SANDBOX_PROBE_TIMEOUT':/namespace|Operation not permitted|Permission denied/i.test(reason)?'SANDBOX_NAMESPACE_DENIED':/chdir/i.test(reason)?'SANDBOX_WORKING_DIRECTORY':/execvp|shared libraries|No such file/i.test(reason)?'SANDBOX_LOADER_UNAVAILABLE':'SANDBOX_UNAVAILABLE';
        need(false,code);
      }
      const bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
      return {...report,supported:true,observedAt:Date.now(),bootId,identity:digest({backend:report.backend,node:digest(fs.readFileSync(process.execPath)),sandbox:digest(fs.readFileSync(BIN)),limiter:digest(fs.readFileSync(LIMIT)),platform:process.platform,arch:process.arch,os:os.release(),boot:bootId,alphaRuntimeIdentity:report.alphaRun.runtimeIdentity??null,alphaTrustLockSha256:report.alphaRun.trustLockSha256??null,alphaComputerRuntimeIdentity:alphaComputer.runtimeIdentity??null})};
    }catch(e){return {...report,code:e.code==='ENOENT'?'SANDBOX_PREREQUISITE_MISSING':e.code||e.message,help:'Use the documented Linux prerequisites and rerun doctor. No host-shell fallback is permitted. Browser, desktop and macOS local execution require separate implementation and qualification.'};}
  }
  async execute({role,task,directory,signal,expectedHost,revalidate,approval,computerHome}) {
    if(task?.action==='alpha-computer-run')return executeComputer({configFile:this.computerConfigFile,role,task,directory,signal,expectedHost,revalidate,approval,home:computerHome});
    if(task?.action==='alpha-run')return executeAlpha({role,task,signal,expectedHost,revalidate,inspectHost:()=>this.inspect()});
    const started=performance.now();
    need(expectedHost&&typeof expectedHost.identity==='string'&&typeof expectedHost.backend==='string','EXECUTION_BINDING_REQUIRED');
    const ready=this.inspect();need(ready.supported,ready.code);
    if(ready.identity!==expectedHost.identity||ready.backend!==expectedHost.backend||(ready.bootId??null)!==(expectedHost.bootId??null))
      throw Object.assign(new Error('EXECUTION_HOST_CHANGED'),{code:'EXECUTION_HOST_CHANGED',observation:{backend:'linux-bwrap-offline/v1',launchAttempted:false,reason:'EXECUTION_HOST_CHANGED',network:'none',providerCalls:0}});
    const input=path.join(directory,'task.json');fs.writeFileSync(input,canonical({role,task}),{flag:'wx',mode:0o600});
    const command=[...sandboxArguments(),'--ro-bind',input,'/input/task.json','--chdir','/tmp','--','/node','--max-old-space-size=128','--v8-pool-size=1','/app/local-runtime/worker.mjs'];
    signal?.throwIfAborted();
    return await new Promise((resolve,reject)=>{
      const child=spawn(LIMIT,['--cpu=10','--as=4294967296','--fsize=1048576','--nofile=128','--',BIN,...command],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe'],detached:true,shell:false});
      let stdout=[],stderr=[],bytes=0,errors=0,problem=null,exited=false;
      const kill=code=>{problem??=code;try{process.kill(-child.pid,'SIGKILL');}catch{}};
      const abort=()=>kill('RUN_CANCELLED');signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>kill('RUN_TIMEOUT'),15000);
      child.stdout.on('data',b=>{bytes+=b.length;if(bytes>2_000_000)kill('OUTPUT_LIMIT');else stdout.push(b);});
      child.stderr.on('data',b=>{errors+=b.length;if(errors>8192)kill('ERROR_LIMIT');else stderr.push(b);});
      child.on('error',()=>{problem='SANDBOX_LAUNCH_FAILED';});
      child.on('close',(status,exitSignal)=>{
        exited=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
        let groupGone=false;try{process.kill(-child.pid,0);}catch(e){groupGone=e.code==='ESRCH';}
        const code=Buffer.concat(stderr).toString().trim();
        const observation={backend:ready.backend,exitStatus:status,signal:exitSignal,stderr:/^[A-Z0-9_]{1,100}$/.test(code)?code:(code?'REDACTED_NON_CODE_STDERR':''),processGroupGone:groupGone,privateNamespacesEnded:groupGone,network:'none',providerCalls:0};
        try{
          need(groupGone,'CLEANUP_UNCONFIRMED');need(!problem,problem);need(status===0,'WORKER_FAILED');
          const envelope=parseStrict(Buffer.concat(stdout).toString(),2_000_000);keys(envelope,['result','workerObservation']);
          const w=validateWorkerObservation(envelope.workerObservation),wallMilliseconds=Math.ceil(performance.now()-started);
          need(Number.isSafeInteger(wallMilliseconds)&&wallMilliseconds>=0,'WORKER_OBSERVATION_INVALID');
          resolve({result:envelope.result,observation:{...observation,worker:w,wallMilliseconds}});
        }catch(e){e.observation=observation;reject(e);}
      });
      if(signal?.aborted&&!exited)abort();
    });
  }
}
