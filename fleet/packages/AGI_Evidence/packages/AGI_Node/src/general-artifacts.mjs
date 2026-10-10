import core from './admission-core/economics/computer-work.cjs';
import {ensure,strictKeys,canonical,sha256} from './util.mjs';
import {boundedJSON} from './review.mjs';
export const isGeneralSpec=s=>s?.profile==='computer-work/v2';
export const validateGeneralSpec=core.validateComputerWork;
export function inspectGeneralArtifact(f,bytes){core.safeName(f.name);ensure(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=f.maxBytes&&bytes.length<=core.MAX_FILE_BYTES,'GENERAL_ARTIFACT_SIZE');return {name:f.name,mediaType:f.mediaType,bytes:bytes.length,sha256:sha256(bytes)};}
export function buildGeneralBundle(spec,files){
 validateGeneralSpec(spec);ensure(files.size===spec.outputs.length,'GENERAL_OUTPUT_COUNT');
 const bundle={schema:'agi-work-bundle/v2',specHash:sha256(canonical(spec)),files:spec.outputs.map(f=>{const b=files.get(f.name);return {...inspectGeneralArtifact(f,b),content:b.toString('base64')};})};
 const content=canonical(bundle);validateGeneralBundle(spec,Buffer.from(content));return content;
}
export function validateGeneralBundle(spec,bytes){
 validateGeneralSpec(spec);ensure(bytes.length>0&&bytes.length<=core.MAX_BUNDLE_BYTES,'GENERAL_BUNDLE_SIZE');
 const b=boundedJSON(bytes);strictKeys(b,['schema','specHash','files'],'GENERAL_BUNDLE_FIELDS');
 ensure(b.schema==='agi-work-bundle/v2'&&b.specHash===sha256(canonical(spec))&&Array.isArray(b.files)&&b.files.length===spec.outputs.length,'GENERAL_BUNDLE_SCOPE');
 const files=new Map();let total=0;
 for(let i=0;i<b.files.length;i++){
  const f=b.files[i],r=spec.outputs[i];strictKeys(f,['name','mediaType','bytes','sha256','content'],'GENERAL_ARTIFACT_FIELDS');
  ensure(f.name===r.name&&f.mediaType===r.mediaType&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=r.maxBytes&&typeof f.content==='string'&&f.content.length<=4*Math.ceil(r.maxBytes/3),'GENERAL_ARTIFACT');
  const raw=Buffer.from(f.content,'base64');ensure(raw.toString('base64')===f.content&&raw.length===f.bytes&&sha256(raw)===f.sha256,'GENERAL_ARTIFACT_HASH');
  inspectGeneralArtifact(r,raw);total+=raw.length;ensure(total<=core.MAX_TOTAL_BYTES,'GENERAL_BUNDLE_SIZE');files.set(f.name,raw);
 }
 return {bundle:b,files};
}
export function generalVerdict(spec,v){
 validateGeneralSpec(spec);strictKeys(v,['safeToReview','checks'],'GENERAL_REVIEW');
 ensure(typeof v.safeToReview==='boolean'&&Array.isArray(v.checks)&&v.checks.length===spec.criteria.length,'GENERAL_REVIEW');const ids=new Set();
 for(const c of v.checks){strictKeys(c,['id','status','method','observed','files'],'GENERAL_CHECK');const expected=spec.criteria.find(x=>x.id===c.id);
  ensure(expected&&!ids.has(c.id)&&['pass','fail','uncertain'].includes(c.status)&&typeof c.method==='string'&&c.method.length>0&&c.method.length<=700&&typeof c.observed==='string'&&c.observed.length>0&&c.observed.length<=1200&&Array.isArray(c.files)&&new Set(c.files).size===c.files.length&&expected.evidence.every(f=>c.files.includes(f))&&c.files.every(f=>spec.outputs.some(o=>o.name===f)),'GENERAL_CHECK');ids.add(c.id);
 }
 return {verdict:!v.safeToReview||v.checks.some(c=>c.status==='uncertain')?'uncertain':v.checks.every(c=>c.status==='pass')?'consistent':'concern',checks:v.checks};
}

export function checkGeneralSettlement(spec,c){if(!isGeneralSpec(spec))return;validateGeneralSpec(spec);ensure(spec.settlement.chainId===c.chainId&&spec.settlement.manager.toLowerCase()===c.manager.toLowerCase(),'GENERAL_SETTLEMENT_SCOPE');ensure(spec.deadline>Math.floor(Date.now()/1000),'GENERAL_JOB_EXPIRED');}
