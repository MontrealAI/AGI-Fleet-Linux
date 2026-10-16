import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers.mjs';
import {perform} from '../worker.mjs';
import {decodeUTF8} from '../primitives.mjs';
import {nativeProject as project} from './fixtures/project.mjs';
import {canonical,digest} from '../contracts.mjs';
import {ALPHA_NATIVE_SOURCE} from '../project/native-source.mjs';
import {createProjectRequest,inspectProjectRequest,inspectProjectReturn,PROJECT_BYTES,PROJECT_OBSERVATION_BYTES} from '../project/transfer.mjs';


const reseal=value=>{delete value.sha256;return canonical({...value,sha256:digest(value)});};

test('vendored native validation closure retains exact upstream bytes and license',()=>{
  for(const file of ALPHA_NATIVE_SOURCE.files)assert.equal(digest(fs.readFileSync(new URL('../project/vendor/alpha/'+file.path,import.meta.url))),file.sha256,file.path);
  assert.equal(ALPHA_NATIVE_SOURCE.commit,'92e227c007d484323c7fd2a7001b9bb5b229e717');
});
for(const language of ['en','fr'])for(const route of ['manager-usdc','agijobsv0-jobregistry-v2'])test(language+' '+route+': exact project→separate authorized execution/check→historical return',async()=>{
  const f=fixture();try{
    const original=await project(),request=await createProjectRequest(original,{language,route}),checked=await inspectProjectRequest(request);
    assert.equal(checked.request.upstream.raw,original);assert.equal(checked.request.project.projectId,'project-retained');
    assert.equal(checked.request.route.asset,route==='manager-usdc'?'USDC':'AGIALPHA');
    const imported=await f.runtime.dispatch('journey-import',{request,confirm:true},f.operator);
    assert.equal(imported.runAuthorized,false);assert.equal(f.runtime.status(f.operator).runs.length,0);
    const a=f.create(),n=f.create('node'),client=f.runtime.issueClient(a.id).principal;
    await assert.rejects(f.runtime.dispatch('journey-inspect',{journey:imported.journey},client),/CLIENT_SCOPE_DENIED/);
    let g=await f.runtime.dispatch('journey-prepare',{journey:imported.journey,actor:a.id},f.operator);
    await assert.rejects(f.run(a,g),/GRANT_UNAVAILABLE/);f.authorize(g);const execution=await f.run(a,g);
    g=await f.runtime.dispatch('journey-review-prepare',{journey:imported.journey,execution:execution.run,actor:n.id},f.operator);
    assert.equal(g.reviewClass,'internal');f.authorize(g);const review=await f.run(n,g);
    const exported=await f.runtime.dispatch('journey-export',{journey:imported.journey,execution:execution.run,review:review.run,confirm:true},f.operator);
    const read=await inspectProjectReturn(exported.returned),totals=JSON.parse(read.files.find(file=>file.name==='result.json').content);
    assert.equal(read.request.upstream.raw,original);assert.equal(read.reviewClass,'historical-internal');assert.equal(read.independentReview,false);assert.equal(read.productionQualified,false);
    assert.equal(totals.includedRows,3);assert.equal(totals.groups.find(row=>row.category==='Énergie').total,'4');
    assert.equal((await f.runtime.dispatch('journey-inspect',{journey:imported.journey},f.operator)).returned,exported.returned);
    assert.equal(f.runtime.status(f.operator).economicAuthority,false);
    const changed=JSON.parse(exported.returned);changed.route.asset=route==='manager-usdc'?'AGIALPHA':'USDC';await assert.rejects(inspectProjectReturn(reseal(changed)),/PROJECT_RETURN_IDENTITY/);
    const receipt=JSON.parse(exported.returned);receipt.review.actorId=receipt.execution.actorId;await assert.rejects(inspectProjectReturn(reseal(receipt)),/PROJECT_RECEIPT_AUTHORITY|PROJECT_SEPARATE_REVIEW_REQUIRED/);
  }finally{f.close();}
});
test('project request rejects rehashed task, unit, duplicate, route, identity and authority substitutions',async()=>{
  const original=await project(),request=await createProjectRequest(original,{language:'en',route:'manager-usdc'});
  for(const change of [v=>v.task.input.mission.input='[]',v=>v.mapping.units='converted',v=>v.mapping.duplicates='deduplicated',v=>v.project.projectId='swapped',v=>v.route.asset='AGIALPHA',v=>v.authority='approved',v=>v.productionQualified=true]){
    const changed=JSON.parse(request);change(changed);await assert.rejects(inspectProjectRequest(reseal(changed)));
  }
  const invalid=JSON.parse(original);invalid.cycles[0].records[0].bytes+=' ';
  await assert.rejects(createProjectRequest(canonical(invalid),{language:'en',route:'manager-usdc'}));
  await assert.rejects(createProjectRequest(original,{language:'en'}),/PROJECT_ROUTE_REQUIRED/);
});
test('foreign or rejected execution cannot be returned and saved request cannot overwrite another project',async()=>{
  const f=fixture();try{
    const request=await createProjectRequest(await project(),{language:'en',route:'manager-usdc'}),imported=await f.runtime.dispatch('journey-import',{request,confirm:true},f.operator);
    const a=f.create();let g=f.prepare(a);f.authorize(g);const execution=await f.run(a,g);
    await assert.rejects(f.runtime.dispatch('journey-review-prepare',{journey:imported.journey,execution:execution.run,actor:a.id},f.operator),/JOURNEY_PROJECT_BINDING/);
    await assert.rejects(f.runtime.dispatch('journey-export',{journey:imported.journey,execution:crypto.randomUUID(),review:crypto.randomUUID(),confirm:true},f.operator),/JOURNEY_EXECUTION_REQUIRED/);
  }finally{f.close();}
});
test('identical tasks cannot transplant authorized execution or internal review across projects, cycles or routes',async()=>{
  const f=fixture();try{
    const request=await createProjectRequest(await project(),{language:'en',route:'manager-usdc'}),imported=await f.runtime.dispatch('journey-import',{request,confirm:true},f.operator),a=f.create(),n=f.create('node');
    let grant=await f.runtime.dispatch('journey-prepare',{journey:imported.journey,actor:a.id},f.operator);f.authorize(grant);const execution=await f.run(a,grant);
    grant=await f.runtime.dispatch('journey-review-prepare',{journey:imported.journey,execution:execution.run,actor:n.id},f.operator);f.authorize(grant);const review=await f.run(n,grant);
    for(const [ids,route] of [[{projectId:'different-project'},'manager-usdc'],[{cycleId:'different-cycle'},'manager-usdc'],[{},'agijobsv0-jobregistry-v2']]){
      const otherRequest=await createProjectRequest(await project(ids),{language:'en',route});
      assert.deepEqual(JSON.parse(otherRequest).task,JSON.parse(request).task);
      const other=await f.runtime.dispatch('journey-import',{request:otherRequest,confirm:true},f.operator);
      await assert.rejects(f.runtime.dispatch('journey-review-prepare',{journey:other.journey,execution:execution.run,actor:n.id},f.operator),/JOURNEY_PROJECT_BINDING/);
      await assert.rejects(f.runtime.dispatch('journey-export',{journey:other.journey,execution:execution.run,review:review.run,confirm:true},f.operator),/JOURNEY_PROJECT_BINDING/);
    }
  }finally{f.close();}
});
test('near-limit requests reserve their complete return before grants, including escaped observations and concurrent history',async()=>{
  const observation={processGroupGone:true,evidenceClass:'SYNTHETIC_CAPACITY_FIXTURE; no OS isolation',padding:''};
  observation.padding='\\'.repeat(Math.floor((PROJECT_OBSERVATION_BYTES-Buffer.byteLength(canonical(observation)))/2));
  const f=fixture({execute:async({role,task})=>({result:await perform(role,task),observation})});try{
    const compact=await createProjectRequest(await project(),{language:'en',route:'manager-usdc'}),first=await inspectProjectRequest(compact);
    const padding=Math.min(PROJECT_BYTES-Buffer.byteLength(compact),PROJECT_BYTES-first.capacity.returnUpperBytes,Math.floor((PROJECT_BYTES-first.capacity.storageUpperBytes)/2));
    const request=compact+' '.repeat(padding),checked=await inspectProjectRequest(request);
    assert.ok(checked.capacity.storageUpperBytes>=PROJECT_BYTES-1);
    const imported=await f.runtime.dispatch('journey-import',{request,confirm:true},f.operator),a=f.create(),n=f.create('node'),unused=f.prepare(a);
    const grantsBefore=f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,eventsBefore=f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    const originalRow=f.runtime.store.db.prepare('SELECT value FROM journeys WHERE id=?').get(imported.journey).value;
    for(const oversized of [request+' ',compact+' '.repeat(3_993_000-Buffer.byteLength(compact))]){
      await assert.rejects(inspectProjectRequest(oversized),/PROJECT_RETURN_CAPACITY/);
      await assert.rejects(f.runtime.dispatch('journey-import',{request:oversized,confirm:true},f.operator),/PROJECT_RETURN_CAPACITY/);
    }
    const legacy=crypto.randomUUID();f.runtime.store.db.prepare('INSERT INTO journeys VALUES(?,?)').run(legacy,canonical({schema:'agi-fleet/local-journey/v1',request:request+' ',project:checked.request.project,route:checked.request.route,returned:null}));
    await assert.rejects(f.runtime.dispatch('journey-prepare',{journey:legacy,actor:a.id},f.operator),/PROJECT_RETURN_CAPACITY/);
    f.runtime.store.db.prepare('DELETE FROM journeys WHERE id=?').run(legacy);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,grantsBefore);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,eventsBefore);
    assert.equal(f.runtime.store.db.prepare('SELECT value FROM journeys WHERE id=?').get(imported.journey).value,originalRow);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(unused.grant).state,'prepared');
    assert.equal(f.runtime.status(f.operator).runs.length,0);
    // Later imports count reserved final rows, not merely today's smaller rows.
    for(let i=0;i<7;i++)await f.runtime.dispatch('journey-import',{request,confirm:true},f.operator);
    await assert.rejects(f.runtime.dispatch('journey-import',{request,confirm:true},f.operator),/JOURNEY_STORAGE_LIMIT/);
    let grant=await f.runtime.dispatch('journey-prepare',{journey:imported.journey,actor:a.id},f.operator);f.authorize(grant);const execution=await f.run(a,grant);
    grant=await f.runtime.dispatch('journey-review-prepare',{journey:imported.journey,execution:execution.run,actor:n.id},f.operator);f.authorize(grant);const review=await f.run(n,grant);
    const exported=await f.runtime.dispatch('journey-export',{journey:imported.journey,execution:execution.run,review:review.run,confirm:true},f.operator);
    await inspectProjectReturn(exported.returned);
    const saved=f.runtime.store.db.prepare('SELECT value FROM journeys WHERE id=?').get(imported.journey).value;
    assert.ok(Buffer.byteLength(exported.returned)<=checked.capacity.returnUpperBytes);
    assert.ok(Buffer.byteLength(saved)<=checked.capacity.storageUpperBytes);
    assert.equal(JSON.parse(saved).reservedBytes,checked.capacity.storageUpperBytes);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(unused.grant).state,'prepared');
    const changed=JSON.parse(exported.returned),receipt=JSON.parse(changed.review.raw);receipt.observation.padding='x'.repeat(PROJECT_OBSERVATION_BYTES);
    changed.review.raw=canonical(receipt);changed.review.sha256=digest(changed.review.raw);
    await assert.rejects(inspectProjectReturn(reseal(changed)),/PROJECT_OBSERVATION_LIMIT/);
  }finally{f.close();}
  for(const reason of ['PROJECT_OBSERVATION_LIMIT','PROJECT_OUTPUT_CHANGED','FIELDS','PRIVATE_INPUT']){
    const blocked=fixture({execute:async({role,task})=>({result:{...await perform(role,task),...(reason==='PROJECT_OUTPUT_CHANGED'?{unreserved:'extra result'}:{})},observation:{processGroupGone:true,evidenceClass:'SYNTHETIC_INVALID_BACKEND',padding:reason==='PROJECT_OBSERVATION_LIMIT'?'x'.repeat(PROJECT_OBSERVATION_BYTES):'',...(reason==='PRIVATE_INPUT'?{note:'api_key=synthetic-test-abcdefghijklmnop'}:{})},...(reason==='FIELDS'?{unexpected:'unreserved outer field'}:{})})});
    try{
      const request=await createProjectRequest(await project(),{language:'en',route:'manager-usdc'}),imported=await blocked.runtime.dispatch('journey-import',{request,confirm:true},blocked.operator),a=blocked.create();
      const grant=await blocked.runtime.dispatch('journey-prepare',{journey:imported.journey,actor:a.id},blocked.operator);blocked.authorize(grant);
      await assert.rejects(blocked.run(a,grant),new RegExp(reason));
      assert.equal(blocked.runtime.status(blocked.operator).runs[0].state,'uncertain');
      assert.equal(blocked.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(grant.grant).state,'consumed');
      assert.equal(blocked.runtime.store.meta('stopped'),true);
      assert.equal((await blocked.runtime.dispatch('journey-inspect',{journey:imported.journey},blocked.operator)).returned,null);
    }finally{blocked.close();}
  }
});
test('exact UTF-8 imports preserve BOM bytes for rejection instead of normalizing or replacing them',async()=>{
  const request=await createProjectRequest(await project(),{language:'fr',route:'agijobsv0-jobregistry-v2'}),bom=Buffer.from([239,187,191]);
  const encoded=Buffer.concat([bom,Buffer.from(request)]),decoded=decodeUTF8(encoded);
  assert.equal(decoded,'\uFEFF'+request);assert.deepEqual(Buffer.from(decoded),encoded);
  await assert.rejects(inspectProjectRequest(decoded),/JSON/);
  assert.throws(()=>decodeUTF8(Buffer.from([255])),/UTF8_REQUIRED/);
  const embedded='{"retained":"\uFEFFÉnergie"}';assert.equal(decodeUTF8(Buffer.from(embedded)),embedded);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-exact-utf8-'));try{
    for(const [name,raw,code] of [['bom',Buffer.concat([bom,Buffer.from('{}')]),'JSON'],['invalid',Buffer.from([255]),'UTF8_REQUIRED']]){
      const input=path.join(directory,name+'.json');fs.writeFileSync(input,raw,{mode:0o600});
      const result=spawnSync(process.execPath,[new URL('../cli/main.mjs',import.meta.url).pathname,'request','journey-import',input],{encoding:'utf8',env:{...process.env,AGI_LOCAL_STATE:path.join(directory,'not-initialized')}});
      assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error,code);
    }
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
