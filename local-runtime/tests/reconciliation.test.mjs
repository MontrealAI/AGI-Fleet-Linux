import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {canonical,parseStrict} from '../contracts.mjs';

const observation={backend:'linux-bwrap-offline/v1',processGroupGone:true,privateNamespacesEnded:true,network:'none',providerCalls:0};
function recoveryFixture({recorded=true}={}) {
  let boot='initial-engineering-boot';
  const f=fixture({inspect:()=>({supported:true,backend:'linux-bwrap-offline/v1',identity:'synthetic-host',bootId:boot}),
    execute:async()=>{throw Object.assign(Error('RUN_CANCELLED'),recorded?{observation}:{});}});
  return {...f,reboot:()=>{boot='new-engineering-boot';}};
}
async function uncertain(f) {const a=f.create(),g=f.prepare(a);f.authorize(g);await assert.rejects(f.run(a,g),/RUN_CANCELLED/);return {a,g,run:f.runtime.status(f.operator).runs[0].id};}

test('offline reconciliation retains failed evidence, budget and STOP; new authority remains explicit (synthetic boundary)',async()=>{
  const f=recoveryFixture();try{
    const {a,g,run}=await uncertain(f),plan=await f.runtime.dispatch('reconciliation',{run},f.operator);
    assert.equal(plan.eligible,true);assert.equal(plan.kind,'recorded-sandbox-closure');
    assert.equal((await f.runtime.dispatch('diagnostics',{},f.operator)).runs.uncertain,1);
    await assert.rejects(f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:false},f.operator),/CONFIRM_REQUIRED/);
    const result=await f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator);
    assert.equal(result.receipt.priorOutcome.error,'RUN_CANCELLED');assert.equal(result.receipt.authority,'none');
    assert.equal(result.receipt.disposition,'closed-without-success');assert.equal(f.runtime.store.meta('stopped'),true);
    const report=await f.runtime.dispatch('diagnostics',{},f.operator);
    assert.equal(report.runs.reconciled,1);assert.equal(report.runs.uncertain,0);assert.equal(report.runs.complete,0);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,1);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
    f.runtime.resume({confirm:true},f.operator);assert.throws(()=>f.prepare(a),/ACTIVATION_REQUIRED/);
    f.runtime.activate({actor:a.id,confirm:true},f.operator);await assert.rejects(f.run(a,g),/GRANT_UNAVAILABLE/);
  }finally{f.close();}
});
test('missing closure proof remains blocked until an observed reboot of an offline-only host',async()=>{
  const f=recoveryFixture({recorded:false});try{
    const {run}=await uncertain(f),plan=await f.runtime.dispatch('reconciliation',{run},f.operator);
    assert.equal(plan.eligible,false);
    await assert.rejects(f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator),/POSITIVE_CLEANUP_EVIDENCE_REQUIRED/);
    f.reboot();const next=await f.runtime.dispatch('reconciliation',{run},f.operator);
    assert.equal(next.kind,'observed-host-reboot');assert.equal(next.eligible,true);
    await f.runtime.dispatch('reconcile',{run,commitment:next.commitment,confirm:true},f.operator);
  }finally{f.close();}
});
test('operator confirmation cannot substitute proof, change the inspected outcome or grant assistant recovery access',async()=>{
  const f=recoveryFixture();try{
    const {a,run}=await uncertain(f),client=f.runtime.issueClient(a.id).principal;
    await assert.rejects(f.runtime.dispatch('reconciliation',{run},client),/CLIENT_SCOPE_DENIED/);
    const plan=await f.runtime.dispatch('reconciliation',{run},f.operator);
    await assert.rejects(f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true,cleanup:true},f.operator),/FIELDS_INVALID/);
    f.runtime.store.db.prepare('UPDATE runs SET result=? WHERE id=?').run(canonical({error:'CHANGED'}),run);
    await assert.rejects(f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator),/RECONCILIATION_CHANGED/);
  }finally{f.close();}
});
test('an offline cleanup receipt cannot reconcile a provider-backed or signing attempt',async()=>{
  for(const change of [{inference:'provider'},{spendUSDC:'1'},{host:{backend:'another-adapter',authority:'bounded-offline-only'}}]){
    const f=recoveryFixture();try{
      const {run}=await uncertain(f),row=f.runtime.store.db.prepare('SELECT value FROM runs WHERE id=?').get(run);
      f.runtime.store.db.prepare('UPDATE runs SET value=? WHERE id=?').run(canonical({...parseStrict(row.value),...change}),run);
      const plan=await f.runtime.dispatch('reconciliation',{run},f.operator);assert.equal(plan.reason,'EXTERNAL_RECONCILIATION_REQUIRED');
      await assert.rejects(f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator),/EXTERNAL_RECONCILIATION_REQUIRED/);
    }finally{f.close();}
  }
});
test('storage failure leaves reconciliation uncertain and host STOP intact',async()=>{
  const f=recoveryFixture();try{
    const {run}=await uncertain(f),plan=await f.runtime.dispatch('reconciliation',{run},f.operator),event=f.runtime.store.event;
    f.runtime.store.event=()=>{throw Error('SQLITE_FULL');};
    await assert.rejects(f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator),/SQLITE_FULL/);
    f.runtime.store.event=event;
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run).state,'uncertain');
    assert.equal(f.runtime.store.meta('stopped'),true);
  }finally{f.close();}
});

test('Alpha closure reconciliation binds native phase proof and runtime identity; synthetic authority never qualifies',async()=>{
  const identity='a'.repeat(64),phase={backend:'linux-bwrap-alpha/v1',evidenceClass:'NATIVE_FIXED_ALPHA_IPC',phase:'validate',processGroupGone:true,privateNamespacesEnded:true,namespaceLifetimeEOF:true,network:'none',providerCalls:0,status:{childPid:123,namespaces:{pid:11,net:12,mnt:13,ipc:14,uts:15}}};
  // Deliberately constructed record fixture. This does not demonstrate isolation.
  for(const invalid of [null,'synthetic','missing-eof','wrong-runtime','missing-phase']){
    const f=recoveryFixture();try{
      const {run,g}=await uncertain(f),row=f.runtime.store.db.prepare('SELECT value FROM runs WHERE id=?').get(run),value=parseStrict(row.value);
      value.host.alphaRuntimeIdentity=identity;value.admission={binding:{alpha:{evidenceClass:invalid==='synthetic'?'SYNTHETIC_OR_UNVERIFIED':'REVIEWED_NATIVE_PACKAGE',runtimeIdentity:identity}}};
      const alphaObservation={backend:'linux-bwrap-alpha/v1',evidenceClass:'NATIVE_FIXED_ALPHA_IPC',runtimeIdentity:invalid==='wrong-runtime'?'b'.repeat(64):identity,processGroupGone:true,privateNamespacesEnded:true,network:'none',providerCalls:0,phases:invalid==='missing-phase'?[]:[{...phase,namespaceLifetimeEOF:invalid!=='missing-eof'}]};
      f.runtime.store.db.prepare('UPDATE runs SET value=?,result=? WHERE id=?').run(canonical(value),canonical({error:'RUN_CANCELLED',observation:alphaObservation}),run);
      const plan=await f.runtime.dispatch('reconciliation',{run},f.operator);assert.equal(plan.eligible,invalid===null);
      if(invalid===null){assert.equal(plan.kind,'recorded-alpha-sandbox-closure');await f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator);assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');}
    }finally{f.close();}
  }
});
