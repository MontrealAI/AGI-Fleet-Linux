import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,task} from './helpers.mjs';
import {canonical,id} from '../contracts.mjs';
import {createSystem,exportCapsule} from '../../fleet/successor/vendor/manager/site/assets/successor/model.mjs';
import {Store} from '../supervisor/store.mjs';
import {STORAGE_LIMITS,runHistoryUsage} from '../supervisor/capacity.mjs';

// Seeded storage-pressure fixtures only: these rows do not claim task execution,
// provider spending, native isolation or valid historical imported projects.
function textBytes(bytes,unicode=false) {
  const character=unicode?'é':'x',width=Buffer.byteLength(character);
  return character.repeat(Math.floor(bytes/width))+'x'.repeat(bytes%width);
}
function seedHistory(f,actor,bytes,{unicode=false}={}) {
  const value=canonical({reservedAt:0,fixture:'capacity-only'}),wrapper=canonical({fixture:''});
  const result=canonical({fixture:textBytes(bytes-Buffer.byteLength(value)-Buffer.byteLength(wrapper),unicode)});
  f.runtime.store.db.prepare("INSERT INTO runs VALUES(?,?,?,'complete',?,?)").run(id(),actor.id,id(),value,result);
}

test('grant history admission counts existing UTF-8 bytes rather than text characters',()=>{
  const f=fixture();try {
    const a=f.create();
    f.runtime.store.db.prepare("INSERT INTO grants VALUES(?,?,?,'revoked')").run(id(),a.id,canonical({fixture:textBytes(32_000_000,true)}));
    assert.throws(()=>f.prepare(a),/GRANT_HISTORY_FULL/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,1);
  }finally{f.close();}
});

test('project storage admission counts existing UTF-8 bytes without adding authority',async()=>{
  const f=fixture();try {
    f.runtime.store.db.prepare('INSERT INTO projects VALUES(?,?)').run(id(),canonical({fixture:textBytes(32_000_000,true)}));
    const capsule=await exportCapsule(await createSystem(task().input.mission));
    await assert.rejects(f.runtime.dispatch('project-import',{capsule,confirm:true},f.operator),/PROJECT_STORAGE_LIMIT/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,1);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
  }finally{f.close();}
});

test('UTF-8 run history capacity refuses dispatch before consuming its grant',async()=>{
  let dispatches=0;const f=fixture({execute:async()=>{dispatches++;return {result:{files:[]},observation:{processGroupGone:true}};}});
  try {
    const a=f.create(),g=f.prepare(a);f.authorize(g);seedHistory(f,a,63_999_000,{unicode:true});
    await assert.rejects(f.run(a,g),/HISTORY_CAPACITY_EXPORT_REQUIRED/);
    assert.equal(dispatches,0);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'authorized');
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,1);
  }finally{f.close();}
});

test('concurrent dispatch reserves complete outcome capacity atomically and releases unused space only after completion',async()=>{
  const jobs=[],pending=[];
  const f=fixture({execute:()=>new Promise(resolve=>jobs.push(()=>resolve({result:{fixture:textBytes(1_000_000),files:[]},observation:{processGroupGone:true}})))});
  try {
    const actors=[f.create(),f.create()],grants=actors.map(a=>{const g=f.prepare(a);f.authorize(g);return g;});
    seedHistory(f,actors[0],60_500_000);
    const first=f.run(actors[0],grants[0]);pending.push(first);
    const second=f.run(actors[1],grants[1]);pending.push(second);second.catch(()=>{});
    await Promise.resolve();
    assert.equal(jobs.length,1,'the second worker must not start against reserved outcome bytes');
    await assert.rejects(second,/HISTORY_CAPACITY_EXPORT_REQUIRED/);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(grants[1].grant).state,'authorized');
    jobs.shift()();await first;
    const retry=f.run(actors[1],grants[1]);pending.push(retry);assert.equal(jobs.length,1);jobs.shift()();await retry;
    const used=f.runtime.store.db.prepare("SELECT SUM(length(CAST(value AS BLOB))+length(CAST(COALESCE(result,'') AS BLOB))) AS bytes FROM runs").get().bytes;
    assert.ok(used<=64_000_000);assert.equal(f.runtime.store.meta('stopped'),false);
  }finally{jobs.splice(0).forEach(resolve=>resolve());await Promise.allSettled(pending);f.close();}
});

for(const legacy of [false,true])test(`restart retains pending outcome capacity and consumed daily work${legacy?' for a legacy reservation':''}`,()=>{
  const f=fixture();try{
    const a=f.create(),g=f.prepare(a);f.authorize(g);
    const run=id(),value=canonical({reservedAt:Date.now(),fixture:'interrupted-reservation-only',...(legacy?{}:{storageReservationBytes:STORAGE_LIMITS.runReservation})});
    f.runtime.store.transaction(()=>{
      f.runtime.store.db.prepare("UPDATE grants SET state='consumed' WHERE id=?").run(g.grant);
      f.runtime.store.db.prepare("INSERT INTO runs VALUES(?,?,?,'running',?,NULL)").run(run,a.id,g.grant,value);
    });
    const before=runHistoryUsage(f.runtime.store.db);
    assert.equal(before.bytes,Buffer.byteLength(value)+STORAGE_LIMITS.runReservation);
    f.runtime.store.close();f.runtime.store=new Store(f.directory);f.runtime.store.recover();
    assert.deepEqual(runHistoryUsage(f.runtime.store.db),before);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run).state,'uncertain');
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
    assert.equal(f.runtime.store.meta('stopped'),true);
  }finally{f.close();}
});

for(const invalid of ['oversized','cyclic'])test(`${invalid} failure observations retain a bounded uncertainty record and STOP without inventing cleanup`,async()=>{
  const observation=invalid==='oversized'?{data:textBytes(STORAGE_LIMITS.outcome+1)}:{};
  if(invalid==='cyclic')observation.self=observation;
  const f=fixture({execute:async()=>{throw Object.assign(Error('WORKER_FAILED'),{observation});}});
  try{
    const a=f.create(),g=f.prepare(a);f.authorize(g);await assert.rejects(f.run(a,g),/WORKER_FAILED/);
    const row=f.runtime.store.db.prepare('SELECT state,value,result FROM runs').get(),receipt=JSON.parse(row.result);
    assert.equal(row.state,'uncertain');assert.equal(receipt.error,'WORKER_FAILED');assert.equal(receipt.observation,null);
    assert.equal(receipt.evidenceOmitted,'oversized-or-invalid-adapter-observation');assert.ok(Buffer.byteLength(row.result)<1000);
    assert.equal(runHistoryUsage(f.runtime.store.db).bytes,Buffer.byteLength(row.value)+STORAGE_LIMITS.runReservation);
    assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
  }finally{f.close();}
});

test('bounded failure reconciliation fits its reserved space while retaining the original error and consumed work',async()=>{
  const observation={backend:'linux-bwrap-offline/v1',processGroupGone:true,privateNamespacesEnded:true,network:'none',providerCalls:0,fixture:textBytes(STORAGE_LIMITS.outcome-1000)};
  const f=fixture({inspect:()=>({supported:true,backend:'linux-bwrap-offline/v1',identity:'synthetic-host'}),
    execute:async()=>{throw Object.assign(Error('WORKER_FAILED'),{observation});}});
  try{
    const a=f.create(),g=f.prepare(a);f.authorize(g);await assert.rejects(f.run(a,g),/WORKER_FAILED/);
    const run=f.runtime.store.db.prepare('SELECT id FROM runs').get().id,before=runHistoryUsage(f.runtime.store.db).bytes;
    const plan=await f.runtime.dispatch('reconciliation',{run},f.operator);
    const result=await f.runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},f.operator);
    assert.equal(result.receipt.priorOutcome.error,'WORKER_FAILED');assert.equal(result.receipt.priorOutcome.observation.fixture,observation.fixture);
    assert.ok(runHistoryUsage(f.runtime.store.db).bytes<=before);assert.equal(f.runtime.store.meta('stopped'),true);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
  }finally{f.close();}
});
