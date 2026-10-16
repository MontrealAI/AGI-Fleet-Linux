// Synthetic IPC event streams only. Native qualification requires real bwrap CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {alphaSandboxArguments,parseAlphaStatus,exerciseAlphaTransport,exerciseAlphaSequence,ALPHA_IPC_LIMITS} from '../alpha/ipc.mjs';
import {validateAlphaInput} from '../alpha/contract.mjs';
import {fixture} from './helpers.mjs';
import {ALPHA_SOURCE_COMMIT} from '../alpha/package.mjs';
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/alpha-contract.json',import.meta.url))).cases;
const hostNamespaces={pid:1,net:2,mnt:3,ipc:4,uts:5};
const statusStart={'child-pid':12345,'pid-namespace':11,'net-namespace':12,'mnt-namespace':13,'ipc-namespace':14,'uts-namespace':15};
const status=(patch={},exit=0)=>Buffer.from(JSON.stringify({...statusStart,...patch})+'\n'+(exit===null?'':JSON.stringify({'exit-code':exit})+'\n'));
const input={workSpec:cases[0].workSpec},task={schema:'agi-fleet/local-task/v1',action:'alpha-run',workspace:'files',input,review:'none',sourceActor:null,sourceController:null};
const clean={processGroupGone:true,privateNamespacesEnded:true,evidenceClass:'SYNTHETIC_TEST'};
const host=()=>({supported:true,backend:'synthetic-alpha-ipc',identity:'synthetic-host',alphaRun:{supported:true,sourceCommit:ALPHA_SOURCE_COMMIT,packageSha256:'synthetic-alpha-package',trustLockSha256:'synthetic-lock'}});
const errorCode=c=>e=>e.code===c||e.message===c;
function transport(action,options={}){
  const child=new EventEmitter();child.pid=1234;child.stdio=Array.from({length:5},()=>new PassThrough());[child.stdin,child.stdout,child.stderr]=child.stdio;child.unref=()=>{};
  let gone=false,seen;const stdin=[];child.stdin.on('data',b=>stdin.push(b));
  function close({code=0,signal=null,sync=true}={}){gone=true;for(const i of [1,2,3])child.stdio[i].end();if(sync)child.stdio[4].end();queueMicrotask(()=>child.emit('close',code,signal));}
  const io={now:()=>performance.now(),namespaceIds:()=>hostNamespaces,evidenceClass:'SYNTHETIC_IPC_EVENTS',spawn:(exe,args,settings)=>{seen={exe,args,settings};queueMicrotask(()=>action({child,close}));return child;},kill:(pid,signal)=>{assert.equal(pid,-child.pid);if(signal===0){if(!gone)return;throw Object.assign(Error(),{code:'ESRCH'});}gone=true;close({code:null,signal:'SIGKILL'});}};
  const promise=exerciseAlphaTransport({rootfs:'/synthetic/rootfs',phase:'work',stdin:Buffer.from(input.workSpec),outputLimit:256,deadline:performance.now()+1000,...options},io);
  return {promise,child,stdin:()=>Buffer.concat(stdin),seen:()=>seen};
}

test('fixed Alpha command mounts only candidate root, ephemeral devices/proc/tmp and fixed launcher',()=>{
  for(const phase of ['validate','work']){const args=alphaSandboxArguments('/candidate/rootfs',phase);assert.deepEqual(args.slice(-5),['/opt/alpha/python/bin/python3.12','-I','-S','-B','/opt/alpha/launch-'+phase+'.py']);assert.equal(args.filter(x=>x==='--ro-bind').length,1);assert.ok(args.includes('--unshare-all'));assert.ok(args.includes('--die-with-parent'));assert.ok(args.includes('--sync-fd'));assert.ok(!args.includes('--as-pid-1'));assert.ok(!args.includes('--share-net'));assert.ok(!args.includes('/usr/lib'));}
  assert.throws(()=>alphaSandboxArguments('/candidate','sh'),/ALPHA_PHASE_INVALID/);assert.equal(ALPHA_IPC_LIMITS.cpuSecondsPerPhase,5);assert.equal(ALPHA_IPC_LIMITS.wallMs,15000);
});
test('trusted status requires complete private namespace IDs and separate execution status',()=>{
  assert.equal(parseAlphaStatus(status(),hostNamespaces).exitCode,0);
  for(const raw of [status({'pid-namespace':1}),status({'net-namespace':2}),status({'child-pid':0}),status({},null),Buffer.from('{}\n{}\n{}\n'),Buffer.from('{"child-pid":1,"child-pid":2}\n'),Buffer.concat([Buffer.from([239,187,191]),status()])])assert.throws(()=>parseAlphaStatus(raw,hostNamespaces));
});
test('synthetic transport sends exact bytes, hard CPU limits and bounded output through fixed pipes',async()=>{
  const t=transport(({child,close})=>{child.stdio[3].write(status());child.stdout.write('public result');close();});const result=await t.promise;
  assert.equal(result.output,'public result');assert.equal(t.stdin().toString(),input.workSpec);assert.equal(t.seen().exe,'/usr/bin/prlimit');assert.ok(t.seen().args.includes('--cpu=5:5'));assert.deepEqual(t.seen().settings.stdio,['pipe','pipe','pipe','pipe','pipe']);assert.equal(t.seen().settings.shell,false);assert.equal(result.observation.privateNamespacesEnded,true);assert.equal(result.observation.evidenceClass,'SYNTHETIC_IPC_EVENTS');
  const bom=transport(({child,close})=>{child.stdio[3].write(status());child.stdout.write(Buffer.concat([Buffer.from([239,187,191]),Buffer.from('public result')]));close();});assert.equal((await bom.promise).output,'\uFEFFpublic result');
});
test('synthetic transport refuses EOF with missing metadata, host namespaces or missing execution status',async()=>{
  for(const bytes of [Buffer.alloc(0),status({'pid-namespace':1}),status({},null)]){
    const t=transport(({child,close})=>{child.stdio[3].write(bytes);child.stdout.write('looks successful');close();});await assert.rejects(t.promise);
  }
});
test('synthetic transport rejects malformed UTF8, nonzero exit and lifetime channel data',async()=>{
  for(const action of [({child,close})=>{child.stdio[3].write(status());child.stdout.write(Buffer.from([255]));close();},({child,close})=>{child.stdio[3].write(status({},1));close({code:1});},({child,close})=>{child.stdio[3].write(status());child.stdio[4].write('forged lifetime');close();}])await assert.rejects(transport(action).promise);
});
test('synthetic transport kills the exact group on output, stderr and status caps',async()=>{
  for(const [index,value,code] of [[1,'x'.repeat(257),'ALPHA_OUTPUT_SIZE'],[2,'x'.repeat(8193),'ERROR_LIMIT'],[3,'x'.repeat(16385),'ALPHA_STATUS_LIMIT']]){
    const t=transport(({child})=>{child.stdio[3].write(status());child.stdio[index].write(value);});await assert.rejects(t.promise,e=>e.code===code&&e.observation.processGroupGone===true);
  }
});
test('synthetic cancellation kills the group and refuses successful-looking output',async()=>{
  const controller=new AbortController(),t=transport(({child})=>{child.stdio[3].write(status());child.stdout.write('result');controller.abort();},{signal:controller.signal});await assert.rejects(t.promise,errorCode('RUN_CANCELLED'));
});
test('synthetic monitor exit without namespace lifetime EOF cannot complete the operation',async()=>{
  const t=transport(({child,close})=>{child.stdio[3].write(status());child.stdout.write('result');close({sync:false});},{deadline:performance.now()+20});await assert.rejects(t.promise,errorCode('RUN_TIMEOUT'));
});
test('synthetic sequence preserves input across both phases, binds budgets and shares one deadline',async()=>{
  const seen=[],spec=validateAlphaInput(input);let checks=0;
  const result=await exerciseAlphaSequence({input,revalidate:()=>checks++},async options=>{seen.push(options);return {output:options.phase==='validate'?cases[0].alphaValidation:cases[0].alphaOutput,observation:clean};});
  assert.equal(checks,3);assert.deepEqual(seen.map(s=>s.phase),['validate','work']);assert.equal(seen[0].deadline,seen[1].deadline);assert.equal(seen[0].stdin.toString(),input.workSpec);assert.equal(seen[1].stdin.toString(),input.workSpec);assert.equal(seen[0].outputLimit,spec.budget.validatorBytes);assert.equal(seen[1].outputLimit,spec.budget.wireBytes);assert.equal(result.result.alphaOutput,cases[0].alphaOutput);assert.match(result.observation.evidenceClass,/SYNTHETIC/);
});
test('synthetic sequence never dispatches work after malformed validator, drift, cancellation or timeout',async()=>{
  for(const reason of ['invalid','drift','cancel','timeout']){
    const controller=new AbortController();let calls=0,checks=0,time=0;
    await assert.rejects(exerciseAlphaSequence({input,signal:controller.signal,revalidate:()=>{checks++;if(reason==='drift'&&checks===2)throw Error('GRANT_REVOKED');}},async()=>{calls++;if(reason==='cancel')controller.abort();if(reason==='timeout')time=15001;return {output:reason==='invalid'?'{}\n':cases[0].alphaValidation,observation:clean};},{now:()=>time}));assert.equal(calls,1);
  }
});
test('synthetic sequence rejects invalid work result and missing cleanup',async()=>{
  for(const reason of ['output','cleanup'])await assert.rejects(exerciseAlphaSequence({input,revalidate:()=>{}},async({phase})=>({output:phase==='validate'?cases[0].alphaValidation:'{}\n',observation:reason==='cleanup'?{...clean,privateNamespacesEnded:false}:clean})));
});
test('supervisor rechecks actor generation between Alpha phases and consumes uncertain grant',async()=>{
  let f,calls=0;
  f=fixture({inspect:host,execute:args=>exerciseAlphaSequence({input:args.task.input,signal:args.signal,revalidate:args.revalidate},async({phase})=>{calls++;if(phase==='validate'){const actor=f.runtime.store.actor(f.actor.id);actor.generation++;f.runtime.store.saveActor(actor);}return {output:phase==='validate'?cases[0].alphaValidation:cases[0].alphaOutput,observation:clean};})});
  try{f.actor=f.create();const g=f.prepare(f.actor,task);f.authorize(g);await assert.rejects(f.run(f.actor,g),/GRANT_REVOKED/);assert.equal(calls,1);assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');}finally{f.close();}
});
test('supervisor rechecks client authority and boot/runtime binding after validator and before receipt',async()=>{
  for(const mode of ['client','boot','runtime']){
    let f,calls=0,currentHost=host();
    f=fixture({inspect:()=>currentHost,execute:args=>exerciseAlphaSequence({input:args.task.input,signal:args.signal,revalidate:args.revalidate},async({phase})=>{calls++;if(phase==='validate'){if(mode==='client')f.runtime.revokeClient({client:f.client.hash},f.operator);else if(mode==='boot')currentHost={...currentHost,bootId:'changed-boot'};else currentHost={...currentHost,alphaRun:{...currentHost.alphaRun,packageSha256:'synthetic-changed'}};}return {output:phase==='validate'?cases[0].alphaValidation:cases[0].alphaOutput,observation:clean};})});
    try{const a=f.create();f.client=f.runtime.issueClient(a.id).principal;const g=f.prepare(a,task,f.client);f.authorize(g);await assert.rejects(f.run(a,g,f.client));assert.equal(calls,1);assert.equal(f.runtime.store.meta('stopped'),true);}finally{f.close();}
  }
});

test('synthetic sequence retains completed and failed phase evidence without granting cleanup to missing observations',async()=>{
  let calls=0;
  await assert.rejects(exerciseAlphaSequence({input,revalidate:()=>{}},async()=>{calls++;if(calls===1)return {output:cases[0].alphaValidation,observation:{...clean,phase:'validate'}};throw Object.assign(Error('RUN_CANCELLED'),{code:'RUN_CANCELLED',observation:{...clean,phase:'work'}});}),error=>{assert.equal(error.observation.phases.length,2);assert.equal(error.observation.processGroupGone,true);return true;});
  await assert.rejects(exerciseAlphaSequence({input,revalidate:()=>{}},async()=>{throw Error('NO_OBSERVATION');}),error=>{assert.equal(error.observation.phases.length,1);assert.equal(error.observation.processGroupGone,false);assert.equal(error.observation.privateNamespacesEnded,false);return true;});
});

test('synthetic cancellation after launcher exit waits for lifetime closure without signaling a reused group',async()=>{
  const controller=new AbortController();
  const t=transport(({child,close})=>{child.stdio[3].write(status());child.emit('exit',0,null);controller.abort();setTimeout(()=>close(),10);},{signal:controller.signal});
  await assert.rejects(t.promise,errorCode('RUN_CANCELLED'));
});
