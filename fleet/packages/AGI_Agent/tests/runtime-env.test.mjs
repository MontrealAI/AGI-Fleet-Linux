import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {discoverRuntime as discoverVerifiedRuntime,runtimeEnvironment,inspectExecutable,probeDocker,runtimeFailureCode,runtimeOwnerAllowed} from '../compute/runtime-env.mjs';
import {gatewayWrapperPlan} from '../compute/gateway-wrapper.mjs';
import {runCLI} from '../compute/server.mjs';
const discoverRuntime=options=>discoverVerifiedRuntime({...options,verifyArtifact:()=>({schema:'isolated-runtime-test-fixture'})});

function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi runtime fixture '));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const profileDir=path.join(home,'.openclaw-agi-compute'),gatewayConfig=path.join(profileDir,'openclaw.json');fs.mkdirSync(profileDir,{recursive:true,mode:0o700});fs.writeFileSync(gatewayConfig,'{}',{mode:0o600});
 const dockerEntry=path.join(home,'Docker.app/Contents/Resources/bin/docker'),docker=path.join(home,'.docker/bin/docker'),entry=path.join(home,'.local/lib/openclaw/openclaw.mjs'),openclaw=path.join(home,'.local/bin/openclaw');
 for(const p of [dockerEntry,docker,entry,openclaw])fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});
 fs.writeFileSync(dockerEntry,'\x23!/bin/sh\nprintf \'29.8.0\\n\'\n',{mode:0o700});fs.symlinkSync(dockerEntry,docker);
 fs.writeFileSync(entry,`\x23!${process.execPath}\nimport {spawnSync} from 'node:child_process';import v8 from 'node:v8';
const args=process.argv.slice(2);if(args[0]==='--version')console.log('OpenClaw 2026.9.5 ec9c1a1');
else if(args[0]==='hold')setInterval(()=>{},1000);
else{const d=spawnSync('docker',['info','--format','{{.ServerVersion}}'],{encoding:'utf8'});if(d.status!==0){console.error('spawn docker ENOENT credential-secret');process.exitCode=1;}else console.log(JSON.stringify({args,docker:d.stdout.trim(),profile:process.env.OPENCLAW_PROFILE,state:process.env.OPENCLAW_STATE_DIR,config:process.env.OPENCLAW_CONFIG_PATH,port:process.env.OPENCLAW_GATEWAY_PORT,execArgv:process.execArgv,heapLimit:v8.getHeapStatistics().heap_size_limit,nodeOptions:process.env.NODE_OPTIONS,unexpected:process.env.AGI_SECRET_FIXTURE??null}));}
`,{mode:0o700});fs.symlinkSync(entry,openclaw);
 const node=path.join(home,'runtime/bin/node');fs.mkdirSync(path.dirname(node),{recursive:true,mode:0o700});fs.writeFileSync(node,"\x23!/bin/sh\nexec '"+process.execPath.replaceAll("'","'\\''")+"' \"$@\"\n",{mode:0o700});
 const c={home,node,openclaw,docker,profileDir,gatewayConfig,gatewayPort:18896,role:'agent'};
 return {c,entry,dockerEntry,docker,openclaw};
}

test('minimal service environment discovers Docker user symlink and validates pinned runtimes',t=>{
 const {c}=fixture(t),found=discoverRuntime({...c,pathValue:'/usr/bin:/bin'});
 assert.equal(found.docker,c.docker);assert.equal(found.openclaw,c.openclaw);assert.equal(found.versions.openclaw,'2026.9.5');
 assert.equal(found.executableIdentity.docker.sha256.length,64);
 const env=runtimeEnvironment({...c,...found});assert.ok(env.PATH.split(path.delimiter).includes(path.dirname(c.docker)));assert.equal(env.OPENCLAW_PROFILE,'agi-compute');assert.equal(env.OPENCLAW_STATE_DIR,c.profileDir);assert.equal(env.OPENCLAW_EXEC_SHELL_SNAPSHOT,'0');assert.equal(env.NODE_OPTIONS,undefined);
});

test('runCLI includes Docker under minimal service PATH and preserves exact quoted arguments',async t=>{
 const {c}=fixture(t),args=['fixture','argument with spaces',"quote'quoted",'--value=$HOME;echo injected'];
 const found=discoverRuntime({...c,pathValue:'/usr/bin:/bin'}),result=await runCLI({...c,...found},args,AbortSignal.timeout(5000));
 assert.equal(result.docker,'29.8.0');assert.deepEqual(result.args,args);assert.equal(result.state,c.profileDir);assert.equal(result.config,c.gatewayConfig);assert.equal(result.unexpected,null);
 const legacy={...c};delete legacy.docker;
 assert.equal((await runCLI(legacy,args,AbortSignal.timeout(5000))).docker,'29.8.0');
});

test('Gateway wrapper preserves profile, arguments and explicit measured 4096 MiB old-space control',t=>{
 const {c}=fixture(t),runtime={...c,...discoverRuntime(c)},plan=gatewayWrapperPlan(runtime);
 fs.mkdirSync(path.dirname(plan.path),{recursive:true,mode:0o700});fs.writeFileSync(plan.path,plan.content,{mode:plan.mode});
 const args=['gateway','--port','18896','argument with spaces',"quote'quoted"];
 const result=spawnSync(plan.path,args,{env:{PATH:'/usr/bin:/bin',AGI_SECRET_FIXTURE:'must not leak',NODE_OPTIONS:'--trace-warnings'},encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
 assert.deepEqual(value.args,args);assert.equal(value.docker,'29.8.0');assert.equal(value.profile,'agi-compute');assert.equal(value.port,'18896');assert.equal(value.state,c.profileDir);assert.equal(value.unexpected,null);assert.deepEqual(value.execArgv,['--max-old-space-size=4096']);assert.equal(value.nodeOptions,'--max-old-space-size=4096');const measured=spawnSync(process.execPath,['--max-old-space-size=4096','-e','console.log(require("node:v8").getHeapStatistics().heap_size_limit)'],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});assert.equal(measured.status,0);assert.equal(value.heapLimit,Number(measured.stdout.trim()));
 fs.appendFileSync(c.openclaw,'\n// changed after wrapper generation\n');const drift=spawnSync(plan.path,args,{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000});assert.notEqual(drift.status,0);assert.match(drift.stderr,/COMPUTE_RUNTIME_EXECUTABLE_CHANGED/);fs.writeFileSync(c.openclaw,fs.readFileSync(c.openclaw,'utf8').replace('\n// changed after wrapper generation\n',''));
 assert.equal(plan.installEnvironment.OPENCLAW_WRAPPER,plan.path);assert.equal(plan.installEnvironment.NODE_OPTIONS,'--max-old-space-size=4096');assert.equal(plan.heapMiB,4096);
 assert.equal(gatewayWrapperPlan({...runtime,gatewayHeapMiB:2048}).heapMiB,2048);
 assert.throws(()=>gatewayWrapperPlan({...runtime,gatewayHeapMiB:'4096; bad'}),/GATEWAY_HEAP_INVALID/);
});

test('executable symlink trust rejects writable targets, writable parents and swapped binaries',t=>{
 const f=fixture(t),runtime=discoverRuntime(f.c);
 assert.equal(inspectExecutable(f.c.docker,'docker',{home:f.c.home}).realPath,f.dockerEntry);
 fs.chmodSync(f.dockerEntry,0o600);assert.throws(()=>runtimeEnvironment({...f.c,...runtime}),/DOCKER_PERMISSION_DENIED/);fs.chmodSync(f.dockerEntry,0o700);
 fs.chmodSync(f.dockerEntry,0o777);assert.throws(()=>runtimeEnvironment({...f.c,...runtime}),/DOCKER_UNTRUSTED/);fs.chmodSync(f.dockerEntry,0o700);
 fs.chmodSync(path.dirname(f.c.docker),0o777);assert.throws(()=>runtimeEnvironment({...f.c,...runtime}),/DOCKER_UNTRUSTED/);fs.chmodSync(path.dirname(f.c.docker),0o700);
 fs.appendFileSync(f.dockerEntry,'# changed');assert.throws(()=>runtimeEnvironment({...f.c,...runtime}),/RUNTIME_EXECUTABLE_CHANGED/);
});

test('Docker diagnostics separate missing executable, unavailable engine, permissions and timeout without raw logs',t=>{
 const {c}=fixture(t);
 assert.deepEqual(probeDocker(c),{state:'PASS',code:'DOCKER_ENGINE_READY',version:'29.8.0',providerTested:false});
 for(const [result,code] of [
  [{status:1,stderr:'Cannot connect to the Docker daemon. credential-secret'},'COMPUTE_DOCKER_ENGINE_UNAVAILABLE'],
  [{status:1,stderr:'permission denied on docker.sock token-secret'},'COMPUTE_DOCKER_PERMISSION_DENIED'],
  [{status:null,error:{code:'ETIMEDOUT'},stderr:'private'},'COMPUTE_DOCKER_TIMEOUT'],
  [{status:1,stderr:'unexpected credential-secret'},'COMPUTE_DOCKER_FAILED']
 ]){const report=probeDocker(c,{run:(_exe,_args,opts)=>{assert.ok(opts.timeout<=10000);assert.equal(opts.shell,false);return result;}});assert.equal(report.state,'BLOCKED');assert.equal(report.code,code);assert.doesNotMatch(JSON.stringify(report),/secret|private/);}
 const missing=probeDocker({...c,docker:path.join(c.home,'absent')});assert.equal(missing.code,'COMPUTE_DOCKER_REQUIRED');
 assert.equal(runtimeFailureCode({stderr:'spawn docker ENOENT credential-secret'}),'COMPUTE_DOCKER_REQUIRED');
});

test('CLI cancellation terminates the spawned process and returns a bounded safe code',async t=>{
 const {c}=fixture(t);await assert.rejects(runCLI(c,['hold'],AbortSignal.timeout(150)),/COMPUTE_CLI_TIMEOUT/);
});


test('shared Mac installation owner must be an observed administrator; other user homes are not trusted',()=>{
 const calls=[],options={uid:504,platform:'darwin',run:(exe,args)=>{calls.push({exe,args});return {status:0,stdout:exe==='/usr/bin/id'?'localadmin\n':'yes localadmin is a member of admin\n'};}};
 assert.equal(runtimeOwnerAllowed(501,'/opt/homebrew/Cellar/node@24/bin/node',options),true);
 assert.deepEqual(calls[0],{exe:'/usr/bin/id',args:['-nu','501']});assert.deepEqual(calls[1],{exe:'/usr/sbin/dseditgroup',args:['-o','checkmember','-m','localadmin','admin']});
 assert.equal(runtimeOwnerAllowed(501,'/Users/other/.local/bin/openclaw',options),false);
 assert.equal(runtimeOwnerAllowed(501,'/Applications/Docker.app/Contents/Resources/bin/docker',{...options,run:()=>({status:1,stdout:''})}),false);
 assert.equal(runtimeOwnerAllowed(0,'/usr/bin/node',options),true);assert.equal(runtimeOwnerAllowed(504,'/Users/compute/.local/bin/openclaw',options),true);
});

test('Gateway prelaunch checks the captured exec target after its public symlink is replaced',t=>{
 const f=fixture(t),c={...f.c,...discoverRuntime(f.c)},plan=gatewayWrapperPlan(c);fs.mkdirSync(path.dirname(plan.path),{recursive:true,mode:0o700});fs.writeFileSync(plan.path,plan.content,{mode:plan.mode});
 const copy=path.join(path.dirname(f.entry),'unchanged.mjs');fs.copyFileSync(f.entry,copy);fs.chmodSync(copy,0o700);fs.unlinkSync(f.openclaw);fs.symlinkSync(copy,f.openclaw);fs.appendFileSync(f.entry,'\nthrow Error("should not execute");\n');
 const result=spawnSync(plan.path,['gateway'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000});assert.notEqual(result.status,0);assert.match(result.stderr,/COMPUTE_RUNTIME_EXECUTABLE_CHANGED/);assert.doesNotMatch(result.stderr,/should not execute/);
});


test('runtime admission refuses Node26 and tampered artifacts before OpenClaw execution',t=>{
 const {c}=fixture(t);let openclawRuns=0,artifactChecks=0;
 const run=(exe,args)=>{if(exe===c.node)return {status:0,stdout:'v26.1.0'};openclawRuns++;return {status:0,stdout:'OpenClaw 2026.9.5'};};
 assert.throws(()=>discoverVerifiedRuntime({...c,run,verifyArtifact:()=>{artifactChecks++;}}),/NODE_VERSION_UNSUPPORTED/);assert.equal(openclawRuns,0);assert.equal(artifactChecks,0);
 const goodNode=(exe,args)=>exe===c.node?{status:0,stdout:'v24.21.0'}:run(exe,args);
 assert.throws(()=>discoverVerifiedRuntime({...c,run:goodNode,verifyArtifact:()=>{throw Error('OPENCLAW_ARTIFACT_MISMATCH');}}),/OPENCLAW_ARTIFACT_MISMATCH/);assert.equal(openclawRuns,0);
});


test('private prepared runtime takes precedence without replacing the global installation',t=>{
 const f=fixture(t),privateBin=path.join(f.c.home,'.agi-genesis-runtime/openclaw-2026.9.5/node_modules/.bin');fs.mkdirSync(privateBin,{recursive:true,mode:0o700});
 const privateEntry=path.join(privateBin,'openclaw');fs.symlinkSync(f.entry,privateEntry);const before=fs.readFileSync(f.openclaw,'utf8'),options={...f.c};delete options.openclaw;
 const found=discoverRuntime(options);assert.equal(found.openclaw,privateEntry);assert.equal(fs.readFileSync(f.openclaw,'utf8'),before);
});
