import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,task} from './helpers.mjs';
import {createSystem,runCandidate,exportCapsule,validateState,appendEvent,historyEvents} from '../../fleet/successor/vendor/manager/site/assets/successor/model.mjs';
import crypto from 'node:crypto';
import {digest,canonical} from '../contracts.mjs';

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
test('concurrent version choices cannot overwrite a committed selection or its Chronicle',async()=>{
  const f=fixture();try{
    const created=await createSystem(task().input.mission),built=await runCandidate(created,'improved','a'.repeat(64));
    const imported=await f.runtime.dispatch('project-import',{capsule:await exportCapsule(built.state),confirm:true},f.operator);
    const choice={project:imported.project,candidate:built.candidate.id,decision:'keep',confirm:true};
    const results=await Promise.allSettled([f.runtime.dispatch('project-select',choice,f.operator),f.runtime.dispatch('project-select',choice,f.operator)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.message,'PROJECT_CHANGED');
    const saved=JSON.parse(f.runtime.store.db.prepare('SELECT value FROM projects WHERE id=?').get(imported.project).value);
    await validateState(saved);assert.equal(saved.active,built.candidate.id);
    assert.equal(saved.chronicle.length,imported.state.chronicle.length+1);
    assert.equal(saved.authority,'none');assert.equal(f.runtime.status(f.operator).runs.length,0);
  }finally{f.close();}
});
test('concurrent validated imports cannot exceed the durable project limit',async()=>{
  const f=fixture();try{
    const state=await createSystem(task().input.mission),capsule=await exportCapsule(state);
    for(let i=0;i<31;i++)f.runtime.store.db.prepare('INSERT INTO projects VALUES(?,?)').run(crypto.randomUUID(),JSON.stringify(state));
    const results=await Promise.allSettled([f.runtime.dispatch('project-import',{capsule,confirm:true},f.operator),f.runtime.dispatch('project-import',{capsule,confirm:true},f.operator)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.message,'PROJECT_LIMIT');
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,32);
  }finally{f.close();}
});

for(const count of [98,99,100])test(`local project history ${count}: exact inactive restore and checkpoint-bound operator continuation`,async()=>{
  const f=fixture();try{
    let state=await createSystem(task().input.mission);while(state.chronicle.length<count)await appendEvent(state,'restored','0'.repeat(64));
    const capsule=await exportCapsule(state),imported=await f.runtime.dispatch('project-import',{capsule,confirm:true},f.operator);
    assert.deepEqual(imported.state,state);
    const checkpoint=(await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule;
    const input={project:imported.project,checkpointSha256:digest(checkpoint),confirm:true};
    const a=f.create();const scoped=f.runtime.issueClient(a.id).principal;
    await assert.rejects(f.runtime.dispatch('project-continue-history',input,scoped),/CLIENT_SCOPE_DENIED/);
    await assert.rejects(f.runtime.dispatch('project-continue-history',{...input,confirm:false},f.operator),/CONFIRM_REQUIRED/);
    await assert.rejects(f.runtime.dispatch('project-continue-history',{...input,checkpointSha256:'f'.repeat(64)},f.operator),/CHECKPOINT_CHANGED/);
    const next=await f.runtime.dispatch('project-continue-history',input,f.operator);assert.equal(next.capacity.remaining,99);assert.equal(next.runAuthorized,false);assert.equal(next.authority,'none');
    const after=JSON.parse((await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule).payload.state;
    assert.deepEqual(historyEvents(after).slice(0,count),state.chronicle);assert.equal(after.authority,'none');assert.equal(f.runtime.status(f.operator).runs.length,0);
  }finally{f.close();}
});
test('concurrent checkpoint continuations cannot overwrite committed project history',async()=>{
  const f=fixture();try{
    const state=await createSystem(task().input.mission);while(state.chronicle.length<100)await appendEvent(state,'restored','0'.repeat(64));
    const capsule=await exportCapsule(state),imported=await f.runtime.dispatch('project-import',{capsule,confirm:true},f.operator);
    const checkpoint=(await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule;
    const input={project:imported.project,checkpointSha256:digest(checkpoint),confirm:true};
    const results=await Promise.allSettled([f.runtime.dispatch('project-continue-history',input,f.operator),f.runtime.dispatch('project-continue-history',input,f.operator)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.message,'PROJECT_CHANGED');
    const after=JSON.parse((await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule).payload.state;await validateState(after);assert.equal(after.archives.length,1);assert.equal(after.chronicle.length,1);
  }finally{f.close();}
});

for(const count of [98,100])test(`source-bearing local project ${count}: import/export and continuation preserve exact checkpoint provenance`,async()=>{
  const f=fixture();try{
    const source={repository:'MontrealAI/AGIJobManager',commit:'a'.repeat(40),engineSha256:'b'.repeat(64),files:[],license:'MIT'};
    const state=await createSystem(task().input.mission);while(state.chronicle.length<count)await appendEvent(state,'restored','0'.repeat(64));
    const original=await exportCapsule(state,source),imported=await f.runtime.dispatch('project-import',{capsule:original,confirm:true},f.operator);
    const exported=(await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule;
    assert.deepEqual(JSON.parse(exported),JSON.parse(original),'source-bearing capsule payload and canonical hash survive roundtrip');
    await f.runtime.dispatch('project-continue-history',{project:imported.project,checkpointSha256:digest(exported),confirm:true},f.operator);
    const after=JSON.parse((await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule);
    assert.deepEqual(after.payload.sourceManifest,source);assert.deepEqual(after.payload.state.archives[0].events,state.chronicle);
    assert.deepEqual(historyEvents(after.payload.state).slice(0,count),state.chronicle);assert.equal(f.runtime.status(f.operator).runs.length,0);
  }finally{f.close();}
});

test('source-bearing selection preserves metadata and older source-less rows remain readable',async()=>{
  const f=fixture();try{
    const source={repository:'MontrealAI/AGIJobManager',commit:'c'.repeat(40),engineSha256:'d'.repeat(64),files:[{path:'model.mjs',sha256:'e'.repeat(64)}],license:'MIT'};
    const built=await runCandidate(await createSystem(task().input.mission),'baseline','a'.repeat(64));
    const imported=await f.runtime.dispatch('project-import',{capsule:await exportCapsule(built.state,source),confirm:true},f.operator);
    await f.runtime.dispatch('project-select',{project:imported.project,candidate:built.candidate.id,decision:'keep',confirm:true},f.operator);
    const selected=JSON.parse((await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule);
    assert.deepEqual(selected.payload.sourceManifest,source);assert.equal(selected.payload.state.active,built.candidate.id);
    const legacy=crypto.randomUUID();f.runtime.store.db.prepare('INSERT INTO projects VALUES(?,?)').run(legacy,JSON.stringify(built.state));
    const exported=JSON.parse((await f.runtime.dispatch('project-export',{project:legacy},f.operator)).capsule);
    assert.deepEqual(exported.payload.state,built.state);assert.equal(exported.payload.sourceManifest,null);
  }finally{f.close();}
});

test('project capacity counts retained UTF-8 bytes before importing new state',async()=>{
  const f=fixture();try{
    // Retained rows are counted without parsing or trusting their contents.
    const retained='é'.repeat(999_999);for(let i=0;i<16;i++)f.runtime.store.db.prepare('INSERT INTO projects VALUES(?,?)').run(crypto.randomUUID(),retained);
    const state=await createSystem(task().input.mission),capsule=await exportCapsule(state);
    await assert.rejects(f.runtime.dispatch('project-import',{capsule,confirm:true},f.operator),/PROJECT_STORAGE_LIMIT/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,16);
  }finally{f.close();}
});

test('assembling a separately checked candidate retains imported source provenance',async()=>{
  const f=fixture();try{
    const source={repository:'MontrealAI/AGIJobManager',commit:'a'.repeat(40),engineSha256:'b'.repeat(64),files:[],license:'MIT'};
    const a=f.create(),n=f.create('node'),input=task();let grant=f.prepare(a,input);f.authorize(grant);const execution=await f.run(a,grant);
    const reviewTask={schema:'agi-fleet/local-task/v1',action:'successor-check',workspace:'files',input:{...input.input,files:execution.receipt.result.files},review:'internal',sourceActor:a.id,sourceController:a.controller};
    grant=f.prepare(n,reviewTask);f.authorize(grant);const review=await f.run(n,grant);
    const imported=await f.runtime.dispatch('project-import',{capsule:await exportCapsule(await createSystem(input.input.mission),source),confirm:true},f.operator);
    const built=await f.runtime.dispatch('project-assemble',{project:imported.project,execution:execution.run,review:review.run},f.operator);
    const capsule=JSON.parse((await f.runtime.dispatch('project-export',{project:built.project},f.operator)).capsule);
    assert.deepEqual(capsule.payload.sourceManifest,source);assert.equal(capsule.payload.state.active,null);assert.equal(built.independentReview,false);
  }finally{f.close();}
});

test('source-bearing capacity rejects a choice without committing an unexportable project',async()=>{
  const f=fixture();try{
    const source={repository:'MontrealAI/AGIJobManager',commit:'a'.repeat(40),engineSha256:'b'.repeat(64),files:[],license:'MIT'};
    const mission=structuredClone(task().input.mission);mission.input='id,category,value\n'+Array.from({length:1000},(_,i)=>'row'+i+','+('Category '+i).padEnd(79,'x')+',1').join('\n');
    let state=await createSystem(mission);for(let i=0;i<11;i++)state=(await runCandidate(state,'baseline',i.toString(16).padStart(64,'0'))).state;
    const size=s=>Buffer.byteLength(canonical({format:'successor-portable/1',payload:{state:s,sourceManifest:source},sha256:'0'.repeat(64)}));
    while(size(state)+2300<3999900)await appendEvent(state,'restored','x'.repeat(2000));
    const probe=structuredClone(state);await appendEvent(probe,'restored','x');await appendEvent(state,'restored','x'.repeat(3999900-size(probe)+1));
    const original=await exportCapsule(state,source),imported=await f.runtime.dispatch('project-import',{capsule:original,confirm:true},f.operator);
    const before=(await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule;
    await assert.rejects(f.runtime.dispatch('project-select',{project:imported.project,candidate:state.candidates[0].id,decision:'keep',confirm:true},f.operator),/CAPSULE_CAPACITY/);
    assert.equal((await f.runtime.dispatch('project-export',{project:imported.project},f.operator)).capsule,before);
    assert.equal(JSON.parse(before).payload.state.active,null);
  }finally{f.close();}
});
