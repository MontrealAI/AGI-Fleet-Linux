import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewJob, DECLARATION } from '../src/review.mjs';
import { sha256 } from '../src/util.mjs';
import { Companion, COMPANION_DEFAULT } from '../src/control/companion.mjs';
import { Controller } from '../src/control/controller.mjs';
import { imageSpec,png } from './image-fixture.mjs';
const bytes=png(),specBytes=Buffer.from(JSON.stringify(imageSpec));
const reader={read:async()=>({bytes:specBytes,sha256:sha256(specBytes)}),readImage:async()=>({bytes,sha256:sha256(bytes)})};
const snapshot={specURI:'ipfs://spec-fixture',completionURI:'ipfs://image-fixture'},row={details:DECLARATION};
const enabled={enabled:false,cloudVeto:true,cloudPublicOnly:true,reviewImages:true};
test('image review is opt-in and always requires multimodal review and public consent',async()=>{
  for(const ai of [{enabled:false},{...enabled,reviewImages:false},{...enabled,cloudVeto:false},{...enabled,cloudPublicOnly:false}])assert.equal((await reviewJob(row,snapshot,reader,ai,async()=>({verdict:'consistent'}))).decision,'abstain');
  assert.equal((await reviewJob(row,snapshot,reader,enabled)).decision,'abstain');
  const local=await reviewJob(row,snapshot,reader,{...enabled,enabled:true},async()=>({verdict:'consistent'}));assert.equal(local.reason,'LOCAL_IMAGE_REVIEW_UNSUPPORTED');
});
test('Node visual concern, unavailability or bad PNG never becomes approval',async()=>{
  for(const verdict of ['concern','uncertain'])assert.equal((await reviewJob(row,snapshot,reader,enabled,async()=>({verdict}))).decision,'abstain');
  assert.equal((await reviewJob(row,snapshot,reader,enabled,async()=>{throw Error('offline');})).decision,'abstain');
  const invalid={...reader,readImage:async()=>({bytes:Buffer.from('bad'),sha256:sha256('bad')})};let calls=0;
  assert.equal((await reviewJob(row,snapshot,invalid,enabled,async()=>{calls++;return {verdict:'consistent'};})).decision,'reject');assert.equal(calls,0);
  const accepted=await reviewJob(row,snapshot,reader,enabled,async()=>({verdict:'consistent'}));assert.equal(accepted.decision,'approve');assert.equal(accepted.deliveryHash,sha256(bytes));
});
test('Node gateway review sends actual pixels and never grants tools',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-node-vision-'));let body;
  const c=new Companion(dir,()=> 'a'.repeat(64),{fetchImpl:async(url,opts)=>{body=JSON.parse(opts.body);return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({safeToReview:true,checks:imageSpec.criteria.map(x=>({id:x.id,status:'pass'}))})}}]});}});
  try {
    await c.configure({...COMPANION_DEFAULT,enabled:true,acknowledged:true});await c.request('vision',{specification:imageSpec,image:bytes.toString('base64')});
    assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice,'none');assert.equal(body.messages[1].content[1].image_url.url,'data:image/png;base64,'+bytes.toString('base64'));assert.ok(!body.messages[1].content[0].text.includes(bytes.toString('base64')));
  }finally{await c.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual Node controller rejects incomplete visual checklist even when provider returns success',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-node-image-controller-')),c=new Controller(dir);
  try {
    await c.createVault('Only a fixture password 123!');c.desired=true;c.worker={};c.config.ai={...c.config.ai,...enabled};
    let payload;c.companion.request=async(kind,data)=>{payload={kind,data};return {safeToReview:true,checks:[{id:'blue',status:'pass'}]};};
    await assert.rejects(c.cloudReview({specification:imageSpec,delivery:bytes.toString('base64')}),/IMAGE_REVIEW_INVALID/);
    assert.equal(payload.kind,'vision');assert.equal(payload.data.image,bytes.toString('base64'));
    c.companion.request=async()=>({safeToReview:true,checks:imageSpec.criteria.map(x=>({id:x.id,status:'pass'}))});
    assert.equal((await c.cloudReview({specification:imageSpec,delivery:bytes.toString('base64')})).verdict,'consistent');
  }finally{c.desired=false;c.worker=null;await c.close();fs.rmSync(dir,{recursive:true,force:true});}
});
