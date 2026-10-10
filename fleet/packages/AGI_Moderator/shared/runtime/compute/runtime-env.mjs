import {roleContract,COMPUTE_ROLES,OPERATOR_ROLES,setupRole} from './roles.mjs';
import {linuxEnvironment} from './linux-host.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyRuntimeArtifact,runtimeArtifactLock} from './runtime-artifacts.mjs';

const fail=code=>{throw Error(code);};
const SHA=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const contains=(root,file)=>file===root||file.startsWith(root+path.sep);
const conventionalRoots=['/Applications/Docker.app','/opt/homebrew','/usr/local','/usr','/bin','/sbin'];
const cleanPath=p=>typeof p==='string'&&path.isAbsolute(p)&&!/[\x00-\x1f\x7f:]/.test(p);
export const RUNTIME_FAILURES=Object.freeze(['COMPUTE_DOCKER_REQUIRED','COMPUTE_DOCKER_UNTRUSTED','COMPUTE_DOCKER_PERMISSION_DENIED','COMPUTE_DOCKER_ENGINE_UNAVAILABLE','COMPUTE_DOCKER_TIMEOUT','COMPUTE_DOCKER_FAILED','OPENCLAW_NOT_INSTALLED','OPENCLAW_EXECUTABLE_UNTRUSTED','OPENCLAW_EXECUTABLE_PERMISSION_DENIED','OPENCLAW_VERSION_MISMATCH','OPENCLAW_ARTIFACT_MISMATCH','NODE_VERSION_UNSUPPORTED','COMPUTE_NODE_UNTRUSTED','COMPUTE_NODE_PERMISSION_DENIED','COMPUTE_RUNTIME_EXECUTABLE_CHANGED','COMPUTE_RUNTIME_PROFILE_INVALID']);

function adminOwner(uid,{platform=process.platform,run=spawnSync}={}) {
  if(platform!=='darwin')return false;
  const name=run('/usr/bin/id',['-nu',String(uid)],{encoding:'utf8',timeout:2000,maxBuffer:1024,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'},shell:false});
  const user=String(name.stdout??'').trim();
  if(name.status!==0||!/^[A-Za-z0-9_.-]{1,100}$/.test(user))return false;
  const check=run('/usr/sbin/dseditgroup',['-o','checkmember','-m',user,'admin'],{encoding:'utf8',timeout:2000,maxBuffer:1024,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'},shell:false});
  return check.status===0&&/^yes\b/i.test(String(check.stdout??'').trim());
}
export function runtimeOwnerAllowed(owner,file,options={}) {
  if(owner===0||owner===(options.uid??process.getuid?.()))return true;
  return conventionalRoots.some(root=>contains(root,file))&&adminOwner(owner,options);
}
export function runtimeOwnerChecker(options={}) {
  const cache=new Map(),uid=options.uid??process.getuid?.();
  return (owner,file)=>{
    if(owner===0||owner===uid)return true;
    if(!conventionalRoots.some(root=>contains(root,file)))return false;
    if(!cache.has(owner))cache.set(owner,adminOwner(owner,options));
    return cache.get(owner);
  };
}
function validateChain(file,allowedOwner,kind,platform=process.platform) {
  let current=file;
  for(;;){
    const s=fs.lstatSync(current),stickySystemDirectory=s.isDirectory()&&s.uid===0&&!!(s.mode&0o1000);
    if(!stickySystemDirectory&&(!allowedOwner(s.uid,current)||(!s.isSymbolicLink()&&((s.mode&0o002)!==0||((s.mode&0o020)!==0&&!(platform==='darwin'&&s.gid===80))))))fail(kind+'_UNTRUSTED');
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
}
export function inspectExecutable(file,kind,{home=os.homedir(),uid=process.getuid?.(),platform=process.platform,run=spawnSync}={}) {
  const prefix=kind==='openclaw'?'OPENCLAW_EXECUTABLE':kind==='node'?'COMPUTE_NODE':'COMPUTE_DOCKER';
  if(!cleanPath(file))fail(prefix+'_UNTRUSTED');
  try{
    const allowed=runtimeOwnerChecker({uid,platform,run});
    validateChain(file,allowed,prefix,platform);
    const realPath=fs.realpathSync(file),s=fs.statSync(realPath);
    validateChain(realPath,allowed,prefix,platform);
    if(!s.isFile()||!allowed(s.uid,realPath))fail(prefix+'_UNTRUSTED');
    try{fs.accessSync(realPath,fs.constants.X_OK);}catch{fail(prefix+'_PERMISSION_DENIED');}
    return {path:path.resolve(file),realPath,uid:s.uid,gid:s.gid,mode:s.mode&0o777,size:s.size,sha256:SHA(fs.readFileSync(realPath))};
  }catch(e){
    if(e.code==='ENOENT'||e.code==='ENOTDIR')fail(kind==='docker'?'COMPUTE_DOCKER_REQUIRED':kind==='openclaw'?'OPENCLAW_NOT_INSTALLED':'NODE_VERSION_UNSUPPORTED');
    if(e.code==='EACCES'||e.code==='EPERM')fail(prefix+'_PERMISSION_DENIED');
    throw e;
  }
}
function candidates(kind,{home=os.homedir(),pathValue=process.env.PATH??''}={}) {
  const system=['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin'];
  const known=kind==='docker'?[path.join(home,'.docker/bin'),'/Applications/Docker.app/Contents/Resources/bin']:kind==='openclaw'?[path.join(home,'.agi-genesis-runtime','openclaw-'+runtimeArtifactLock.openclaw.version,'node_modules/.bin'),path.join(home,'.local/bin'),path.join(home,'.npm-global/bin')]:['/opt/homebrew/opt/node@24/bin','/usr/local/opt/node@24/bin'];
  return [...new Set([...known,...system,...pathValue.split(path.delimiter).filter(p=>p&&path.isAbsolute(p))].map(p=>path.join(p,kind)))];
}
function findExecutable(kind,options={}) {
  if(options[kind])return inspectExecutable(options[kind],kind,options);
  let unsafe=null;
  for(const file of candidates(kind,options))try{return inspectExecutable(file,kind,options);}catch(e){if(!['COMPUTE_DOCKER_REQUIRED','OPENCLAW_NOT_INSTALLED','NODE_VERSION_UNSUPPORTED'].includes(e.message))unsafe=e;}
  if(unsafe)throw unsafe;
  fail(kind==='docker'?'COMPUTE_DOCKER_REQUIRED':kind==='openclaw'?'OPENCLAW_NOT_INSTALLED':'NODE_VERSION_UNSUPPORTED');
}
function profileFields(c) {
  if(!c.profileDir&&!c.gatewayConfig)return {};
  if(!cleanPath(c.profileDir)||!cleanPath(c.gatewayConfig)||path.dirname(path.resolve(c.gatewayConfig))!==path.resolve(c.profileDir))fail('COMPUTE_RUNTIME_PROFILE_INVALID');
  const profile=roleContract(c.role).profile;
  return {OPENCLAW_PROFILE:profile,OPENCLAW_STATE_DIR:c.profileDir,OPENCLAW_CONFIG_PATH:c.gatewayConfig,...(Number.isInteger(c.gatewayPort)?{OPENCLAW_GATEWAY_PORT:String(c.gatewayPort)}:{})};
}
function environment(c,identities) {
  if(!cleanPath(c.home))fail('COMPUTE_RUNTIME_PROFILE_INVALID');
  const dirs=[identities.node,identities.openclaw,identities.docker].flatMap(x=>[path.dirname(x.path),path.dirname(x.realPath)]);
  const env={HOME:c.home,PATH:[...new Set([...dirs,'/usr/bin','/bin','/usr/sbin','/sbin'])].join(path.delimiter),LANG:'en_US.UTF-8',NODE_DISABLE_COMPILE_CACHE:'1',OPENCLAW_EXEC_SHELL_SNAPSHOT:'0',...profileFields(c)};
  return {...env,...(c.deploymentPlatform==='linux'?linuxEnvironment(c.home):{})};
}
export function discoverRuntime({home=os.homedir(),node=process.execPath,...options}={}) {
  const inputs={...options,home,node},identities={node:findExecutable('node',inputs),openclaw:findExecutable('openclaw',inputs),docker:findExecutable('docker',inputs)};
  const found={home,...(options.linux===true?{deploymentPlatform:'linux'}:{}),node:identities.node.path,openclaw:identities.openclaw.path,docker:identities.docker.path,executableIdentity:{schema:1,...identities}};
  const env=environment(found,identities),run=options.run??spawnSync;
  const n=run(found.node,['--version'],{env,encoding:'utf8',timeout:5000,maxBuffer:65536,shell:false});
  const match=/^v24\.(\d+)\.(\d+)$/.exec(String(n.stdout??'').trim());
  if(n.status!==0||!match||Number(match[1])<19)fail('NODE_VERSION_UNSUPPORTED');
  const artifact=(options.verifyArtifact??verifyRuntimeArtifact)(found.openclaw,{platform:options.platform,allowedOwner:runtimeOwnerChecker({uid:options.uid,platform:options.platform,run})});
  const oc=run(found.openclaw,['--version'],{env,encoding:'utf8',timeout:5000,maxBuffer:65536,shell:false});
  if(oc.status!==0||!/(^|\s)2026\.9\.5($|\s)/.test(String(oc.stdout??'').trim()))fail('OPENCLAW_VERSION_MISMATCH');
  return {...found,artifact,versions:{node:String(n.stdout).trim().replace(/^v/,''),openclaw:runtimeArtifactLock.openclaw.version}};
}
export function runtimeEnvironment(c,options={}) {
  const inputs={...options,home:c.home,node:c.node,openclaw:c.openclaw,...(c.docker?{docker:c.docker}:{})};
  const identities={node:findExecutable('node',inputs),openclaw:findExecutable('openclaw',inputs),docker:findExecutable('docker',inputs)};
  if(c.executableIdentity){
    if(c.executableIdentity.schema!==1)fail('COMPUTE_RUNTIME_EXECUTABLE_CHANGED');
    for(const kind of ['node','openclaw','docker']){
      const expected=c.executableIdentity[kind],actual=identities[kind];
      if(!expected||['path','realPath','uid','gid','mode','size','sha256'].some(k=>expected[k]!==actual[k]))fail('COMPUTE_RUNTIME_EXECUTABLE_CHANGED');
    }
  }
  return environment(c,identities);
}
export function runtimeFailureCode(result,{dockerOnly=false}={}) {
  if(result?.error?.code==='ETIMEDOUT'||result?.signal==='SIGTERM'&&result?.error)return dockerOnly?'COMPUTE_DOCKER_TIMEOUT':'COMPUTE_CLI_TIMEOUT';
  const text=String(result?.stderr??'').slice(0,8192).toLowerCase(),docker=dockerOnly||text.includes('docker');
  if(docker&&(result?.error?.code==='EACCES'||/permission denied|access denied/.test(text)))return 'COMPUTE_DOCKER_PERMISSION_DENIED';
  if(docker&&(result?.error?.code==='ENOENT'||/docker.*(?:enoent|not found)|spawn docker/.test(text)))return 'COMPUTE_DOCKER_REQUIRED';
  if(docker&&/cannot connect|connection refused|daemon is not running|daemon not running|is the docker daemon running|error during connect/.test(text))return 'COMPUTE_DOCKER_ENGINE_UNAVAILABLE';
  return dockerOnly?'COMPUTE_DOCKER_FAILED':'COMPUTE_INFERENCE_FAILED';
}
export function probeDocker(c,{run=spawnSync,timeoutMs=5000}={}) {
  try{
    const env=runtimeEnvironment(c),docker=c.docker??findExecutable('docker',{home:c.home,pathValue:env.PATH}).path;
    const result=run(docker,['info','--format','{{.ServerVersion}}'],{env,encoding:'utf8',timeout:Math.min(10000,Math.max(100,timeoutMs)),maxBuffer:65536,shell:false});
    const version=String(result.stdout??'').trim();
    if(result.status===0&&/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9_.-]+)?$/.test(version))return {state:'PASS',code:'DOCKER_ENGINE_READY',version,providerTested:false};
    return {state:'BLOCKED',code:runtimeFailureCode(result,{dockerOnly:true}),providerTested:false};
  }catch(e){return {state:'BLOCKED',code:RUNTIME_FAILURES.includes(e.message)?e.message:'COMPUTE_DOCKER_FAILED',providerTested:false};}
}
