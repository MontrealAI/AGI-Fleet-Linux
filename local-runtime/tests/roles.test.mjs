import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,task} from './helpers.mjs';
import {example} from '../examples.mjs';

for(const role of ['moderator','employer','evidence','recovery'])test(role+' executes its bounded inspection through unchanged formal modules (synthetic boundary)',async()=>{
  const f=fixture();try{const a=f.create(role),g=f.prepare(a,example(role));f.authorize(g);const r=await f.run(a,g);assert.equal(r.receipt.result.files.length,1);const report=JSON.parse(r.receipt.result.files[0].content);assert.equal(r.receipt.result.authority,'none');if(role==='evidence')assert.equal(report.inventory[0].matches,true);else {assert.equal(report.signerRequestCreated,false);assert.equal(report.action.action,{moderator:'agent-win',employer:'accept',recovery:'finalize'}[role]);}assert.throws(()=>f.prepare(a,task()),/ROLE_ACTION_DENIED/);}finally{f.close();}
});
test('recovery preserves formal deadlines; moderator retains appointment and conflict gates',async()=>{
  for(const role of ['recovery','moderator']){
    const f=fixture();try{const a=f.create(role),t=example(role);if(role==='recovery')t.input.snapshot.settlementAfter=String(t.input.snapshot.now+1000);else t.input.snapshot.moderator=false;const g=f.prepare(a,t);f.authorize(g);if(role==='moderator')await assert.rejects(f.run(a,g),/WORKER_FAILED|MODERATOR_NOT_APPOINTED/);else {const r=await f.run(a,g);assert.equal(JSON.parse(r.receipt.result.files[0].content).action,null);}}finally{f.close();}
  }
});
