import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,task} from './helpers.mjs';

test('separately authorized internal review creates an unselected unchanged-format capsule; explicit choice and restore grant no authority',async()=>{
  const f=fixture();try{
    const a=f.create(),n=f.create('node'),input=task();let g=f.prepare(a,input);f.authorize(g);const execution=await f.run(a,g);
    const rt={schema:'agi-fleet/local-task/v1',action:'successor-check',workspace:'files',input:{...input.input,files:execution.receipt.result.files},review:'internal',sourceActor:a.id,sourceController:a.controller};
    g=f.prepare(n,rt);await assert.rejects(f.run(n,g),/GRANT_UNAVAILABLE/);f.authorize(g);const review=await f.run(n,g);
    const built=await f.runtime.dispatch('project-assemble',{project:null,execution:execution.run,review:review.run},f.operator);
    assert.equal(built.state.active,null);assert.equal(built.independentReview,false);assert.equal(built.state.schema,'agijobmanager/successor-capsule/v1');
    const selected=await f.runtime.dispatch('project-select',{project:built.project,candidate:built.candidate.id,decision:'keep',confirm:true},f.operator);assert.equal(selected.runAuthorized,false);
    const exported=await f.runtime.dispatch('project-export',{project:built.project},f.operator);assert.equal(JSON.parse(exported.capsule).format,'successor-portable/1');
    const restored=await f.runtime.dispatch('project-import',{capsule:exported.capsule,confirm:true},f.operator);assert.equal(restored.authority,'none');assert.equal(restored.state.active,built.candidate.id);
  }finally{f.close();}
});
test('review of altered deliverables cannot produce an accepted candidate',async()=>{
  const f=fixture();try{
    const a=f.create(),n=f.create('node'),input=task();let g=f.prepare(a,input);f.authorize(g);const execution=await f.run(a,g);
    const files=structuredClone(execution.receipt.result.files);files.find(x=>x.name==='result.json').content='{}';
    const rt={schema:'agi-fleet/local-task/v1',action:'successor-check',workspace:'files',input:{...input.input,files},review:'internal',sourceActor:a.id,sourceController:a.controller};g=f.prepare(n,rt);f.authorize(g);const review=await f.run(n,g);
    assert.equal(review.receipt.result.checker.passed,false);
    await assert.rejects(f.runtime.dispatch('project-assemble',{project:null,execution:execution.run,review:review.run},f.operator),/CANDIDATE_REJECTED/);
  }finally{f.close();}
});
