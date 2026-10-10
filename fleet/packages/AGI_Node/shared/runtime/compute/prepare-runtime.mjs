import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runtimeArtifactLock,verifyRuntimeArtifact} from './runtime-artifacts.mjs';
import {inspectExecutable,runtimeOwnerChecker} from './runtime-env.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
const targetVersion=runtimeArtifactLock.openclaw.version;
// Respect an existing network proxy without inheriting npm configuration or Node flags.
const networkProxyEnvironment=()=>Object.fromEntries(['HTTPS_PROXY','HTTP_PROXY','NO_PROXY','https_proxy','http_proxy','no_proxy'].filter(key=>typeof process.env[key]==='string'&&process.env[key].length<=8192).map(key=>[key,process.env[key]]));
export function privateRuntimePath(home=os.homedir()){return path.join(home,'.agi-genesis-runtime','openclaw-'+targetVersion);}
export function lockedRuntimePackage(){
  const spec=runtimeArtifactLock.openclaw.consumerPackage;
  const packageBytes=fs.readFileSync(new URL('./'+spec.packageFile,import.meta.url)),lockBytes=fs.readFileSync(new URL('./'+spec.lockFile,import.meta.url));
  if(hash(packageBytes)!==spec.packageSHA256||hash(lockBytes)!==spec.lockSHA256)fail('RUNTIME_INSTALL_LOCK_MISMATCH');
  const lock=JSON.parse(lockBytes),pkg=JSON.parse(packageBytes);
  if(lock.lockfileVersion!==3||pkg.dependencies.openclaw!==runtimeArtifactLock.openclaw.tarball||lock.packages[''].dependencies.openclaw!==pkg.dependencies.openclaw)fail('RUNTIME_INSTALL_LOCK_MISMATCH');
  for(const [name,item]of Object.entries(lock.packages)){
    if(!name)continue;
    if(item.link||!/^https:\/\/registry\.npmjs\.org\/[A-Za-z0-9@/_.%-]+\.tgz$/.test(item.resolved??'')||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity??''))fail('RUNTIME_INSTALL_UNPINNED_DEPENDENCY');
  }
  const oc=lock.packages['node_modules/openclaw'];
  if(oc.version!==targetVersion||oc.integrity!==runtimeArtifactLock.openclaw.integrity)fail('RUNTIME_INSTALL_LOCK_MISMATCH');
  return {packageBytes,lockBytes,lockSHA256:spec.lockSHA256};
}
function privateDirectory(dir,create=false){
  if(!fs.existsSync(dir)){if(!create)fail('RUNTIME_INSTALL_STATE_INVALID');fs.mkdirSync(dir,{mode:0o700});}
  const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077))fail('RUNTIME_INSTALL_STATE_INVALID');
}
function npmCLI(node){
  for(const entry of [path.join(path.dirname(node),'npm'),path.resolve(path.dirname(node),'../lib/node_modules/npm/bin/npm-cli.js')]){
    try{const found=inspectExecutable(entry,'node');if(path.basename(found.realPath)==='npm-cli.js')return found.realPath;}catch{}
  }
  fail('RUNTIME_INSTALL_NPM_REQUIRED');
}
function probeLockedNative(directory,node,home,run){
  const packageRoot=path.join(directory,'node_modules/openclaw'),env={HOME:home,PATH:[path.dirname(node),'/usr/bin','/bin'].join(path.delimiter),LANG:'en_US.UTF-8'};
    const result=run(node,[fileURLToPath(new URL('./runtime-native-probe.mjs',import.meta.url)),'--probe',packageRoot],{cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:65536,shell:false});
    let status;try{status=JSON.parse(String(result.stdout??'').trim()).status;}catch{}
    if(result.status!==0||status!=='ready')fail('RUNTIME_INSTALL_NATIVE_REQUIRED');
}
function completeLockedLifecycle(directory,node,home,run){
  const packageRoot=path.join(directory,'node_modules/openclaw'),env={HOME:home,PATH:[path.dirname(node),'/usr/bin','/bin'].join(path.delimiter),LANG:'en_US.UTF-8'};
  const probe=()=>probeLockedNative(directory,node,home,run);
  probe();
  // Upstream's supported switch skips prune/native-repair downloads. Direct
  // invocation still performs its official package-local lifecycle completion.
  const done=run(node,[path.join(packageRoot,'scripts/postinstall-bundled-plugins.mjs')],{cwd:directory,env:{...env,OPENCLAW_DISABLE_BUNDLED_PLUGIN_POSTINSTALL:'1'},encoding:'utf8',timeout:30000,maxBuffer:65536,shell:false});
  if(done.status!==0||fs.existsSync(path.join(packageRoot,'.openclaw-lifecycle-pending')))fail('RUNTIME_INSTALL_LIFECYCLE_INCOMPLETE');
  probe();
}
export function prepareRuntime({home=os.homedir(),node=process.execPath,run=spawnSync,verifyArtifact=verifyRuntimeArtifact,progress=console.log}={}){
  if(!path.isAbsolute(home)||Number(process.versions.node.split('.')[0])!==24||Number(process.versions.node.split('.')[1])<19)fail('NODE_VERSION_UNSUPPORTED');
  inspectExecutable(node,'node',{home});
  const target=privateRuntimePath(home),parent=path.dirname(target),locked=lockedRuntimePackage();privateDirectory(parent,true);
  const verify=directory=>verifyArtifact(path.join(directory,'node_modules/openclaw/openclaw.mjs'),{allowedOwner:runtimeOwnerChecker()});
  if(fs.existsSync(target)){
    privateDirectory(target);const receiptFile=path.join(target,'agi-runtime-receipt.json'),s=fs.lstatSync(receiptFile);
    if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077))fail('RUNTIME_INSTALL_STATE_INVALID');
    const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
    if(receipt.schema!=='agi-private-runtime-install/v1'||receipt.approvedPackageLifecycleCompletion!==true||receipt.nativeRepairDownloadsAllowed!==false||receipt.lockSHA256!==locked.lockSHA256||hash(fs.readFileSync(path.join(target,'package-lock.json')))!==locked.lockSHA256)fail('RUNTIME_INSTALL_LOCK_MISMATCH');
    verify(target);if(fs.existsSync(path.join(target,'node_modules/openclaw/.openclaw-lifecycle-pending')))fail('RUNTIME_INSTALL_LIFECYCLE_INCOMPLETE');probeLockedNative(target,node,home,run);progress('The verified private OpenClaw '+targetVersion+' runtime is already prepared.');return {path:target,reused:true};
  }
  const staging=path.join(parent,'.preparing-'+targetVersion+'-'+crypto.randomUUID());fs.mkdirSync(staging,{mode:0o700});
  try{
    fs.writeFileSync(path.join(staging,'package.json'),locked.packageBytes,{mode:0o600});fs.writeFileSync(path.join(staging,'package-lock.json'),locked.lockBytes,{mode:0o600});
    const config=path.join(staging,'npm-user-config'),globalConfig=path.join(staging,'npm-global-config');fs.writeFileSync(config,'',{mode:0o600});fs.writeFileSync(globalConfig,'',{mode:0o600});
    progress('Preparing OpenClaw '+targetVersion+' in a separate private runtime. The existing installation and agent profiles remain in place.');
    const npm=npmCLI(node),cache=path.join(staging,'npm-download-cache');
    const args=['--use-system-ca',npm,'ci','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache='+cache,'--userconfig='+config,'--globalconfig='+globalConfig];
    const result=run(node,args,{cwd:staging,env:{...networkProxyEnvironment(),HOME:home,PATH:[path.dirname(node),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),LANG:'en_US.UTF-8',CI:'true'},encoding:'utf8',timeout:15*60*1000,maxBuffer:20*1024*1024,shell:false});
    fs.writeFileSync(path.join(staging,'npm-install.log'),String(result.stdout??'')+'\n'+String(result.stderr??''),{mode:0o600});
    if(result.status!==0)fail('RUNTIME_INSTALL_DOWNLOAD_FAILED');
    if(hash(fs.readFileSync(path.join(staging,'package-lock.json')))!==locked.lockSHA256)fail('RUNTIME_INSTALL_LOCK_MISMATCH');
    verify(staging);completeLockedLifecycle(staging,node,home,run);const artifact=verify(staging);
    const receipt={schema:'agi-private-runtime-install/v1',version:targetVersion,createdAt:new Date().toISOString(),lockSHA256:locked.lockSHA256,packageTarballSHA256:artifact.packageTarballSha256,packageInventorySHA256:artifact.packageInventorySha256,npmLifecycleScriptsRun:false,approvedPackageLifecycleCompletion:true,nativeRepairDownloadsAllowed:false,nativeProbe:'ready',profileAccessed:false,globalInstallChanged:false,platform:process.platform,architecture:process.arch,nodeVersion:process.version,limits:['npm verifies locked download integrity; target-platform native execution requires separate qualification.']};
    fs.writeFileSync(path.join(staging,'agi-runtime-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
    fs.rmSync(cache,{recursive:true,force:true});
    if(fs.existsSync(target))fail('RUNTIME_INSTALL_TARGET_EXISTS');fs.renameSync(staging,target);
    progress('Private runtime verified. Next, open Repair-Compute.command and collect a fresh report. Existing OAuth and transaction evidence were not accessed.');return {path:target,reused:false};
  }catch(error){
    fs.writeFileSync(path.join(staging,'agi-runtime-failure.json'),JSON.stringify({schema:'agi-private-runtime-failure/v1',code:/^[A-Z_]+$/.test(error.message)?error.message:'RUNTIME_INSTALL_FAILED',profileAccessed:false,globalInstallChanged:false},null,2)+'\n',{mode:0o600});
    progress('Runtime preparation stopped. Its private staging folder was preserved for diagnosis; the existing installation was not replaced.');throw error;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{prepareRuntime();}catch(error){
    const code=/^[A-Z_]+$/.test(error.message)?error.message:'RUNTIME_INSTALL_FAILED';
    const messages={RUNTIME_INSTALL_DOWNLOAD_FAILED:'The locked downloads did not complete. Check the network connection and try this preparation step again.',RUNTIME_INSTALL_NATIVE_REQUIRED:'The required native component did not pass its local check. Keep the preserved staging evidence for review; no automatic replacement download was attempted.',RUNTIME_INSTALL_LIFECYCLE_INCOMPLETE:'Runtime completion needs review. The existing runtime and profile remain available.',RUNTIME_INSTALL_STATE_INVALID:'The private runtime folder could not be safely verified. Keep it intact for review.',RUNTIME_INSTALL_LOCK_MISMATCH:'The runtime lock did not match this release. Extract a fresh verified release folder before retrying.',OPENCLAW_ARTIFACT_MISMATCH:'OpenClaw package files did not match the verified release. Keep the staged evidence for review.'};
    console.error('Preparation stopped: '+code);console.error(messages[code]??'The existing installation was not replaced. Keep the preserved staging evidence for review.');process.exitCode=1;
  }
}
