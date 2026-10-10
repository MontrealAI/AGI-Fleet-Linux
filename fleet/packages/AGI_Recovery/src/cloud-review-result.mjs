import {ensure,strictKeys} from './util.mjs';
import core from './admission-core/economics/computer-work.cjs';

// Project only reviewed evidence onto IPC. Criterion/output membership remains
// the schema-aware reviewer's responsibility after the message is received.
export function cloudReviewResult(value) {
 ensure(value&&typeof value==='object'&&!Array.isArray(value)&&['consistent','concern','uncertain'].includes(value.verdict),'CLOUD_REVIEW_RESULT_INVALID');
 const result={verdict:value.verdict};
 if(Object.hasOwn(value,'checks')) {
  ensure(Array.isArray(value.checks)&&value.checks.length>0&&value.checks.length<=64,'CLOUD_REVIEW_RESULT_INVALID');
  const ids=new Set();
  result.checks=value.checks.map(check=>{
   ensure(check&&typeof check==='object'&&!Array.isArray(check),'CLOUD_REVIEW_RESULT_INVALID');
   const computer=Object.hasOwn(check,'method')||Object.hasOwn(check,'observed')||Object.hasOwn(check,'files');
   strictKeys(check,computer?['id','status','method','observed','files']:['id','status'],'CLOUD_REVIEW_RESULT_INVALID');
   ensure(typeof check.id==='string'&&/^[a-z0-9_-]{1,40}$/.test(check.id)&&!ids.has(check.id)&&['pass','fail','uncertain'].includes(check.status),'CLOUD_REVIEW_RESULT_INVALID');ids.add(check.id);
   if(computer) {
    ensure(typeof check.method==='string'&&check.method.length>0&&check.method.length<=700&&typeof check.observed==='string'&&check.observed.length>0&&check.observed.length<=1200&&Array.isArray(check.files)&&check.files.length>0&&check.files.length<=64&&new Set(check.files).size===check.files.length,'CLOUD_REVIEW_RESULT_INVALID');
    for(const name of check.files)core.safeName(name);
   }
   return structuredClone(check);
  });
 }
 ensure(Buffer.byteLength(JSON.stringify(result))<=196608,'CLOUD_REVIEW_RESULT_INVALID');
 return result;
}

// Always settle a live worker's request, including invalid projected evidence.
// A provider exception or malformed result confers no approval authority.
export async function sendCloudReviewResult(child,id,review){
 let result;try{result=cloudReviewResult(await review);}catch{result={error:'CLOUD_AI_UNAVAILABLE'};}
 if(child.connected)try{child.send({type:'cloud-review-result',id,...result},()=>{});}catch{}
}
