import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {nativeProject} from './fixtures/project.mjs';
import {canonical,digest} from '../contracts.mjs';
import {Store} from '../supervisor/store.mjs';
import {perform} from '../worker.mjs';
import {createProjectRequest,inspectProjectRequest,inspectProjectReturn,PROJECT_BYTES,PROJECT_OBSERVATION_BYTES,projectCapacity,projectTaskResult} from '../project/transfer.mjs';
import {validateWorkerObservation} from '../platforms/linux.mjs';

const projectBytes=value=>Buffer.byteLength(value);

const reseal=body=>{const {sha256:_,...value}=body;return canonical({...value,sha256:digest(value)});};
// Manager history is deliberately inert, source-unverified retained text. It is
// never treated as execution, payment or reviewer evidence by these fixtures.
async function wrapped(project,padding){
  const value=JSON.parse(project);
  return reseal({schema:'agijobmanager/alpha-project-transfer/v1',original:{raw:project,sha256:digest(project)},
    project:{projectId:value.projectId,cycleId:value.cycles.at(-1).cycleId,revision:value.revision,projectDigest:value.projectDigest},
    authority:'none',settlement:'not-connected',historicalFixture:padding});
}
async function requestFixture(project,padding,language='en'){
  const baseline=JSON.parse(await createProjectRequest(project,{language,route:'manager-usdc'})),upstream=await wrapped(project,padding);
  return reseal({...baseline,upstream:{raw:upstream,sha256:digest(upstream)}});
}
async function boundaryRequest(project,character,language){
  const empty=await requestFixture(project,'',language),single=await requestFixture(project,character,language);
  const base=await projectCapacity(empty,JSON.parse(empty)),step=await projectCapacity(single,JSON.parse(single));
  // Repeating one complete code point has an exact linear escaped-byte cost.
  // Calculate the boundary without allocating dozens of multi-MB trial strings.
  const count=Math.floor(Math.min(...['returnUpperBytes','storageUpperBytes'].map(key=>(PROJECT_BYTES-base[key])/(step[key]-base[key]))));
  return {raw:await requestFixture(project,character.repeat(count),language),next:await requestFixture(project,character.repeat(count+1),language)};
}
function maximumObservation(character='\\'){
  const value={processGroupGone:true,evidenceClass:'synthetic size boundary; no native observation',padding:''};
  const empty=projectBytes(canonical(value)),unit=projectBytes(canonical(character))-2;
  value.padding=character.repeat(Math.floor((PROJECT_OBSERVATION_BYTES-empty)/unit));
  value.padding+='x'.repeat(PROJECT_OBSERVATION_BYTES-projectBytes(canonical(value)));
  assert.equal(projectBytes(canonical(value)),PROJECT_OBSERVATION_BYTES);return value;
}

for(const [character,language] of [['x','en'],['\\','fr'],['"','en'],['\n','fr'],['\t','en'],['é','fr'],['😀','en']])test(`${JSON.stringify(character)} ${language}: request boundary budgets both escaped receipts and retained history`,async()=>{
  const original=await nativeProject(),{raw,next}=await boundaryRequest(original,character,language),checked=await inspectProjectRequest(raw);
  assert.ok(checked.capacity.returnUpperBytes<=PROJECT_BYTES);assert.ok(checked.capacity.storageUpperBytes<=PROJECT_BYTES);
  await assert.rejects(inspectProjectRequest(next),/PROJECT_RETURN_CAPACITY/);
  const upstream=JSON.parse(next).upstream.raw;
  await assert.rejects(createProjectRequest(upstream,{language}),/PROJECT_RETURN_CAPACITY/);
  const f=fixture({execute:async({role,task})=>({result:await perform(role,task),observation:maximumObservation(character)})});
  try{
    const imported=await f.runtime.dispatch('journey-import',{request:raw,confirm:true},f.operator),agent=f.create(),node=f.create('node');
    const before=f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n;
    await assert.rejects(f.runtime.dispatch('journey-import',{request:next,confirm:true},f.operator),/PROJECT_RETURN_CAPACITY/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,before);
    let grant=await f.runtime.dispatch('journey-prepare',{journey:imported.journey,actor:agent.id},f.operator);f.authorize(grant);const execution=await f.run(agent,grant);
    assert.equal(projectBytes(canonical(execution.receipt)),checked.capacity.executionReceiptUpperBytes-4);
    grant=await f.runtime.dispatch('journey-review-prepare',{journey:imported.journey,execution:execution.run,actor:node.id},f.operator);f.authorize(grant);const review=await f.run(node,grant);
    assert.equal(projectBytes(canonical(review.receipt)),checked.capacity.reviewReceiptUpperBytes-4);
    const result=await f.runtime.dispatch('journey-export',{journey:imported.journey,execution:execution.run,review:review.run,confirm:true},f.operator);
    assert.ok(projectBytes(result.returned)<=checked.capacity.returnUpperBytes);
    const row=f.runtime.store.db.prepare('SELECT value FROM journeys WHERE id=?').get(imported.journey).value;
    assert.ok(projectBytes(row)<=checked.capacity.storageUpperBytes);assert.ok(projectBytes(row)<=PROJECT_BYTES);
    const inspected=await inspectProjectReturn(result.returned);assert.equal(inspected.request.upstream.raw,JSON.parse(raw).upstream.raw);
    assert.equal(f.runtime.store.db.prepare("SELECT COUNT(*) AS n FROM grants WHERE state='consumed'").get().n,2);
    assert.equal(f.runtime.store.meta('stopped'),false);
  }finally{f.close();}
});

test('pending return reservations survive restart and prevent competing imports from stealing history space',async()=>{
  const compact=await createProjectRequest(await nativeProject(),{language:'en',route:'manager-usdc'}),checked=await inspectProjectRequest(compact);
  const padding=Math.min(PROJECT_BYTES-projectBytes(compact),PROJECT_BYTES-checked.capacity.returnUpperBytes,Math.floor((PROJECT_BYTES-checked.capacity.storageUpperBytes)/2));
  const raw=compact+' '.repeat(padding),f=fixture();
  try{
    const journeys=[];
    for(let i=0;i<8;i++)journeys.push(await f.runtime.dispatch('journey-import',{request:raw,confirm:true},f.operator));
    await assert.rejects(f.runtime.dispatch('journey-import',{request:raw,confirm:true},f.operator),/JOURNEY_STORAGE_LIMIT/);
    f.runtime.store.close();f.runtime.store=new Store(f.directory);f.runtime.store.recover();
    await assert.rejects(f.runtime.dispatch('journey-import',{request:raw,confirm:true},f.operator),/JOURNEY_STORAGE_LIMIT/);
    const agent=f.create(),node=f.create('node'),journey=journeys[0].journey;
    let grant=await f.runtime.dispatch('journey-prepare',{journey,actor:agent.id},f.operator);f.authorize(grant);const execution=await f.run(agent,grant);
    grant=await f.runtime.dispatch('journey-review-prepare',{journey,execution:execution.run,actor:node.id},f.operator);f.authorize(grant);const review=await f.run(node,grant);
    await f.runtime.dispatch('journey-export',{journey,execution:execution.run,review:review.run,confirm:true},f.operator);
    assert.ok(f.runtime.store.db.prepare('SELECT SUM(length(CAST(value AS BLOB))) AS n FROM journeys').get().n<32_000_000);
    // Completed rows retain their conservative reservation too. Reopening the
    // store or exporting cannot make another near-maximum journey fit.
    await assert.rejects(f.runtime.dispatch('journey-import',{request:raw,confirm:true},f.operator),/JOURNEY_STORAGE_LIMIT/);
    assert.equal(f.runtime.store.db.prepare("SELECT COUNT(*) AS n FROM grants WHERE state='consumed'").get().n,2);
  }finally{f.close();}
  const small=fixture();try{
    for(let i=0;i<32;i++)await small.runtime.dispatch('journey-import',{request:compact,confirm:true},small.operator);
    await assert.rejects(small.runtime.dispatch('journey-import',{request:compact,confirm:true},small.operator),/JOURNEY_LIMIT/);
  }finally{small.close();}
});

test('native observation fields have a proven bounded receipt allowance',()=>{
  const worker={pidNamespace:'pid:['+'9'.repeat(20)+']',networkNamespace:'net:['+'9'.repeat(20)+']',userCPUMicroseconds:Number.MAX_SAFE_INTEGER,systemCPUMicroseconds:Number.MAX_SAFE_INTEGER,maxRSSKiB:Number.MAX_SAFE_INTEGER,taskMilliseconds:Number.MAX_SAFE_INTEGER};
  assert.equal(validateWorkerObservation(worker),worker);
  const observation={backend:'linux-bwrap-offline/v1',exitStatus:0,signal:null,stderr:'A'.repeat(100),processGroupGone:true,privateNamespacesEnded:true,network:'none',providerCalls:0,worker,wallMilliseconds:Number.MAX_SAFE_INTEGER};
  assert.equal(projectBytes(canonical(observation)),550);assert.ok(projectBytes(canonical(observation))<PROJECT_OBSERVATION_BYTES);
  assert.throws(()=>validateWorkerObservation({...worker,pidNamespace:'pid:['+'9'.repeat(21)+']'}),/WORKER_OBSERVATION_INVALID/);
  assert.throws(()=>validateWorkerObservation({...worker,taskMilliseconds:Number.MAX_SAFE_INTEGER+1}),/WORKER_OBSERVATION_INVALID/);
});


test('large escaped CSV output is refused by the deterministic sizing pass before any grant',async()=>{
  const csv='group,amount\n'+Array.from({length:800},(_,i)=>"'".repeat(77)+String(i).padStart(3,'0')+',1').join('\n')+'\n';
  const original=await nativeProject({csv}),f=fixture();
  try{
    await assert.rejects(createProjectRequest(original,{language:'fr',route:'manager-usdc'}),/OUTPUT_SIZE/);
    for(const table of ['journeys','grants','runs'])assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  }finally{f.close();}
});

for(const language of ['en','fr'])test(language+': adversarial report expansion exactly matches the admitted result bytes',async()=>{
  const labels=['é😀\\\"\t\n<&>'+"'".repeat(60),'Other'],csv='group,amount\n'+Array.from({length:150},(_,i)=>'"'+(labels[i%2]+i).replaceAll('"','""')+'",-1').join('\n')+'\n';
  const raw=await createProjectRequest(await nativeProject({csv}),{language,route:'manager-usdc'}),{request}=await inspectProjectRequest(raw);
  const execution=await perform('agent',request.task);
  assert.equal(canonical(execution),canonical(await projectTaskResult(request.task)));
  const task={...request.task,action:'successor-check',review:'internal',sourceActor:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',sourceController:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',input:{...request.task.input,files:execution.files}};
  assert.equal(canonical(await perform('node',task)),canonical(await projectTaskResult(task)));
});


test('EN/FR size refusal guidance is limited to failed admission and preserves existing history',()=>{
  const script=fs.readFileSync(new URL('../../local-dashboard/app.js',import.meta.url),'utf8');
  const context={document:{querySelectorAll:()=>[],getElementById:()=>({})}};
  vm.runInNewContext(script+';globalThis.message=journeyAdmissionMessage;',context);
  const [en,fr]=context.message('PROJECT_RETURN_CAPACITY','journey-import');
  assert.match(en,/saved no project, started no execution and created or consumed no grant/);assert.match(en,/Keep the original file and existing history/);
  assert.match(fr,/enregistré aucun projet/);assert.match(fr,/Conservez le fichier original et l’historique existant/);
  assert.match(context.message('OUTPUT_SIZE','journey-prepare')[0],/No new grant was prepared or consumed/);
  assert.equal(context.message('OUTPUT_SIZE','run'),null,'post-dispatch failures must never claim a grant was not consumed');
  assert.equal(context.message('PROJECT_RETURN_CAPACITY','journey-export'),null,'historical export does not claim no earlier work occurred');
  const [storageEn,storageFr]=context.message('JOURNEY_STORAGE_LIMIT','journey-import');
  assert.match(storageEn,/pending and completed projects/);assert.match(storageEn,/at most 32 rows/);
  assert.match(storageFr,/projets en attente et terminés/);assert.match(storageFr,/au plus 32 entrées/);
  assert.equal(context.message('JOURNEY_STORAGE_LIMIT','journey-export'),null);

});
