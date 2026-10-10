import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectExecutable,runtimeOwnerChecker} from './runtime-env.mjs';
import {runtimeArtifactLock,verifyRuntimeArtifact} from './runtime-artifacts.mjs';

const fail=code=>{throw Error(code);};
const identityKeys=['path','realPath','uid','gid','mode','size','sha256'];
const terminalKeys=['USER','LOGNAME','TMPDIR','LANG','LC_ALL','TERM','SHELL','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS'];
export function selectedOpenClawEnvironment(runtime,source=process.env){
 const ids=runtime.executableIdentity;
 return {...Object.fromEntries(terminalKeys.filter(key=>typeof source[key]==='string').map(key=>[key,source[key]])),HOME:runtime.home,
  PATH:[...new Set([path.dirname(ids.node.realPath),path.dirname(ids.node.path),path.dirname(ids.openclaw.path),path.dirname(ids.openclaw.realPath),'/usr/bin','/bin','/usr/sbin','/sbin'])].join(path.delimiter),OPENCLAW_EXEC_SHELL_SNAPSHOT:'0'};
}
/** Shared setup admission without requiring Docker for a tool-less reviewer.
 * The private prepared runtime is preferred; a present but invalid installation
 * fails closed. Neither global installation nor installed profile is changed.
 */
export function selectOpenClawRuntime({home=os.homedir(),node=process.execPath,openclaw,pathValue=process.env.PATH??'',run=spawnSync,verifyArtifact=verifyRuntimeArtifact}={}){
 const nodeIdentity=inspectExecutable(node,'node',{home});
 const candidates=openclaw?[openclaw]:[path.join(home,'.agi-genesis-runtime','openclaw-'+runtimeArtifactLock.openclaw.version,'node_modules/.bin/openclaw'),
  ...[path.join(home,'.local/bin'),path.join(home,'.npm-global/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin',...pathValue.split(path.delimiter).filter(dir=>dir&&path.isAbsolute(dir))].map(dir=>path.join(dir,'openclaw'))];
 let openclawIdentity;
 for(const file of [...new Set(candidates)]){
  try{fs.lstatSync(file);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')continue;throw error;}
  openclawIdentity=inspectExecutable(file,'openclaw',{home});break;
 }
 if(!openclawIdentity)fail('OPENCLAW_NOT_INSTALLED');
 const runtime={home,node:nodeIdentity.path,openclaw:openclawIdentity.path,executableIdentity:{schema:1,node:nodeIdentity,openclaw:openclawIdentity}};
 const env=selectedOpenClawEnvironment(runtime),options={env,encoding:'utf8',timeout:5000,maxBuffer:65536,shell:false};
 const result=run(nodeIdentity.realPath,['--version'],options),version=/^v24\.(\d+)\.(\d+)$/.exec(String(result.stdout??'').trim());
 if(result.status!==0||!version||Number(version[1])<19)fail('NODE_VERSION_UNSUPPORTED');
 const artifact=verifyArtifact(openclawIdentity.realPath,{allowedOwner:runtimeOwnerChecker()});
 if(artifact.version!==runtimeArtifactLock.openclaw.version)fail('OPENCLAW_ARTIFACT_MISMATCH');
 const oc=run(nodeIdentity.realPath,[openclawIdentity.realPath,'--version'],options);
 const escaped=runtimeArtifactLock.openclaw.version.replaceAll('.','\\.');
 if(oc.status!==0||!new RegExp('(^|\\s)'+escaped+'($|\\s)').test(String(oc.stdout??'').trim()))fail('OPENCLAW_VERSION_MISMATCH');
 return {...runtime,artifact,versions:{node:String(result.stdout).trim().slice(1),openclaw:runtimeArtifactLock.openclaw.version}};
}
export function runSelectedOpenClaw(runtime,args,{capture=false,run=spawnSync}={}){
 for(const kind of ['node','openclaw']){
  const actual=inspectExecutable(runtime[kind],kind,{home:runtime.home}),expected=runtime.executableIdentity[kind];
  if(identityKeys.some(key=>actual[key]!==expected[key]))fail('COMPUTE_RUNTIME_EXECUTABLE_CHANGED');
 }
 return run(runtime.executableIdentity.node.realPath,[runtime.executableIdentity.openclaw.realPath,...args],{
  env:selectedOpenClawEnvironment(runtime),encoding:'utf8',stdio:capture?'pipe':'inherit',timeout:900000,maxBuffer:2*1024*1024,shell:false});
}
export function openClawShellCommand(runtime,args){
 const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
 return [runtime.executableIdentity.node.realPath,runtime.executableIdentity.openclaw.realPath,...args].map(quote).join(' ');
}
