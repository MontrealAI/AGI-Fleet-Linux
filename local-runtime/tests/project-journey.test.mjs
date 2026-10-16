import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fixture} from './helpers.mjs';
import {nativeProject as project} from './fixtures/project.mjs';
import {canonical,digest} from '../contracts.mjs';
import {ALPHA_NATIVE_SOURCE} from '../project/native-source.mjs';
import {createProjectRequest,inspectProjectRequest,inspectProjectReturn} from '../project/transfer.mjs';


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
