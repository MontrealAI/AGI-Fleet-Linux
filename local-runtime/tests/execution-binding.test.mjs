import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,task} from './helpers.mjs';
import {LinuxSandbox} from '../platforms/linux.mjs';

test('the supervisor passes the committed host binding into the final adapter execution boundary',async()=>{
  let expected;const f=fixture({execute:async({expectedHost})=>{
    assert.deepEqual(expectedHost,expected);
    return {result:{files:[]},observation:{processGroupGone:true}};
  }});
  try{const a=f.create();expected=a.host;const g=f.prepare(a);f.authorize(g);assert.equal((await f.run(a,g)).state,'complete');}finally{f.close();}
});

for(const change of [{identity:'changed-executable'},{backend:'changed-adapter'},{bootId:'changed-boot'}])
  test('the final Linux probe refuses binding drift before staging or launching work: '+Object.keys(change)[0],async()=>{
    const f=fixture();try{
      const host={supported:true,backend:'linux-bwrap-offline/v1',identity:'original-executable',bootId:'original-boot'};
      const sandbox=new LinuxSandbox();sandbox.inspect=()=>({...host,...change});
      // Synthetic probe only. No native sandbox or physical session claim.
      await assert.rejects(sandbox.execute({role:'agent',task:task(),directory:f.directory,expectedHost:host}),/EXECUTION_HOST_CHANGED/);
      assert.equal(fs.existsSync(path.join(f.directory,'task.json')),false);
    }finally{f.close();}
  });

test('a Linux execution call without an expected binding is refused before any host probe or staging',async()=>{
  const f=fixture();try{
    const sandbox=new LinuxSandbox();sandbox.inspect=()=>{assert.fail('unbound execution must not probe');};
    await assert.rejects(sandbox.execute({role:'agent',task:task(),directory:f.directory}),/EXECUTION_BINDING_REQUIRED/);
    assert.equal(fs.existsSync(path.join(f.directory,'task.json')),false);
  }finally{f.close();}
});

test('late Linux binding drift preserves STOP and consumed authority; recorded non-launch permits only explicit no-success reconciliation',async()=>{
  const host={supported:true,backend:'linux-bwrap-offline/v1',identity:'authorized-host',bootId:'same-boot'};
  const f=fixture({inspect:()=>host,execute:args=>{
    const sandbox=new LinuxSandbox();sandbox.inspect=()=>({...host,identity:'changed-at-execution'});
    return sandbox.execute(args);
  }});
  try{
    const a=f.create(),g=f.prepare(a);f.authorize(g);
    await assert.rejects(f.run(a,g),/EXECUTION_HOST_CHANGED/);
    const run=f.runtime.status(f.operator).runs[0].id,outcome=f.runtime.output({actor:a.id,run},f.operator);
    assert.equal(outcome.state,'uncertain');assert.equal(outcome.receipt.observation.launchAttempted,false);
    assert.equal(Object.hasOwn(outcome.receipt.observation,'privateNamespacesEnded'),false);
    assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
    const plan=await f.runtime.dispatch('reconciliation',{run},f.operator);assert.equal(plan.kind,'recorded-launch-refusal');
    await assert.rejects(f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:false},f.operator),/CONFIRM_REQUIRED/);
    const reconciled=await f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator);
    assert.equal(reconciled.receipt.disposition,'closed-without-success');assert.equal(f.runtime.store.meta('stopped'),true);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
  }finally{f.close();}
});
