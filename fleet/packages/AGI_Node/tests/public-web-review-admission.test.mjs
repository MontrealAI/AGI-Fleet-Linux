import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewJob,DECLARATION} from '../src/review.mjs';
import {buildBundle} from '../src/artifacts.mjs';
import {createExecutionAdmission} from '../src/public-web-admission.mjs';
import {canonical,sha256} from '../src/util.mjs';

function fixture(){
  const spec=JSON.parse(fs.readFileSync(new URL('../examples/computer-work-v2.json',import.meta.url)));
  spec.publicWeb={agent:null,reviewer:{hosts:[{hostname:'example.com',ports:[443]}],limits:{maxRequests:8,maxConnections:2,maxBytes:4096}}};
  spec.environment.capabilities.reviewer.push('browser');spec.authority.reviewer.resources.push('public-web');
  const source=Buffer.from(JSON.stringify(spec,null,2)),delivery=Buffer.from(buildBundle(spec,new Map([['result.json',Buffer.from('{"result":true}')]])));
  const reader={read:async()=>({bytes:source,sha256:sha256(source)}),readBundle:async()=>({bytes:delivery,sha256:sha256(delivery)})};
  const run=(reviewer,beforeModel)=>reviewJob({id:'91',details:DECLARATION},{specURI:'ipfs://spec',completionURI:'ipfs://delivery'},reader,{enabled:false,reviewComputerWork:true,cloudVeto:true,cloudPublicOnly:true},reviewer,beforeModel);
  return {spec,source,delivery,run};
}

test('tool review receives only the context returned by the pre-model admission callback',async()=>{
  const f=fixture(),events=[];let admitted;
  const result=await f.run(async(spec,delivery,executionAdmission)=>{
    events.push('review');assert.deepEqual(spec,f.spec);assert.deepEqual(delivery,f.delivery);assert.equal(executionAdmission,admitted);
    assert.equal(executionAdmission.role,'reviewer');assert.equal(executionAdmission.acceptedSpecSha256,sha256(canonical(f.spec)));
    assert.equal(executionAdmission.sourceSpecSha256,sha256(f.source));assert.notEqual(executionAdmission.sourceSpecSha256,executionAdmission.acceptedSpecSha256);
    return {verdict:'concern'};
  },async({specification,specHash,deliveryHash,decision})=>{
    events.push('admission');assert.equal(decision,'approve');assert.equal(deliveryHash,sha256(f.delivery));
    admitted=createExecutionAdmission({specification,sourceSpecSha256:specHash,chainId:f.spec.settlement.chainId,manager:f.spec.settlement.manager,jobID:'91',role:'reviewer'});return admitted;
  });
  assert.deepEqual(events,['admission','review']);assert.equal(result.reason,'CLOUD_AI_VETO');
});

test('failed pre-model admission prevents public web reviewer invocation',async()=>{
  const f=fixture();let called=false;
  const result=await f.run(async()=>{called=true;return {verdict:'concern'};},async()=>{throw Error('ADMISSION_DENIED');});
  assert.equal(called,false);assert.equal(result.decision,'abstain');
});

test('observation review does not fabricate execution admission when no callback exists',async()=>{
  const f=fixture();let observed='unset';
  await f.run(async(_spec,_delivery,executionAdmission)=>{observed=executionAdmission;return {verdict:'concern'};},null);
  assert.equal(observed,null);
});
