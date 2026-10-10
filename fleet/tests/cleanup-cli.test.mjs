import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url)),runnerRoot=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'agi-cleanup-runner-'));
fs.mkdirSync(path.join(runnerRoot,'compute'));
fs.copyFileSync(path.join(sourceRoot,'shared/runtime/compute/cli-process.mjs'),path.join(runnerRoot,'compute/cli-process.mjs'));
fs.symlinkSync(path.join(sourceRoot,'shared/runtime/compute/runtime-env.mjs'),path.join(runnerRoot,'compute/runtime-env.mjs'));
fs.symlinkSync(path.join(sourceRoot,'packages/AGI_Agent/src'),path.join(runnerRoot,'src'));
const {runCLI,runDiagnosticCommand}=await import(pathToFileURL(path.join(runnerRoot,'compute/cli-process.mjs')));
after(()=>fs.rmSync(runnerRoot,{recursive:true,force:true}));

function fixture(t,body){
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'agi-cleanup-cli-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const openclaw=path.join(home,'openclaw.mjs'),docker=path.join(home,'docker'),node=path.join(home,'node');
  fs.writeFileSync(node,"\u0023!/bin/sh\nexec '"+process.execPath.replaceAll("'","'\\''")+"' \"$@\"\n",{mode:0o700});
  fs.writeFileSync(openclaw,`\u0023!/usr/bin/env node\n${body}\n`,{mode:0o700});
  fs.writeFileSync(docker,'\u0023!/bin/sh\nprintf \'fixture-container-id\\n\'\n',{mode:0o700});
  return {home,profileDir:home,gatewayConfig:path.join(home,'openclaw.json'),node,openclaw,docker,role:'agent'};
}
const cleanup=['sandbox','recreate','--session','agent:agi-creator:agi-work-cli-fixture','--force'];
function facts(value,{started=true,exitStatus=0,signal=null,timedOut=false,timeoutMs=null,confirmed=true}={}){
  assert.equal(value.started,started);assert.equal(value.exitStatus,exitStatus);assert.equal(value.signal,signal);assert.equal(value.timedOut,timedOut);assert.equal(value.timeoutMs,timeoutMs);assert.equal(value.processTerminationConfirmed,confirmed);
  assert.ok(Number.isSafeInteger(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=2147483647);
  assert.doesNotMatch(JSON.stringify(value),/raw-secret|oauth-secret|provider-secret|\"stderr\"|\"args\"|\"env\"/);
}
async function failure(promise){try{await promise;assert.fail('Expected a classified process failure');}catch(error){assert.ok(error.code);assert.equal(error.message,error.code);assert.equal(error.failureCode,error.code);return error;}}

test('base and browser recreate retain scalar success evidence without command output',async t=>{
  for(const browser of [false,true]){
    const c=fixture(t,"console.log('provider-secret');console.error('oauth-secret');");
    const result=await runCLI(c,[...cleanup,...(browser?['--browser']:[])],undefined,{timeoutMs:5000});
    assert.equal(result.ok,true);assert.equal(result.failureCode,null);facts(result,{timeoutMs:5000});assert.equal(result.stdout,undefined);
  }
});

test('ordinary inference retains its original JSON shape',async t=>{
  for(const value of [{answer:'ok',data:[1,2]},null,false]){
    const c=fixture(t,`console.log(${JSON.stringify(JSON.stringify(value))});`);
    assert.deepEqual(await runCLI(c,['infer'],AbortSignal.timeout(5000)),value);
  }
});

test('nonzero exit preserves sanitized Docker classification and status',async t=>{
  const c=fixture(t,"console.error('Cannot connect to the Docker daemon oauth-secret provider-secret');process.exitCode=17;");
  const error=await failure(runCLI(c,cleanup,AbortSignal.timeout(5000)));
  assert.equal(error.code,'COMPUTE_DOCKER_ENGINE_UNAVAILABLE');facts(error,{exitStatus:17});
});

test('unexpected stderr and an OS termination signal never escape as raw errors',async t=>{
  const c=fixture(t,"console.error('raw-secret');process.kill(process.pid,'SIGTERM');");
  const error=await failure(runCLI(c,cleanup,AbortSignal.timeout(5000)));
  assert.equal(error.code,'COMPUTE_INFERENCE_FAILED');facts(error,{exitStatus:null,signal:'SIGTERM'});
});

test('invalid runtime produces unstarted, sanitized process evidence',async t=>{
  const c=fixture(t,"throw Error('must not run');");
  const error=await failure(runCLI({...c,openclaw:path.join(c.home,'missing')},cleanup));
  assert.equal(error.code,'OPENCLAW_NOT_INSTALLED');facts(error,{started:false,exitStatus:null});
});

test('spawn failure from an absent interpreter has bounded unstarted evidence',async t=>{
  const c=fixture(t,'');fs.writeFileSync(c.openclaw,'\u0023!/absent/agi-cleanup-test-interpreter\n');
  const error=await failure(runCLI(c,cleanup,undefined,{timeoutMs:1000}));
  assert.equal(error.code,'COMPUTE_CLI_UNAVAILABLE');facts(error,{started:false,exitStatus:null,timeoutMs:1000});
});

test('already aborted calls never spawn or even require runtime discovery',async()=>{
  for(const reason of [new Error('raw-secret'),new DOMException('oauth-secret','TimeoutError')]){
    const error=await failure(runCLI({},cleanup,AbortSignal.abort(reason)));
    const timedOut=reason.name==='TimeoutError';assert.equal(error.code,timedOut?'COMPUTE_CLI_TIMEOUT':'COMPUTE_CLI_CANCELLED');facts(error,{started:false,exitStatus:null,timedOut});
  }
});

test('AbortSignal.timeout is a timeout and confirms termination before rejection',async t=>{
  const c=fixture(t,'setInterval(()=>{},1000);');
  const error=await failure(runCLI(c,cleanup,AbortSignal.timeout(250)));
  assert.equal(error.code,'COMPUTE_CLI_TIMEOUT');facts(error,{exitStatus:null,signal:'SIGTERM',timedOut:true});
});

test('known timeout records its bounded duration and does not depend on an external signal',async t=>{
  const c=fixture(t,'setInterval(()=>{},1000);');
  const error=await failure(runCLI(c,cleanup,undefined,{timeoutMs:250}));
  assert.equal(error.code,'COMPUTE_CLI_TIMEOUT');facts(error,{exitStatus:null,signal:'SIGTERM',timedOut:true,timeoutMs:250});
});

test('explicit cancellation stays distinct from timeout',async t=>{
  const c=fixture(t,'setInterval(()=>{},1000);'),controller=new AbortController();
  const pending=runCLI(c,cleanup,controller.signal);setTimeout(()=>controller.abort(new Error('raw-secret')),250);
  const error=await failure(pending);assert.equal(error.code,'COMPUTE_CLI_CANCELLED');facts(error,{exitStatus:null,signal:'SIGTERM'});
});

test('overflow waits for SIGKILL when the CLI ignores SIGTERM',async t=>{
  const c=fixture(t,"process.on('SIGTERM',()=>{});process.stdout.write(Buffer.alloc(1048577,120));setInterval(()=>{},1000);");
  const error=await failure(runCLI(c,cleanup,undefined,{timeoutMs:10000}));
  assert.equal(error.code,'COMPUTE_CLI_OUTPUT_LIMIT');facts(error,{exitStatus:null,signal:'SIGKILL',timeoutMs:10000});assert.ok(error.elapsedMs>=1900&&error.elapsedMs<6000);
});

test('timeout escalation survives the leader exiting while a descendant ignores SIGTERM',async t=>{
  const c=fixture(t,"import fs from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>require('node:fs').writeFileSync('heartbeat',String(Date.now())),20);\"],{stdio:['ignore','inherit','inherit']});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);");
  const error=await failure(runCLI(c,cleanup,undefined,{timeoutMs:500}));
  assert.equal(error.code,'COMPUTE_CLI_TIMEOUT');assert.equal(error.timedOut,true);assert.equal(error.started,true);assert.ok(error.elapsedMs>=2300&&error.elapsedMs<6500);
  const heartbeat=fs.readFileSync(path.join(c.home,'heartbeat'),'utf8');await delay(100);assert.equal(fs.readFileSync(path.join(c.home,'heartbeat'),'utf8'),heartbeat);
});

test('bounded Docker diagnostics use the same process evidence and restrict executables and operations',async t=>{
  const c=fixture(t,'');
  const result=await runDiagnosticCommand(c,c.docker,['ps','--all','--no-trunc','--format','{{.ID}}']);
  assert.equal(result.stdout,'fixture-container-id\n');facts(result,{timeoutMs:5000});
  for(const [executable,args] of [[c.openclaw,['ps']],[c.docker,['rm','--force','anything']]]){
    const error=await failure(runDiagnosticCommand(c,executable,args));assert.equal(error.code,'COMPUTE_CLI_UNAVAILABLE');facts(error,{started:false,exitStatus:null,timeoutMs:5000});
  }
});
