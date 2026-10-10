import path from 'node:path';
import {canonical,sha256} from '../src/util.mjs';

const SCHEMA='agi-runtime-immutable-localization/v1';
const PATHS=['agents/agi-checker/agent/models.json','agents/agi-creator/agent/models.json','agents/agi-reviewer/agent/models.json','config-journal-fingerprint.key'];
const MAX_ENTRIES=20000,MAX_HYPOTHESES=16;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>canonical(a??null)===canonical(b??null);
const sorted=entries=>[...entries].sort((a,b)=>a[0].localeCompare(b[0]));
const digest=entries=>sha256(canonical(sorted(entries)));
function inventory(entries){
 if(!Array.isArray(entries)||entries.length>MAX_ENTRIES)return null;
 const valid=entries.every(entry=>Array.isArray(entry)&&typeof entry[0]==='string'&&entry[0].length>0&&entry[0].length<=4096&&!path.isAbsolute(entry[0])&&!entry[0].split('/').some(part=>!part||part==='.'||part==='..')&&(entry.length===2&&entry[1]==='directory'||entry.length===4&&entry[1]==='file'&&typeof entry[2]==='boolean'&&hex(entry[3])));
 return valid&&new Set(entries.map(entry=>entry[0])).size===entries.length?new Map(entries.map(entry=>[entry[0],entry])):null;
}
const fileSha=entry=>entry?.[1]==='file'?entry[3]:null;
function base(expectedDigest,currentDigest){return {schema:SCHEMA,status:'UNAVAILABLE',reason:'previous-inventory-unavailable',comparisonBasis:'sealed-immutable-digest',expectedDigest:hex(expectedDigest)?expectedDigest:null,currentDigest:hex(currentDigest)?currentDigest:null,maxHypotheses:MAX_HYPOTHESES,hypothesesTested:0,matchedCandidateCount:0,candidatePaths:[],deltas:[],historicalCauseEstablished:false,rollbackAuthorized:false};}

/** Diagnostic reconstruction only. Previous state supplies bounded hypotheses,
 * never a baseline. Only an exact sealed aggregate match binds the result.
 * No file, profile, transaction, or SQLite store is opened or modified here. */
export function localizeImmutableBaseline({currentEntries,expectedDigest,previousEntries=null}={}){
 const current=inventory(currentEntries),previous=inventory(previousEntries),result=base(expectedDigest,current?digest(currentEntries):null);
 if(!current||!hex(expectedDigest)){result.status='INVALID';result.reason=!current?'current-inventory-invalid':'sealed-digest-invalid';return result;}
 const changes=[];
 result.candidatePaths=PATHS.map(relative=>{
  const observed=current.get(relative),retained=previous?.get(relative),fingerprint=relative==='config-journal-fingerprint.key';
  // The fingerprint key is random secret material; its retained bytes are not
  // a substitution candidate. Only a newly created key can be hypothesized.
  const admissible=Boolean(previous&&(!observed||observed[1]==='file')&&(!retained||retained[1]==='file')&&(!fingerprint||!retained)&&!same(observed,retained));
  if(admissible)changes.push({relative,retained});
  return {path:relative,sourceEvidence:fingerprint?'pinned-openclaw-config-journal-key-creation':'pinned-openclaw-model-catalog-materialization',currentPresence:observed?'present':'absent',currentSha256:fileSha(observed),previousArtifactPresence:previous?(retained?'present':'absent'):'unavailable',previousArtifactSha256:fileSha(retained),operation:admissible?(retained?'substitute-previous-artifact':'hypothesize-absent-at-seal'):'none',expectedSha256:null};
 });
 if(result.currentDigest===expectedDigest){result.status='MATCHED';result.reason='current-already-matches-seal';result.hypothesesTested=1;result.matchedCandidateCount=1;return result;}
 if(!previous)return result;
 const matches=[];
 for(let mask=0;mask<(1<<changes.length);mask++){
  const candidate=new Map(current);
  for(let index=0;index<changes.length;index++)if(mask&(1<<index)){const item=changes[index];if(item.retained)candidate.set(item.relative,item.retained);else candidate.delete(item.relative);}
  result.hypothesesTested++;
  if(digest([...candidate.values()])===expectedDigest)matches.push(candidate);
 }
 result.matchedCandidateCount=matches.length;
 if(matches.length!==1){result.status='NO_MATCH';result.reason=matches.length?'ambiguous-sealed-match':'bounded-hypotheses-do-not-match-seal';return result;}
 result.status='MATCHED';result.reason='bounded-reconstruction-matches-seal';
 const baseline=matches[0];
 for(const relative of PATHS){
  const expected=baseline.get(relative),observed=current.get(relative);if(same(expected,observed))continue;
  result.deltas.push({path:relative,kind:observed?.[2]||expected?.[2]?'executable-identity':'protected-file',reason:!expected?'added':!observed?'removed':expected[2]!==observed[2]?'executable-bit-changed':'digest-mismatch',expectedSha256:fileSha(expected),observedSha256:fileSha(observed),expectedExecutable:expected?.[2]??null,observedExecutable:observed?.[2]??null,baselineTrust:'sealed-aggregate-bound-reconstruction'});
  result.candidatePaths.find(item=>item.path===relative).expectedSha256=fileSha(expected);
 }
 return result;
}

/** Strict bounded public envelope. No raw tuples, file names beyond the four
 * reviewed paths, file contents, absolute paths, credentials, or error text. */
export function safeImmutableLocalization(value){
 if(!value||value.schema!==SCHEMA||!['MATCHED','NO_MATCH','UNAVAILABLE','INVALID'].includes(value.status)||!['previous-inventory-unavailable','current-inventory-invalid','sealed-digest-invalid','current-already-matches-seal','ambiguous-sealed-match','bounded-hypotheses-do-not-match-seal','bounded-reconstruction-matches-seal'].includes(value.reason)||value.comparisonBasis!=='sealed-immutable-digest'||![value.expectedDigest,value.currentDigest].every(item=>item===null||hex(item))||value.maxHypotheses!==MAX_HYPOTHESES||![value.hypothesesTested,value.matchedCandidateCount].every(item=>Number.isInteger(item)&&item>=0&&item<=MAX_HYPOTHESES)||value.matchedCandidateCount>value.hypothesesTested||value.historicalCauseEstablished!==false||value.rollbackAuthorized!==false||!Array.isArray(value.candidatePaths)||![0,PATHS.length].includes(value.candidatePaths.length)||!Array.isArray(value.deltas)||value.deltas.length>PATHS.length)return null;
 if(value.status==='INVALID'){
  if(!['current-inventory-invalid','sealed-digest-invalid'].includes(value.reason)||value.hypothesesTested||value.matchedCandidateCount||value.candidatePaths.length||value.deltas.length)return null;
 }else if(!hex(value.expectedDigest)||!hex(value.currentDigest)||value.candidatePaths.length!==PATHS.length)return null;
 if(value.status==='MATCHED'&&(value.matchedCandidateCount!==1||value.hypothesesTested<1||!['current-already-matches-seal','bounded-reconstruction-matches-seal'].includes(value.reason)))return null;
 if(value.status==='MATCHED'&&(value.reason==='current-already-matches-seal'?(value.currentDigest!==value.expectedDigest||value.deltas.length!==0||value.hypothesesTested!==1):(value.currentDigest===value.expectedDigest||!value.deltas.length)))return null;
 if(value.status==='NO_MATCH'){
  if(!value.hypothesesTested||value.currentDigest===value.expectedDigest)return null;
  if(value.reason==='bounded-hypotheses-do-not-match-seal'?value.matchedCandidateCount!==0:value.reason!=='ambiguous-sealed-match'||value.matchedCandidateCount<2)return null;
 }
 if(value.status==='UNAVAILABLE'&&(value.reason!=='previous-inventory-unavailable'||value.hypothesesTested||value.matchedCandidateCount))return null;
 const candidatePaths=[];
 for(const [index,item]of value.candidatePaths.entries()){
  if(!item||item.path!==PATHS[index]||item.sourceEvidence!==(item.path==='config-journal-fingerprint.key'?'pinned-openclaw-config-journal-key-creation':'pinned-openclaw-model-catalog-materialization')||!['present','absent'].includes(item.currentPresence)||!['present','absent','unavailable'].includes(item.previousArtifactPresence)||!['none','substitute-previous-artifact','hypothesize-absent-at-seal'].includes(item.operation)||![item.currentSha256,item.previousArtifactSha256,item.expectedSha256].every(v=>v===null||hex(v))||value.status!=='MATCHED'&&item.expectedSha256!==null)return null;
  if(item.currentPresence==='absent'&&item.currentSha256!==null||item.previousArtifactPresence!=='present'&&item.previousArtifactSha256!==null||item.operation==='substitute-previous-artifact'&&(!hex(item.previousArtifactSha256)||item.path==='config-journal-fingerprint.key')||item.operation==='hypothesize-absent-at-seal'&&item.previousArtifactPresence!=='absent')return null;
  candidatePaths.push(Object.fromEntries(['path','sourceEvidence','currentPresence','currentSha256','previousArtifactPresence','previousArtifactSha256','operation','expectedSha256'].map(key=>[key,item[key]])));
 }
 if(value.status!=='MATCHED'&&value.deltas.length||new Set(value.deltas.map(item=>item?.path)).size!==value.deltas.length)return null;
 const deltas=[];
 for(const item of value.deltas){
  if(!item||!PATHS.includes(item.path)||!['protected-file','executable-identity'].includes(item.kind)||!['added','removed','executable-bit-changed','digest-mismatch'].includes(item.reason)||![item.expectedSha256,item.observedSha256].every(v=>v===null||hex(v))||![item.expectedExecutable,item.observedExecutable].every(v=>v===null||typeof v==='boolean')||item.baselineTrust!=='sealed-aggregate-bound-reconstruction')return null;
  const expectedPresent=hex(item.expectedSha256),observedPresent=hex(item.observedSha256),candidate=value.candidatePaths.find(v=>v.path===item.path);
  if(expectedPresent!==(typeof item.expectedExecutable==='boolean')||observedPresent!==(typeof item.observedExecutable==='boolean')||!candidate||candidate.expectedSha256!==item.expectedSha256||candidate.currentSha256!==item.observedSha256||item.kind!==(item.expectedExecutable||item.observedExecutable?'executable-identity':'protected-file'))return null;
  if(item.reason==='added'?(expectedPresent||!observedPresent):item.reason==='removed'?(!expectedPresent||observedPresent):!expectedPresent||!observedPresent||item.reason==='executable-bit-changed'&&item.expectedExecutable===item.observedExecutable||item.reason==='digest-mismatch'&&(item.expectedSha256===item.observedSha256||item.expectedExecutable!==item.observedExecutable))return null;
  deltas.push(Object.fromEntries(['path','kind','reason','expectedSha256','observedSha256','expectedExecutable','observedExecutable','baselineTrust'].map(key=>[key,item[key]])));
 }
 return {...Object.fromEntries(['schema','status','reason','comparisonBasis','expectedDigest','currentDigest','maxHypotheses','hypothesesTested','matchedCandidateCount','historicalCauseEstablished','rollbackAuthorized'].map(key=>[key,value[key]])),candidatePaths,deltas};
}
