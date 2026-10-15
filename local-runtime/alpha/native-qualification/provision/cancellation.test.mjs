// SYNTHETIC /proc and receipt fixtures only; no native execution or qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {interpreterIdentity,verifyCancellationTarget,requireCancelledReceipt} from './cancellation.mjs';
const nonce='a'.repeat(64);
const stat=(parent=33,start='123')=>'77 (synthetic fixture) '+['S',String(parent),...Array(17).fill('0'),start].join(' ')+'\n';
const argv='/opt/alpha/python/bin/python3.12\0-I\0-S\0-B\0/opt/alpha/launch-work.py\0';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-cancel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const procRoot=path.join(root,'proc'),proc=path.join(procRoot,'77'),file=path.join(root,'interpreter');
  fs.mkdirSync(path.join(proc,'ns'),{recursive:true});fs.mkdirSync(path.join(procRoot,'self/ns'),{recursive:true});
  fs.writeFileSync(file,'SYNTHETIC INTERPRETER NEVER EXECUTED');fs.writeFileSync(path.join(proc,'cmdline'),argv);fs.writeFileSync(path.join(proc,'stat'),stat());
  fs.symlinkSync(file,path.join(proc,'exe'));fs.symlinkSync('pid:[200]',path.join(proc,'ns/pid'));fs.symlinkSync('pid:[100]',path.join(procRoot,'self/ns/pid'));
  const interpreter=interpreterIdentity(file),request={kind:'cancel-native-phase',nonce,payload:{pid:77,startTimeTicks:'123',pidNamespace:'pid:[200]',phase:'work',interpreter}};
  return {root,procRoot,proc,file,request,context:{driverPid:33,procRoot,interpreter,nonce}};
}
function receipt(request){return {request,errorCode:'RUN_CANCELLED',retained:{state:'uncertain',receipt:{error:'RUN_CANCELLED',observation:{phases:[{phase:'work',launchAttempted:true,status:{namespaces:{pid:200},exitCode:137},signal:'SIGKILL',exitStatus:null,processGroupGone:true,privateNamespacesEnded:true,namespaceLifetimeEOF:true,evidenceClass:'NATIVE_FIXED_ALPHA_IPC'}]}}}};}

test('exact bound payload identity accepts Python-sorted JSON without performing cancellation',t=>{
  const f=fixture(t),sorted=JSON.parse(JSON.stringify(f.request));sorted.payload.interpreter=Object.fromEntries(Object.entries(sorted.payload.interpreter).sort());
  assert.deepEqual(verifyCancellationTarget(sorted,f.context),sorted);
  assert.equal(requireCancelledReceipt(receipt(sorted)),true);
});
test('nonce, command, interpreter identity and unknown request fields are rejected',t=>{
  const f=fixture(t);
  for(const mutate of [r=>r.nonce='b'.repeat(64),r=>r.kind='stop',r=>r.extra=true,r=>r.payload.interpreter.sha256='b'.repeat(64),r=>r.payload.pid=0,r=>r.payload.phase='probe',r=>r.payload.extra=true]){
    const r=structuredClone(f.request);mutate(r);assert.throws(()=>verifyCancellationTarget(r,f.context));
  }
});
test('prlimit and bubblewrap wrapper argv never count as payloads',t=>{
  const f=fixture(t);
  for(const prefix of ['/usr/bin/prlimit\0--cpu=5\0','/usr/bin/bwrap\0--\0']){
    fs.writeFileSync(path.join(f.proc,'cmdline'),prefix+argv);assert.throws(()=>verifyCancellationTarget(f.request,f.context),/NOT_PAYLOAD/);
  }
});
test('matching argv with other executable inode is rejected',t=>{
  const f=fixture(t),wrong=path.join(f.root,'wrong');fs.writeFileSync(wrong,fs.readFileSync(f.file));fs.unlinkSync(path.join(f.proc,'exe'));fs.symlinkSync(wrong,path.join(f.proc,'exe'));
  assert.throws(()=>verifyCancellationTarget(f.request,f.context),/WRONG_EXECUTABLE/);
});
test('interpreter byte drift is rejected even on the same inode',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,'X'.repeat(f.context.interpreter.bytes));
  assert.throws(()=>verifyCancellationTarget(f.request,f.context),/EXECUTABLE_CHANGED/);
});
test('host namespace, changed namespace, reused PID and unrelated ancestry are rejected',t=>{
  const f=fixture(t);
  for(const value of ['pid:[100]','pid:[999]']){fs.unlinkSync(path.join(f.proc,'ns/pid'));fs.symlinkSync(value,path.join(f.proc,'ns/pid'));assert.throws(()=>verifyCancellationTarget(f.request,f.context),/NAMESPACE_CHANGED/);}
  fs.unlinkSync(path.join(f.proc,'ns/pid'));fs.symlinkSync('pid:[200]',path.join(f.proc,'ns/pid'));
  fs.writeFileSync(path.join(f.proc,'stat'),stat(33,'999'));assert.throws(()=>verifyCancellationTarget(f.request,f.context),/PID_REUSED/);
  fs.writeFileSync(path.join(f.proc,'stat'),stat(1));assert.throws(()=>verifyCancellationTarget(f.request,f.context),/NOT_DRIVER_DESCENDANT/);
});
test('phase disappearance before application is inconclusive, never accepted',t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.proc,'stat'));
  assert.throws(()=>verifyCancellationTarget(f.request,f.context),{code:'ENOENT'});
});
test('PID reuse between first and final synchronous check is rejected',t=>{
  const f=fixture(t),original=fs.readFileSync;let reads=0;
  t.mock.method(fs,'readFileSync',(file,...args)=>{
    if(file===path.join(f.proc,'stat')&&++reads>=3)return stat(33,'999');
    return original(file,...args);
  });
  assert.throws(()=>verifyCancellationTarget(f.request,f.context),/TARGET_RACED/);
});
test('late cancellation after successful native completion cannot pass via any thrown error',t=>{
  const f=fixture(t),v=receipt(f.request);Object.assign(v.retained.receipt.observation.phases[0],{signal:null,exitStatus:0,status:{namespaces:{pid:200},exitCode:0}});
  assert.throws(()=>requireCancelledReceipt(v),/PHASE_ALREADY_ENDED/);
  for(const code of ['RUN_TIMEOUT','FAILED_OR_UNCERTAIN','STOP_RECONCILIATION_REQUIRED']){
    const changed=receipt(f.request);changed.errorCode=code;assert.throws(()=>requireCancelledReceipt(changed),/WRONG_RUNTIME_OUTCOME/);
  }
});
test('retained receipt must bind exact phase, namespace, uncertainty, cancellation and cleanup',t=>{
  const f=fixture(t);
  for(const change of [v=>v.retained.state='complete',v=>v.retained.receipt.error='RUN_TIMEOUT',v=>v.retained.receipt.observation.phases[0].phase='validate',v=>v.retained.receipt.observation.phases[0].status.namespaces.pid=999,v=>v.retained.receipt.observation.phases[0].namespaceLifetimeEOF=false,v=>v.retained.receipt.observation.phases[0].evidenceClass='SYNTHETIC',v=>v.retained.receipt.observation.phases=[]]){
    const v=receipt(f.request);change(v);assert.throws(()=>requireCancelledReceipt(v));
  }
});
