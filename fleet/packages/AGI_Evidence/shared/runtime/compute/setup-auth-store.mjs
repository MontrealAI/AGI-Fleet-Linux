import {ALL_OAUTH_ROLES} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inspectExecutable,runtimeOwnerChecker} from './runtime-env.mjs';
import {verifyRuntimeArtifact} from './runtime-artifacts.mjs';
import {treeIdentity} from './setup-transaction.mjs';

const PROFILE='openai:agi-compute-pro';
const SDK_EXPORT='openclaw/plugin-sdk/provider-auth';
const SDK_SHA256='da1c1b7c46afaa074d935bd7ff8141b00e88895b7c778fd3e6527fbcea0bb5dd';
const VERSION='2026.9.5';
const failure=()=>{throw Error('OPENCLAW_AUTH_ORDER_FAILED');};
const need=ok=>{if(!ok)failure();};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const within=(a,b)=>b===a||b.startsWith(a+path.sep);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
function owned(file,{directory=false,privateMode=false}={}){
 const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(directory?s.isDirectory():s.isFile()));
 if(privateMode)need((s.mode&0o077)===0);return s;
}
function candidateContext({candidate,profileDir,agent,transactionId}){
 need(ALL_OAUTH_ROLES.includes(agent));
 need(path.isAbsolute(candidate)&&path.isAbsolute(profileDir));
 candidate=path.resolve(candidate);profileDir=path.resolve(profileDir);
 need(!within(candidate,profileDir)&&!within(profileDir,candidate));
 const directory=path.dirname(candidate);need(path.basename(candidate)==='candidate');
 owned(directory,{directory:true,privateMode:true});owned(candidate,{directory:true,privateMode:true});
 need(fs.realpathSync(candidate)===candidate&&fs.realpathSync(directory)===directory);
 const transactionFile=path.join(directory,'transaction.json');owned(transactionFile,{privateMode:true});
 const state=JSON.parse(fs.readFileSync(transactionFile,'utf8'));
 need(state.schema===1&&state.treeIdentityVersion===3&&state.stagingProtocolVersion===2&&state.state==='prepared'&&state.profileDir===profileDir&&typeof state.id==='string'&&(!transactionId||state.id===transactionId));
 const agentDir=path.join(candidate,'agents',agent,'agent');
 for(const p of [path.join(candidate,'agents'),path.dirname(agentDir),agentDir])owned(p,{directory:true,privateMode:true});
 owned(path.join(candidate,'openclaw.json'),{privateMode:true});
 // The established v3 walk rejects redirected state and durable symlinks; only
 // the generated top-level plugin-skills directory has its narrow exclusion.
 treeIdentity(candidate);
 return {candidate,profileDir,agent,agentDir,transactionId:state.id,baseIdentity:state.baseIdentity};
}
function selectedSDK(packageRoot){
 const manifestPath=path.join(packageRoot,'package.json');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 need(manifest.name==='openclaw'&&manifest.version===VERSION);
 const exported=manifest.exports?.['./plugin-sdk/provider-auth'];
 need(exported?.default==='./dist/plugin-sdk/provider-auth.js');
 const sdk=createRequire(manifestPath).resolve(SDK_EXPORT);
 need(sdk===path.join(packageRoot,'dist/plugin-sdk/provider-auth.js')&&fs.realpathSync(sdk)===sdk);
 need(sha(fs.readFileSync(sdk))===SDK_SHA256);return sdk;
}
function childEnvironment(runtime,context){
 // An isolated process prevents cached module state from selecting the live
 // owner. No ambient tokens, NODE_OPTIONS, provider credentials or CLI-auth
 // discovery enter this process. Installed Gateway registration is untouched.
 return {HOME:context.candidate,PATH:[path.dirname(runtime.node),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),LANG:'en_US.UTF-8',NODE_NO_WARNINGS:'1',OPENCLAW_STATE_DIR:context.candidate,OPENCLAW_CONFIG_PATH:path.join(context.candidate,'openclaw.json'),OPENCLAW_AGENT_DIR:context.agentDir,OPENCLAW_EXEC_SHELL_SNAPSHOT:'0'};
}
function protectedDigest(store){
 // This value is internal IPC only and is discarded before producing a receipt.
 // Credential material never appears in subprocess output or support reports.
 const copy={...store,order:{...store.order}};delete copy.order.openai;
 // The SDK derives this runtime ownership marker from the order just written.
 // Retain and compare all other providers and every credential/state field.
 if(Array.isArray(copy.runtimeLocalOrderProviderIds))copy.runtimeLocalOrderProviderIds=copy.runtimeLocalOrderProviderIds.filter(provider=>provider!=='openai');
 return sha(canonical(copy));
}
async function worker(input){
 const context=candidateContext(input);const sdkPath=selectedSDK(input.packageRoot);
 const {updateAuthProfileStoreWithLock,ensureAuthProfileStore,resolveAuthProfileOrder}=await import(pathToFileURL(sdkPath).href);
 need(typeof updateAuthProfileStoreWithLock==='function'&&typeof ensureAuthProfileStore==='function'&&typeof resolveAuthProfileOrder==='function');
 const readOptions={readOnly:true,syncExternalCli:false,allowKeychainPrompt:false,externalCli:{mode:'none'}};
 const initial=ensureAuthProfileStore(context.agentDir,readOptions);
 need(initial.profiles?.[PROFILE]?.provider==='openai'&&initial.profiles[PROFILE].type==='oauth');
 // Credentials may be inherited from the candidate's shared owner. Preserve
 // that ownership: write a role-local order, never copy a credential.
 const effectiveCredentials=sha(canonical(initial.profiles));
 let localProtectedSha256;
 const result=await updateAuthProfileStoreWithLock({
  agentDir:context.agentDir,stateDir:context.candidate,sharedStoreWrite:false,
  saveOptions:{preserveOrderProfileIds:[PROFILE],syncExternalCli:false},
  updater:store=>{
   if(store.profiles?.[PROFILE])need(store.profiles[PROFILE].provider==='openai'&&store.profiles[PROFILE].type==='oauth');
   localProtectedSha256=protectedDigest(store);
   if(input.mode==='verify'){need(canonical(store.order?.openai)===canonical([PROFILE]));return false;}
   need(input.mode==='stage');
   if(canonical(store.order?.openai)===canonical([PROFILE]))return false;
   store.order={...store.order,openai:[PROFILE]};return true;
  }
 });
 need(result&&localProtectedSha256&&canonical(result.order?.openai)===canonical([PROFILE]));
 const read=ensureAuthProfileStore(context.agentDir,readOptions);
 need(sha(canonical(read.profiles))===effectiveCredentials);
 need(canonical(read.order?.openai)===canonical([PROFILE]));
 need(canonical(resolveAuthProfileOrder({store:read,provider:'openai'}))===canonical([PROFILE]));
 return {ok:true,protectedSha256:sha(canonical({localProtectedSha256,effectiveCredentials}))};
}

/** Stage one role through OpenClaw's public, locked SQLite auth-store SDK.
 * This is deliberately separate from the CLI's installed-Gateway mutation
 * route: no guard is disabled, service registration edited, or schema written.
 */
export function stageCandidateAuthOrder({runtime,candidate,profileDir,agent,run=spawnSync}){
 try{
  const context=candidateContext({candidate,profileDir,agent});
  need(treeIdentity(context.profileDir)===context.baseIdentity);
  const node=inspectExecutable(runtime.node,'node',{home:runtime.home});
  const openclaw=inspectExecutable(runtime.openclaw,'openclaw',{home:runtime.home});
  for(const [kind,actual] of [['node',node],['openclaw',openclaw]]){
   const expected=runtime.executableIdentity?.[kind];need(expected&&['path','realPath','uid','gid','mode','size','sha256'].every(k=>expected[k]===actual[k]));
  }
  const artifact=verifyRuntimeArtifact(openclaw.realPath,{allowedOwner:runtimeOwnerChecker()});
  need(artifact.version===VERSION);selectedSDK(artifact.packageRoot);
  const invoke=mode=>{
   const result=run(node.realPath,[fileURLToPath(import.meta.url),'--auth-store-worker'],{input:JSON.stringify({...context,packageRoot:artifact.packageRoot,mode}),env:childEnvironment({...runtime,node:node.realPath},context),cwd:context.candidate,encoding:'utf8',timeout:120000,maxBuffer:65536,shell:false});
   need(result.status===0&&!result.error&&!result.signal);
   const response=JSON.parse(result.stdout);need(response.ok===true&&/^[a-f0-9]{64}$/.test(response.protectedSha256));return response;
  };
  const staged=invoke('stage'),verified=invoke('verify');
  need(staged.protectedSha256===verified.protectedSha256);
  candidateContext(context);need(treeIdentity(context.profileDir)===context.baseIdentity);
  return {agent,provider:'openai',order:[PROFILE],storage:'openclaw-agent-sqlite',verified:true};
 }catch{failure();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--auth-store-worker'){
 try{const result=await worker(JSON.parse(fs.readFileSync(0,'utf8')));process.stdout.write(JSON.stringify(result));}
 catch{process.stdout.write('{"ok":false}');process.exitCode=1;}
}
