import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {sandboxScopeKey,sandboxWorkspaceRoot,isSandboxScopeKey} from '../shared/runtime/compute/sandbox-scope.mjs';
import {cleanupSandboxTargets} from '../packages/AGI_Agent/shared/runtime/compute/sandbox-cleanup.mjs';
import {readCleanupEvidence} from '../shared/runtime/compute/cleanup-evidence.mjs';

const upstream=new URL('../evidence/upstream/openclaw-2026.9.5/',import.meta.url);
function source(relative){return fs.readFileSync(new URL(relative,upstream),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function pinnedLayout(){
 const context=vm.createContext({path,os,process:{env:{}},tryProcessCwd:()=>'/tmp',resolveEffectiveHomeDir:()=>'/tmp',resolveOsHomeDir:()=>'/tmp',normalizeHomeDirValue:v=>v,hashTextSha256:hash,normalizeLowercaseStringOrEmpty:value=>String(value).trim().toLowerCase(),normalizeAgentId:value=>value,resolveAgentIdFromSessionKey:value=>value.split(':')[1],DEFAULT_AGENT_WORKSPACE_DIR:'/fixture/default',SANDBOX_STATE_DIR:'/fixture/state',resolveMaterializedSandboxSkillsWorkspaceDir:value=>value});
 vm.runInContext(stripTypeScriptTypes(source('src/infra/home-dir.ts').replace(/^\{ resolveEffectiveHomeDir, resolveOsHomeDir \};$/m,'')),context);
 vm.runInContext(stripTypeScriptTypes(source('src/agents/sandbox/shared.ts')),context);
 return args=>context.resolveSandboxWorkspaceLayoutPaths(args);
}
function pinnedCommand(entries){
 const removed=[];
 const context=vm.createContext({listSandboxContainers:async()=>entries.filter(x=>!x.browser),listSandboxBrowsers:async()=>entries.filter(x=>x.browser),removeSandboxContainer:async name=>removed.push(name),removeSandboxBrowserContainer:async name=>removed.push(name),displayRecreatePreview:()=>{},displayRecreateResult:()=>{},formatCliCommand:x=>x,formatErrorMessage:()=>'',clackConfirm:async()=>false});
 vm.runInContext(stripTypeScriptTypes(source('src/commands/sandbox.ts')),context);
 return {removed,run:opts=>context.sandboxRecreateCommand(opts,{log:()=>{},error:()=>{},exit:code=>{throw Error('upstream-exit-'+code);}})};
}
const session='agent:agi-creator:agi-work-12345678-1234-1234-1234-123456789abc';
test('adapter matches the pinned workspace-qualified upstream key and workspace path',()=>{
 const layout=pinnedLayout();
 for(const workspace of ['/Users/compute/.openclaw-agi-compute/workspace','/Users/Compute With Spaces/workspace','/tmp/école/workspace']){
  const c={workspace,jobRoot:'/tmp/jobs'},up=layout({cfg:{scope:'session',workspaceAccess:'none',workspaceRoot:c.jobRoot},rawSessionKey:session,agentId:'agi-creator',workspaceDir:workspace});
  assert.equal(sandboxScopeKey(c,session),up.scopeKey);assert.equal(sandboxWorkspaceRoot(c,session),up.workspaceDir);assert.ok(isSandboxScopeKey(up.scopeKey,session));
 }
});
test('failing-before: pinned recreate with raw job key reports success while retaining both runtimes',async()=>{
 const c={workspace:'/Users/compute/workspace'},scope=sandboxScopeKey(c,session),cli=pinnedCommand([{sessionKey:scope,containerName:'base'},{sessionKey:scope,containerName:'browser',browser:true}]);
 for(const browser of [false,true])await cli.run({session,browser,force:true});
 assert.deepEqual(cli.removed,[]);
});
test('passing-after: Fleet submits the exact scope to pinned recreate and proves both postconditions',async t=>{
 const profileDir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'scope-compatibility-'));t.after(()=>fs.rmSync(profileDir,{recursive:true,force:true}));
 const c={profileDir,workspace:path.join(profileDir,'workspace'),workstation:true},scope=sandboxScopeKey(c,session),cli=pinnedCommand([{sessionKey:scope,containerName:'base'},{sessionKey:scope,containerName:'browser',browser:true},{sessionKey:scope+'unrelated',containerName:'unrelated'}]);
 const worker={c,stopForCleanup:()=>{throw Error('unexpected-stop');},cleanupInventory:async(_c,key,target)=>{assert.equal(key,scope);return {status:'CAPTURED',containerIDs:cli.removed.includes(target)?[]:[(target==='base'?'a':'b').repeat(64)]};},cli:async(_c,args)=>{await cli.run({session:args[3],browser:args.includes('--browser'),force:args.includes('--force')});return {ok:true,exitStatus:0,signal:null,elapsedMs:1,timedOut:false,started:true,processTerminationConfirmed:true};}};
 await cleanupSandboxTargets(worker,'agi-creator',session,{phase:'post-run',trigger:'finalize'});
 assert.deepEqual(cli.removed,['base','browser']);const evidence=readCleanupEvidence(profileDir);assert.equal(evidence.status,'PASS');assert.equal(evidence.records.length,2);assert.ok(evidence.records.every(x=>x.sandboxScopeKey===scope&&x.dockerAfter.containerIDs.length===0));
});
test('scope adapter refuses broadened, malformed and ambiguous paths',()=>{
 for(const invalid of ['shared',session+':workspace:'+'a'.repeat(32),session.replace('agi-creator','agi-checker')])assert.throws(()=>sandboxScopeKey({workspace:'/tmp/workspace'},invalid));
 for(const workspace of ['relative','/tmp/a/../b','/tmp/workspace/','/tmp/workspace ','/tmp/a\nsecret'])assert.throws(()=>sandboxScopeKey({workspace},session));
 assert.equal(isSandboxScopeKey(session+':workspace:'+'a'.repeat(31),session),false);
});
