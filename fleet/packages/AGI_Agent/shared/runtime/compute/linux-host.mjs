import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {roleContract} from './roles.mjs';
import {consumerCompute,consumerFile} from './consumer.mjs';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export function linuxReleaseVersion(){const version=JSON.parse(fs.readFileSync(consumerFile('package.json'),'utf8')).version;need(typeof version==='string'&&/^\d+\.\d+\.\d+$/.test(version),'LINUX_RELEASE_IDENTITY_INVALID');return version;}
export const PRIVILEGED_GROUPS=new Set(['root','sudo','wheel','admin','docker','lxd','incus','incus-admin','disk','shadow','kmem']);
export function linuxStandardGroups(result){
 if(result?.status!==0||result.error||result.signal||typeof result.stdout!=='string')return false;
 const groups=result.stdout.trim().split(/\s+/);return groups.length>0&&groups.every(g=>/^[a-zA-Z0-9_.-]+$/.test(g)&&!PRIVILEGED_GROUPS.has(g));
}
export function privateObject(file,{uid=process.getuid(),directory=false,mode}={}){
 const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&s.uid===uid&&!(s.mode&0o077)&&(directory?s.isDirectory():s.isFile()&&s.nlink===1),'LINUX_PRIVATE_PATH_REQUIRED');
 if(mode!==undefined)need((s.mode&0o777)===mode,'LINUX_PRIVATE_PATH_REQUIRED');
 need(fs.realpathSync(file)===path.resolve(file),'LINUX_CANONICAL_PATH_REQUIRED');return s;
}
export function linuxEnvironment(home=os.homedir(),uid=process.getuid()){
 need(Number.isSafeInteger(uid)&&uid>=1000&&path.isAbsolute(home),'LINUX_STANDARD_ACCOUNT_REQUIRED');
 const runtime='/run/user/'+uid;
 privateObject(runtime,{uid,directory:true});
 for(const name of ['bus','docker.sock']){const s=fs.lstatSync(path.join(runtime,name));need(s.isSocket()&&!s.isSymbolicLink()&&s.uid===uid&&(name==='bus'||!(s.mode&0o007)),'LINUX_USER_SOCKET_REQUIRED');}
 return {XDG_RUNTIME_DIR:runtime,DBUS_SESSION_BUS_ADDRESS:'unix:path='+runtime+'/bus',DOCKER_HOST:'unix://'+runtime+'/docker.sock'};
}
export function assertLinuxHost({home=os.homedir(),uid=process.getuid(),signerUID,docker='/usr/bin/docker',run=spawnSync}={}){
 need(process.platform==='linux'&&['x64','arm64'].includes(process.arch),'LINUX_PLATFORM_REQUIRED');
 const release=fs.readFileSync('/etc/os-release','utf8');need(/^ID=ubuntu$/m.test(release)&&/^VERSION_ID="24\.04"$/m.test(release),'UBUNTU_24_04_REQUIRED');
 need(uid>=1000&&(!signerUID||uid!==signerUID),'LINUX_STANDARD_ACCOUNT_REQUIRED');privateObject(home,{uid,directory:true});
 need(linuxStandardGroups(run('/usr/bin/id',['-Gn'],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}})),'LINUX_STANDARD_ACCOUNT_REQUIRED');
 const env={HOME:home,PATH:'/usr/bin:/bin',LC_ALL:'C',...linuxEnvironment(home,uid)};
 const manager=run('/usr/bin/systemctl',['--user','show-environment'],{env,encoding:'utf8',timeout:5000,maxBuffer:262144});need(manager.status===0&&!manager.error&&!manager.signal,'LINUX_USER_MANAGER_REQUIRED');
 const r=run(docker,['info','--format','{{json .}}'],{env,encoding:'utf8',timeout:10000,maxBuffer:262144});need(r.status===0&&!r.error&&!r.signal,'LINUX_ROOTLESS_DOCKER_REQUIRED');
 let d;try{d=JSON.parse(r.stdout);}catch{throw Error('LINUX_ROOTLESS_DOCKER_REQUIRED');}
 assertRootlessInfo(d);return {platform:'linux',distribution:'Ubuntu',version:'24.04',uid,dockerVersion:d.ServerVersion,rootless:true,cgroupVersion:2};
}
export function assertRootlessInfo(d){
 need(d?.ServerVersion==='29.8.2'&&d.OSType==='linux'&&Array.isArray(d.SecurityOptions)&&d.SecurityOptions.includes('name=rootless'),'LINUX_ROOTLESS_DOCKER_REQUIRED');
 need(String(d.CgroupVersion)==='2'&&d.CgroupDriver==='systemd'&&d.MemoryLimit===true&&d.SwapLimit===true&&d.PidsLimit===true&&(d.CpuCfsQuota===true||d.CPUCfsQuota===true),'LINUX_CGROUP_LIMITS_REQUIRED');return true;
}
export function unitQuote(value){need(typeof value==='string'&&!/[\x00-\x1f\x7f]/.test(value),'LINUX_UNIT_VALUE_INVALID');return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',()=> '$$')+'"';}
export function unitDirectory(value){need(typeof value==='string'&&/^\/[a-zA-Z0-9_./%-]+$/.test(value),'LINUX_UNIT_DIRECTORY_INVALID');return value.replaceAll('%','%%');}
export function linuxUnitNames(role){const c=roleContract(role);return {compute:c.computeLabel+'.service',gateway:c.gatewayLabel+'.service'};}
export function linuxUnitPlan(c,environment){
 need(c.deploymentPlatform==='linux'&&c.profileDir===path.join(c.home,'.openclaw-'+roleContract(c.role).profile),'LINUX_SERVICE_IDENTITY');
 const names=linuxUnitNames(c.role),directory=path.join(c.home,'.config/systemd/user');
 const env={...environment};
 need(Object.values(env).every(x=>typeof x==='string'&&x!==c.token&&x!==c.gatewayToken),'LINUX_SERVICE_SECRET_FORBIDDEN');
 const base=(target,args)=>`[Unit]\nDescription=AGI ${c.role} ${target}\nRequires=docker.service${target==='compute'?' '+names.gateway:''}\nAfter=docker.service${target==='compute'?' '+names.gateway:''}\nBindsTo=docker.service\nStartLimitIntervalSec=120\nStartLimitBurst=5\n[Service]\nType=simple\nWorkingDirectory=${unitDirectory(c.profileDir)}\nExecStart=/usr/bin/env -i ${Object.entries(env).map(([k,v])=>unitQuote(k+'='+v)).join(' ')} ${args.map(unitQuote).join(' ')}\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=20\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=yes\nUnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH NODE_OPTIONS NODE_PATH\nLimitCORE=0\nStandardOutput=journal\nStandardError=journal\n[Install]\nWantedBy=default.target\n`;
 const files={};
 files[path.join(directory,names.gateway)]=base('gateway',[c.gatewayWrapper,'--profile',roleContract(c.role).profile,'gateway','run','--port',String(c.gatewayPort)]);
 files[path.join(directory,names.compute)]=base('compute',[c.node,path.join(consumerCompute,'server.mjs'),path.join(c.profileDir,'compute-settings.json')]);
 return {directory,names,files};
}
export function linuxServiceAuthority(c,environment){const p=linuxUnitPlan(c,environment);return {schema:'agi-linux-systemd-authority/v1',files:Object.fromEntries(Object.entries(p.files).map(([f,text])=>[f,hash(text)]))};}
function safeDirectory(file){const s=fs.lstatSync(file);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o022)&&fs.realpathSync(file)===path.resolve(file),'LINUX_PRIVATE_PATH_REQUIRED');}
function userDirectories(home){let p=home;privateObject(p,{directory:true});for(const part of ['.config','systemd','user']){p=path.join(p,part);if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});safeDirectory(p);}return p;}
export function assertLinuxServiceIntegrity(c,{loaded=false}={}){
 need(c.linuxServiceAuthority?.schema==='agi-linux-systemd-authority/v1','LINUX_SERVICE_IDENTITY');const names=Object.values(linuxUnitNames(c.role)).map(n=>path.join(c.home,'.config/systemd/user',n)).sort();
 need(JSON.stringify(Object.keys(c.linuxServiceAuthority.files).sort())===JSON.stringify(names),'LINUX_SERVICE_IDENTITY');
 let parent=c.home;privateObject(parent,{directory:true});for(const part of ['.config','systemd','user']){parent=path.join(parent,part);safeDirectory(parent);}
 for(const file of names){privateObject(file);need(hash(fs.readFileSync(file))===c.linuxServiceAuthority.files[file],'LINUX_SERVICE_CHANGED');
  need(!fs.existsSync(file+'.d'),'LINUX_SERVICE_OVERRIDE_UNREVIEWED');
  if(loaded){const observed=systemctl(c,['show',path.basename(file),'--property=FragmentPath,DropInPaths,NeedDaemonReload']);const values=Object.fromEntries(String(observed.stdout??'').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));need(observed.status===0&&!observed.error&&!observed.signal&&values.FragmentPath===file&&values.DropInPaths===''&&values.NeedDaemonReload==='no','LINUX_LOADED_SERVICE_UNVERIFIED');}
 }
 return true;
}
export function installLinuxServices(c,environment){
 const plan=linuxUnitPlan(c,environment),authority=linuxServiceAuthority(c,environment);
 need(JSON.stringify(authority)===JSON.stringify(c.linuxServiceAuthority),'LINUX_SERVICE_CHANGED');userDirectories(c.home);
 for(const [file,content]of Object.entries(plan.files)){
  need(!fs.existsSync(file+'.d'),'LINUX_SERVICE_ALREADY_EXISTS');if(fs.lstatSync(file,{throwIfNoEntry:false})){privateObject(file);need(hash(fs.readFileSync(file))===authority.files[file],'LINUX_SERVICE_CHANGED');continue;}
  const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 assertLinuxServiceIntegrity(c);return authority;
}
export function systemctl(c,args,{timeoutMs=15000}={}){
 return spawnSync('/usr/bin/systemctl',['--user',...args],{env:{HOME:c.home,PATH:'/usr/bin:/bin',LC_ALL:'C',...linuxEnvironment(c.home)},encoding:'utf8',timeout:timeoutMs,maxBuffer:262144,shell:false});
}
export function startLinuxService(c,target){
 assertLinuxServiceIntegrity(c);const name=linuxUnitNames(c.role)[target];need(name,'LINUX_SERVICE_IDENTITY');
 const reload=systemctl(c,['daemon-reload']);need(reload.status===0&&!reload.error&&!reload.signal,'LINUX_SERVICE_START_FAILED');
 const r=systemctl(c,['enable','--now',name],{timeoutMs:30000});need(r.status===0&&!r.error&&!r.signal,'LINUX_SERVICE_START_FAILED');
 const observed=systemctl(c,['show',name,'--property=FragmentPath,DropInPaths,ActiveState,MainPID']);const v=Object.fromEntries(String(observed.stdout??'').trim().split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
 need(observed.status===0&&!observed.error&&!observed.signal&&v.FragmentPath===path.join(c.home,'.config/systemd/user',name)&&v.DropInPaths===''&&v.ActiveState==='active'&&/^\d+$/.test(v.MainPID)&&Number(v.MainPID)>0,'LINUX_LOADED_SERVICE_UNVERIFIED');return {status:0,stdout:'',stderr:''};
}
export async function stopLinuxServices({home,role,probePort,checkSockets,signal,run,onDiagnostics,timeoutMs=20000}){
 const start=performance.now(),contract=roleContract(role),names=linuxUnitNames(role),evidence={schema:'agi-linux-service-stop/v1',state:'waiting',servicesStopped:false,portsClosed:false,socketsAbsent:false,elapsedMs:0};
 const bounded=async work=>{signal?.throwIfAborted();const remaining=Math.floor(timeoutMs-(performance.now()-start));need(remaining>0,'SETUP_SERVICE_STOP_UNCONFIRMED');const controller=new AbortController();let timer;const cancel=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('SETUP_SERVICE_STOP_UNCONFIRMED'));},remaining);controller.signal.addEventListener('abort',()=>reject(Error('SETUP_SERVICE_STOP_UNCONFIRMED')),{once:true});})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();}};
 const command=args=>{signal?.throwIfAborted();const remaining=Math.floor(timeoutMs-(performance.now()-start));need(remaining>0,'SETUP_SERVICE_STOP_UNCONFIRMED');const r=(run??((a,t)=>systemctl({home},a,{timeoutMs:t})))(args,Math.min(5000,remaining));need(!r.error&&!r.signal&&Number.isInteger(r.status),'SETUP_SERVICE_STOP_UNCONFIRMED');return r;};
 try{
  for(const name of Object.values(names))command(['stop',name]);
  while(performance.now()-start<timeoutMs){
   let stopped=true;
   for(const name of Object.values(names)){
    const r=command(['show',name,'--property=LoadState,ActiveState,SubState,MainPID']);const s=Object.fromEntries(String(r.stdout??'').trim().split('\n').map(l=>l.split('=')));
    need(r.status===0&&['loaded','not-found'].includes(s.LoadState)&&/^(0|[1-9]\d*)$/.test(s.MainPID??''),'SETUP_SERVICE_STOP_UNCONFIRMED');
    stopped&&=(['inactive','failed'].includes(s.ActiveState)&&Number(s.MainPID)===0);
   }
   evidence.servicesStopped=stopped;evidence.portsClosed=!(await bounded(s=>probePort(contract.port,s)))&&!(await bounded(s=>probePort(contract.gatewayPort,s)));
   if(stopped&&evidence.portsClosed){evidence.socketsAbsent=await bounded(s=>checkSockets(s));if(evidence.socketsAbsent===true){evidence.state='passed';return evidence;}}
   await new Promise(r=>setTimeout(r,Math.min(200,Math.max(1,timeoutMs-(performance.now()-start)))));
  }
  throw Error('SETUP_SERVICE_STOP_UNCONFIRMED');
 }catch(e){evidence.state='failed';evidence.failureCode=/^[A-Z_]+$/.test(e.message)?e.message:'SETUP_SERVICE_STOP_UNCONFIRMED';throw e;}
 finally{evidence.elapsedMs=Math.floor(performance.now()-start);onDiagnostics?.({...evidence});}
}
