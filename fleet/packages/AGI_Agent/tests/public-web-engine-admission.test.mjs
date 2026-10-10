import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../src/engine.mjs';
import {decodeWork} from '../src/work.mjs';
import {DECLARATION} from '../src/review.mjs';
import {buildBundle} from '../src/artifacts.mjs';
import {canonical,sha256} from '../src/util.mjs';

function fixture({role='agent',stage='new'}={}) {
  const spec=JSON.parse(fs.readFileSync(new URL('../examples/computer-work-v2.json',import.meta.url)));
  spec.publicWeb={agent:null,reviewer:null};
  spec.publicWeb[role]={hosts:[{hostname:'example.com',ports:[443]}],limits:{maxRequests:8,maxConnections:2,maxBytes:4096}};
  spec.environment.capabilities[role].push('browser');
  spec.authority[role].resources.push('public-web');
  let source=Buffer.from(JSON.stringify(spec,null,2));
  let saved={binding:'prepared',spec_hash:sha256(source),spec:decodeWork(source,DECLARATION,false),stage,attempts:0};
  if(stage==='draft')saved.content=buildBundle(spec,new Map([['result.json',Buffer.from('{"result":true}')]]));
  const events=[],executed=[],engine=Object.create(Engine.prototype);
  Object.assign(engine,{
    c:{chainId:spec.settlement.chainId,manager:spec.settlement.manager,execution:{allowComputerWork:true,allowEnvelopes:false,publicDataOnly:true,publicPublishing:true,maxAttempts:3}},
    live:true,preparationBinding:'prepared',binding:'live',
    chain:{assertAgentAuthorized:async()=>{}},
    store:{work:()=>saved,saveWork:(_id,value)=>{saved=value;},putJob:()=>{}},
    reader:{read:async uri=>{events.push('source:'+uri);return {bytes:source,sha256:sha256(source)};}},
    tx:{assertActive:()=>{},admission:{check:async()=>{events.push('admission');},consumePreparation:()=>{events.push('consume');}}},
    executor:async(kind,input)=>{events.push('execute');executed.push({kind,input});return kind==='generate'?{status:'decline',content:''}:{verdict:'pass'};},
  });
  return {engine,spec,events,executed,work:()=>saved,setSource:value=>{source=value;},prepare:()=>engine.prepare({id:'37',details:DECLARATION},{specURI:'ipfs://accepted-spec'})};
}

test('web generation binds the fresh raw source and canonical accepted spec after admission',async()=>{
  const f=fixture();await f.prepare();
  assert.deepEqual(f.events,['source:ipfs://accepted-spec','admission','consume','execute']);
  const {kind,input}=f.executed[0];assert.equal(kind,'generate');
  assert.deepEqual(input.executionAdmission,{
    schema:'agi-public-web-admission/v1',chainId:f.spec.settlement.chainId,manager:f.spec.settlement.manager,jobID:'37',role:'agent',
    acceptedSpecSha256:sha256(canonical(f.spec)),sourceSpecSha256:f.work().spec_hash,runtimeSha256:f.spec.environment.runtimeSha256.agent,
  });
  assert.notEqual(input.executionAdmission.acceptedSpecSha256,input.executionAdmission.sourceSpecSha256);
});

test('persisted work scope cannot be expanded while retaining the accepted source hash',async()=>{
  const f=fixture();f.work().spec.acceptance.publicWeb.agent.hosts.push({hostname:'other.example.com',ports:[443]});
  await assert.rejects(f.prepare(),/PUBLIC_WEB_ACCEPTED_WORK_CHANGED/);
  assert.deepEqual(f.events,['source:ipfs://accepted-spec']);assert.equal(f.executed.length,0);
});

test('raw source byte changes cannot retain an accepted canonical spec binding',async()=>{
  const f=fixture();f.setSource(Buffer.from(canonical(f.spec)));
  await assert.rejects(f.prepare(),/PUBLIC_WEB_ACCEPTED_SOURCE_CHANGED/);
  assert.deepEqual(f.events,['source:ipfs://accepted-spec']);assert.equal(f.executed.length,0);
});

test('failed admission never reaches web execution',async()=>{
  const f=fixture();f.engine.tx.admission.check=async()=>{throw Error('ADMISSION_DENIED');};
  await assert.rejects(f.prepare(),/ADMISSION_DENIED/);assert.equal(f.executed.length,0);
});

test('scope mutation while economic admission is pending cannot become accepted work',async()=>{
  const f=fixture();f.engine.tx.admission.check=async()=>{f.work().spec.acceptance.publicWeb.agent.hosts.push({hostname:'other.example.com',ports:[443]});};
  await assert.rejects(f.prepare(),/PUBLIC_WEB_ACCEPTED_WORK_CHANGED/);assert.equal(f.executed.length,0);
});

test('computer quality uses reviewer scope and fresh accepted source identity',async()=>{
  const f=fixture({role:'reviewer',stage:'draft'});await f.prepare();
  assert.deepEqual(f.events,['source:ipfs://accepted-spec','admission','consume','execute']);
  assert.equal(f.executed[0].kind,'quality');assert.equal(f.executed[0].input.executionAdmission.role,'reviewer');
  assert.equal(f.executed[0].input.executionAdmission.runtimeSha256,f.spec.environment.runtimeSha256.reviewer);
  assert.equal(f.executed[0].input.executionAdmission.sourceSpecSha256,f.work().spec_hash);
});
