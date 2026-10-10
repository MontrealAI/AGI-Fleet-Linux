import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {roleContract} from '../shared/runtime/compute/roles.mjs';
import {ComputeWorker} from '../packages/AGI_Agent/compute/server.mjs';
import {Controller} from '../ops/controller.mjs';
import {modelReview} from '../ops/evidence.mjs';
import {now} from '../ops/common.mjs';
import {config} from './helpers.mjs';

const roles=['agent','node','moderator','employer','evidence','recovery'];
for(const role of roles)test(`${role}: new defaults and explicit stored allowances remain distinct`,async()=>{
  const c=roleContract(role);
  const {COMPANION_DEFAULT,validateCompanion}=await import(`../packages/${c.package}/src/control/companion.mjs`);
  assert.equal(COMPANION_DEFAULT.maxCalls24h,256);
  assert.equal(validateCompanion({}).maxCalls24h,256);
  assert.equal(validateCompanion({maxCalls24h:48}).maxCalls24h,48);
  assert.equal(c.maxRuns24h,256);
  assert.equal(c.maxImages24h,['agent','node'].includes(role)?32:0);
  assert.equal(COMPANION_DEFAULT.enabled,false);
  assert.equal(COMPANION_DEFAULT.autoBrief,false);
});

for(const role of roles.slice(2))test(`${role}: actual signer admits 256 requests and preserves a stored 48-request limit`,async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-operator-allowance-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const fresh=new Controller(home,role);
  assert.equal(fresh.config.maxModelRequests24h,256);
  assert.equal(fresh.vault.exists,false);
  fresh.store.close();
  let calls=0;
  const fetcher=async url=>{
    if(url.endsWith('/health'))return Response.json({role,uid:process.getuid()+1,policyCurrent:true,gatewayReady:true,stopped:false,policyHash:'d'.repeat(64)});
    calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{"verdict":"consistent"}'}}]});
  };
  for(const limit of [256,48]){
    fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config(role,{maxModelRequests24h:limit})),{mode:0o600});
    const active=new Controller(home,role);
    try{
      assert.equal(active.config.maxModelRequests24h,limit);
      active.store.db.exec('DELETE FROM model_requests');
      const insert=active.store.db.prepare('INSERT INTO model_requests VALUES(?,?,?,NULL)');
      for(let i=0;i<limit-1;i++)insert.run(crypto.randomUUID(),now(),'reserved');
      const before=calls;
      assert.equal((await modelReview(active.config,'a'.repeat(64),{},active.store,fetcher)).verdict,'consistent');
      assert.equal(calls,before+1);
    }finally{active.store.close();}
    const reloaded=new Controller(home,role);
    try{
      const before=calls;
      assert.equal(reloaded.config.maxModelRequests24h,limit);
      await assert.rejects(modelReview(reloaded.config,'a'.repeat(64),{},reloaded.store,fetcher),/MODEL_REQUEST_LIMIT/);
      assert.equal(calls,before);
      assert.equal(reloaded.store.stats().modelRequests24h,limit);
    }finally{reloaded.store.close();}
  }
});

test('rolling compute quota survives reload; blocked admissions cannot reach the provider',async t=>{
  const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-default-allowance-'));
  t.after(()=>fs.rmSync(profileDir,{recursive:true,force:true}));
  let now=2000000000000,calls=0;
  const c={role:'agent',profileDir,...{maxRuns24h:roleContract('agent').maxRuns24h,maxImages24h:roleContract('agent').maxImages24h}};
  const options={verifyPolicy:false,now:()=>now};
  const worker=new ComputeWorker(c,options);
  worker.chat=async()=>{calls++;return '{"status":"ready"}';};
  worker.state.calls=Array(255).fill(now);worker.state.lastClock=now;worker.save();
  assert.deepEqual(await worker.execute('test',{}, {id:crypto.randomUUID()}),{status:'ready'});
  assert.equal(calls,1);assert.equal(worker.state.calls.length,256);
  const reloaded=new ComputeWorker(c,options);reloaded.chat=worker.chat;
  await assert.rejects(reloaded.execute('test',{}, {id:crypto.randomUUID()}),/COMPUTE_DAILY_LIMIT/);
  assert.equal(calls,1);assert.equal(reloaded.state.calls.length,256);
  now+=86400000;
  await reloaded.execute('test',{}, {id:crypto.randomUUID()});
  assert.equal(calls,2);assert.equal(reloaded.state.calls.length,1);
});
