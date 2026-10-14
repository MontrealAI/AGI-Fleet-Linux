import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {ROOT,need,digest,canonical,parseStrict} from '../contracts.mjs';

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
export class LinuxSandbox {
  inspect() {
    const report={schema:'agi-fleet/local-host/v1',platform:process.platform,arch:process.arch,backend:'linux-bwrap-offline/v1',execution:'this host',inference:'none',network:'none',files:'per-run input only; no host writes',browser:'BLOCKED',desktop:'BLOCKED',productionQualified:false,physical:'NOT_RUN',supported:false};
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
      return {...report,supported:true,observedAt:Date.now(),bootId,identity:digest({backend:report.backend,node:digest(fs.readFileSync(process.execPath)),sandbox:digest(fs.readFileSync(BIN)),platform:process.platform,arch:process.arch,os:os.release(),boot:bootId})};
    }catch(e){return {...report,code:e.code==='ENOENT'?'SANDBOX_PREREQUISITE_MISSING':e.code||e.message,help:'Use the documented Linux prerequisites and rerun doctor. No host-shell fallback is permitted. Browser, desktop and macOS local execution require separate implementation and qualification.'};}
  }
  async execute({role,task,directory,signal}) {
    const ready=this.inspect();need(ready.supported,ready.code);
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
        try{need(groupGone,'CLEANUP_UNCONFIRMED');need(!problem,problem);need(status===0,'WORKER_FAILED');const result=parseStrict(Buffer.concat(stdout).toString(),2_000_000);resolve({result,observation});}catch(e){e.observation=observation;reject(e);}
      });
      if(signal?.aborted&&!exited)abort();
    });
  }
}
