import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {cloudReviewResult,sendCloudReviewResult} from '../src/cloud-review-result.mjs';
const valid={verdict:'consistent',checks:[{id:'result',status:'pass',method:'Recomputed the fixture result',observed:'The declared result matched',files:['result.json']}]};
function roundTrip(reply,{controllerReply=false}={}){
 return new Promise((resolve,reject)=>{
  const child=fork(new URL('./helpers/cloud-review-ipc-fixture.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']});let settled=false,stderr='';
  const timer=setTimeout(()=>finish(Error('IPC fixture timed out')),10000);
  function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill('SIGKILL');reject(error);}else resolve(result);}
  child.stderr.on('data',chunk=>{stderr+=chunk;});child.once('error',error=>finish(error));
  child.on('message',message=>{
   if(message.type==='cloud-review'){
    try{assert.equal(message.specification.profile,'computer-work/v2');assert.ok(Buffer.from(message.delivery,'base64').length>0);if(controllerReply)void sendCloudReviewResult(child,message.id,typeof reply==='function'?reply():Promise.resolve(reply));else child.send({type:'cloud-review-result',id:message.id,...reply});}catch(error){finish(error);}
   }else if(message.type==='fixture-review-result')finish(null,message.result);
  });
  child.once('exit',code=>{if(!settled)finish(Error('IPC fixture exited '+code+': '+stderr));});
 });
}
test('real worker IPC preserves full computer-review evidence for schema-aware approval',async()=>{
 const sent=cloudReviewResult({...valid,at:123,cached:false});assert.deepEqual(sent,valid);
 const result=await roundTrip(sent);assert.equal(result.decision,'approve');assert.deepEqual(result.computerReview,valid.checks);
});
test('real worker IPC cannot turn a verdict or unrelated criterion into computer approval',async()=>{
 for(const reply of [{verdict:'consistent'},{verdict:'consistent',checks:[{id:'result',status:'pass'}]}, {...valid,checks:[{...valid.checks[0],id:'unrelated'}]}, {...valid,checks:[{...valid.checks[0],files:['undeclared.json']}]}, {...valid,checks:[{...valid.checks[0],method:700}]}]) {
  const result=await roundTrip(reply);assert.equal(result.decision,'abstain');assert.equal(result.reason,'CLOUD_AI_UNAVAILABLE');
 }
});
test('IPC result projection accepts image checks and rejects unsafe computer check fields',()=>{
 assert.deepEqual(cloudReviewResult({verdict:'consistent',checks:[{id:'subject',status:'pass'}]}),{verdict:'consistent',checks:[{id:'subject',status:'pass'}]});
 for(const change of [{verdict:'approve'},{checks:[{...valid.checks[0],execute:'untrusted'}]},{checks:[{...valid.checks[0],files:['../escape']}]},{checks:[{...valid.checks[0],method:'x'.repeat(701)}]},{checks:[{...valid.checks[0],observed:'x'.repeat(1201)}]},{checks:[valid.checks[0],valid.checks[0]]}])assert.throws(()=>cloudReviewResult({...valid,...change}));
});

test('controller reply settles the real worker promptly when projection or provider review fails',async()=>{
 for(const reply of [{...valid,checks:[{...valid.checks[0],method:700}]},()=>Promise.reject(Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR'))]){
  const result=await roundTrip(reply,{controllerReply:true});assert.equal(result.decision,'abstain');assert.equal(result.reason,'CLOUD_AI_UNAVAILABLE');assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_PROVIDER_ERROR'),false);
 }
 const result=await roundTrip({...valid,at:123,cached:false},{controllerReply:true});assert.equal(result.decision,'approve');assert.deepEqual(result.computerReview,valid.checks);
});
