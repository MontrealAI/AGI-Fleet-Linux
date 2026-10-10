import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageSpec, inspectPNG, decodeImage, evaluateImage, visionVerdict } from '../src/images.mjs';
import { validateSpec, evaluate, DECLARATION } from '../src/review.mjs';
import { imageSpec, png, chunk } from './image-fixture.mjs';
const bytes=png();
test('shared PNG profile validates actual pixels and exact dimensions',()=>{
  assert.equal(validateSpec(imageSpec),imageSpec);assert.equal(inspectPNG(bytes).width,1024);
  assert.equal(evaluate(imageSpec,bytes).decision,'approve');
  assert.equal(evaluate({...imageSpec,width:2048},bytes).decision,'reject');
  assert.equal(evaluate({...imageSpec,maxBytes:1024},bytes).decision,'reject');
  assert.deepEqual(decodeImage(bytes.toString('base64')),bytes);
});
test('image specification rejects hidden fields, duplicate criteria and unsupported dimensions',()=>{
  for(const s of [{...imageSpec,tools:['wallet']},{...imageSpec,dataPolicy:'private'},{...imageSpec,criteria:[imageSpec.criteria[0],imageSpec.criteria[0]]},{...imageSpec,width:1025}])assert.throws(()=>validateImageSpec(s));
});
test('PNG parser rejects corrupt, trailing, truncated, animated and impossible image data',()=>{
  const corrupt=Buffer.from(bytes);corrupt[50]^=1;
  const animated=Buffer.concat([bytes.subarray(0,33),chunk('acTL',Buffer.alloc(8)),bytes.subarray(33)]);
  for(const b of [corrupt,bytes.subarray(0,-2),Buffer.concat([bytes,Buffer.from('ignored')]),animated,Buffer.from('not-an-image')])assert.throws(()=>inspectPNG(b));
  assert.throws(()=>decodeImage('YQ==='));assert.throws(()=>decodeImage('Y Q=='));
});
test('visual approval requires every exact criterion once and a safe review',()=>{
  const v={safeToReview:true,checks:imageSpec.criteria.map(c=>({id:c.id,status:'pass'}))};
  assert.equal(visionVerdict(imageSpec,v).verdict,'consistent');
  assert.equal(visionVerdict(imageSpec,{...v,safeToReview:false}).verdict,'uncertain');
  assert.equal(visionVerdict(imageSpec,{...v,checks:[v.checks[0],{id:'white',status:'uncertain'}]}).verdict,'uncertain');
  for(const checks of [[],[v.checks[0],v.checks[0]],[v.checks[0],{id:'other',status:'pass'}]])assert.throws(()=>visionVerdict(imageSpec,{...v,checks}));
});
