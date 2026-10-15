import {need,keys,parseStrict,digest} from '../contracts.mjs';
import {ALPHA_MARKET,ALPHA_SOURCE_COMMIT} from './package.mjs';

export const ALPHA_MAX_BYTES=512_000;
export const ALPHA_AUTHORITY='computed-unreviewed; no wallet, approval or settlement authority';
const HASH=/^[a-f0-9]{64}$/;
export const ALPHA_OUTPUT_BUDGET=Object.freeze({wireBytes:480_000,receiptBytes:1_900_000});

// parseStrict rejects duplicates, nonfinite numbers, unsafe keys and ambiguous
// Unicode. The second pass retains numeric types and exact subtree bytes:
// JSON.parse alone would turn Python's strict integer 1.0 into JS integer 1.
function lexicalJSON(raw,maximum=ALPHA_MAX_BYTES) {
  parseStrict(raw,maximum);
  let at=0;
  const space=()=>{while(/[\x20\t\r\n]/.test(raw[at]||'\0'))at++;};
  const string=()=>{const start=at++;while(at<raw.length){if(raw[at]==='\\'){at+=2;continue;}if(raw[at++]==='"')return JSON.parse(raw.slice(start,at));}};
  function read(){
    space();const start=at;let value,kind,members,items;
    if(raw[at]==='{'){
      kind='object';value={};members={};at++;space();
      while(raw[at]!=='}'){const key=string();space();at++;const n=read();members[key]=n;value[key]=n.value;space();if(raw[at]===','){at++;space();}else break;}at++;
    }else if(raw[at]==='['){
      kind='array';value=[];items=[];at++;space();
      while(raw[at]!==']'){const n=read();items.push(n);value.push(n.value);space();if(raw[at]===','){at++;space();}else break;}at++;
    }else if(raw[at]==='"'){kind='string';value=string();}
    else {const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(at))[0];at+=token.length;value=JSON.parse(token);kind=typeof value;}
    return {kind,value,members,items,raw:raw.slice(start,at)};
  }
  return read();
}
const object=(node,allowed,required=allowed)=>{need(node?.kind==='object','ALPHA_OBJECT_REQUIRED');keys(node.value,allowed,required);return node.members;};
const text=(node,min,max)=>{need(node?.kind==='string'&&[...node.value].length>=min&&[...node.value].length<=max,'ALPHA_TEXT_INVALID');return node.value;};
const integer=(node,min,max,fallback)=>{if(!node&&fallback!==undefined)return fallback;need(node?.kind==='number'&&/^-?(?:0|[1-9]\d*)$/.test(node.raw)&&Number.isSafeInteger(node.value)&&node.value>=min&&node.value<=max,'ALPHA_INTEGER_INVALID');return node.value===0?0:node.value;};
const list=(node,min,max)=>{need(node?.kind==='array'&&node.items.length>=min&&node.items.length<=max,'ALPHA_LIST_INVALID');return node.items;};
const identifier=node=>{const value=text(node,1,64);need(/^[A-Za-z0-9_-]+$/.test(value),'ALPHA_ID_INVALID');return value;};
const optionalText=(node,fallback,max)=>node?text(node,1,max):fallback;

function normalizeMission(node){
  const m=object(node,['goal','work','seed','population','generations'],['goal','work']);
  const result={goal:text(m.goal,3,2000),seed:integer(m.seed,0,2**32-1,42),population:integer(m.population,4,50,20),generations:integer(m.generations,1,50,12)};
  const kind=m.work?.members?.kind?.value;let records=[];
  need(['allocation','schedule','forecast','research'].includes(kind),'ALPHA_WORK_KIND_DENIED');
  if(kind==='research'){
    const w=object(m.work,['kind','sources']);
    records=list(w.sources,1,20).map(n=>{const s=object(n,['id','title','text','url'],['id','title','text']);return {id:identifier(s.id),title:text(s.title,1,300),text:text(s.text,1,20000),url:s.url?text(s.url,0,2048):''};});
    result.work={kind,sources:records};
  }else if(kind==='allocation'){
    const w=object(m.work,['kind','items','budget','max_risk','unit'],['kind','items','budget']);
    records=list(w.items,1,18).map(n=>{const i=object(n,['id','cost','value','risk'],['id','cost','value']);return {id:identifier(i.id),cost:integer(i.cost,1,1e12),value:integer(i.value,0,1e12),risk:integer(i.risk,0,10000,0)};});
    result.work={kind,items:records,budget:integer(w.budget,1,1e13),max_risk:integer(w.max_risk,0,180000,180000),unit:optionalText(w.unit,'planning units',60)};
  }else if(kind==='schedule'){
    const w=object(m.work,['kind','jobs','unit'],['kind','jobs']);
    records=list(w.jobs,1,30).map(n=>{const j=object(n,['id','operations','due'],['id','operations']);return {id:identifier(j.id),due:integer(j.due,1,10000000,10000000),operations:list(j.operations,1,20).map(n=>{const o=object(n,['machine','duration']);return {machine:identifier(o.machine),duration:integer(o.duration,1,100000)};})};});
    result.work={kind,jobs:records,unit:optionalText(w.unit,'minutes',30)};
  }else {
    const w=object(m.work,['kind','observations','horizon','holdout','season','unit'],['kind','observations']);
    const observations=list(w.observations,12,5000).map(n=>{need(n.kind==='number'&&Number.isFinite(n.value)&&Math.abs(n.value)<=1e15,'ALPHA_OBSERVATION_INVALID');return n.value===0&&/^-?(?:0|[1-9]\d*)$/.test(n.raw)?0:n.value;});
    const holdout=integer(w.holdout,2,1000,4),season=integer(w.season,1,365,1);
    need(holdout<=Math.floor(observations.length/3)&&season<=Math.floor((observations.length-holdout)/2),'ALPHA_FORECAST_SPLIT_INVALID');
    result.work={kind,observations,horizon:integer(w.horizon,1,100,3),holdout,season,unit:optionalText(w.unit,'observed units',60)};
  }
  need(new Set(records.map(r=>r.id)).size===records.length,'ALPHA_DUPLICATE_ID');return result;
}

// Compare normalized semantics with exact IEEE-754 binary64 identity. This is
// deliberately not Alpha canonical JSON and is never used as its mission hash.
// Python and JavaScript decimal-to-binary64 parsing must agree; signed zero is
// retained for floats, while integer -0 is normalized above as Python int zero.
function semanticJSON(value){
  if(typeof value==='number'){const bytes=Buffer.alloc(8);bytes.writeDoubleBE(value);return 'number:'+bytes.toString('hex');}
  if(Array.isArray(value))return '['+value.map(semanticJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+semanticJSON(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

// Conservative upper bounds derived from the pinned work.py output shapes.
// 32 bytes covers every finite binary64 JSON number and every bounded integer
// in these four algorithms. JSON quoting can at most double existing UTF-8
// JSON bytes (plus its two quotes); no average expansion ratio is assumed.
const quotedBytes=value=>Buffer.byteLength(JSON.stringify(value));
function jsonUpper(value){
  if(typeof value==='number')return 32;
  if(typeof value==='string')return quotedBytes(value);
  if(Array.isArray(value))return 2+value.reduce((n,v)=>n+jsonUpper(v)+1,0);
  if(value&&typeof value==='object')return 2+Object.entries(value).reduce((n,[k,v])=>n+quotedBytes(k)+1+jsonUpper(v)+1,0);
  return value===false?5:4;
}
export function alphaOutputUpperBound(mission,inputBytes){
  const work=mission.work,missionBytes=jsonUpper(mission);
  let resultBytes=4096; // all fixed method/limits/metric/policy fields and keys
  if(work.kind==='research'){
    // Each of <=8 findings repeats a <=1200-code-point quote as claim and quote.
    // A code point needs at most six JSON UTF-8 bytes, including control escapes.
    const quoteBytes=Math.min(7202,Math.max(...work.sources.map(s=>quotedBytes(s.text))));
    const idBytes=Math.max(...work.sources.map(s=>quotedBytes(s.id)));
    resultBytes+=8*(128+2*quoteBytes+idBytes);
    resultBytes+=work.sources.reduce((n,s)=>n+jsonUpper({id:s.id,title:s.title,url:s.url,sha256:'f'.repeat(64)})+1,0);
  }else if(work.kind==='allocation'){
    const selected=2+work.items.reduce((n,item)=>n+quotedBytes(item.id)+1,0);
    // Every Pareto individual can select all items and has three objectives.
    resultBytes+=selected+mission.population*(128+selected+3*33)+quotedBytes(work.unit);
  }else if(work.kind==='schedule'){
    for(const job of work.jobs){
      resultBytes+=quotedBytes(job.id)+1; // order
      for(const operation of job.operations)resultBytes+=128+quotedBytes(job.id)+quotedBytes(operation.machine)+3*32;
    }
    resultBytes+=quotedBytes(work.unit);
  }else {
    // Actual holdout and holdout predictions, then the requested future horizon.
    resultBytes+=33*(2*work.holdout+work.horizon)+quotedBytes(work.unit);
  }
  const validatorBytes=4096+2*missionBytes;
  // canonical_mission string, canonical_result string, result object, base64
  // exact input, fixed envelope fields and the bounded self-check report.
  const wireBytes=4096+2*missionBytes+3*resultBytes+4*Math.ceil(inputBytes/3);
  // Both raw JSON files are escaped again in the durable Fleet receipt. Keep
  // room for fixed metadata/observations below the existing 2 MB output bound.
  const receiptBytes=8192+2*wireBytes+2*validatorBytes;
  return {wireBytes,validatorBytes,receiptBytes,limits:ALPHA_OUTPUT_BUDGET};
}

export function validateAlphaInput(input){
  keys(input,['workSpec']);
  need(typeof input.workSpec==='string'&&Buffer.byteLength(input.workSpec)<=ALPHA_MAX_BYTES,'ALPHA_SPEC_SIZE');
  // A lone UTF-16 surrogate cannot round-trip to the exact UTF-8 input bytes.
  need(Buffer.from(input.workSpec,'utf8').toString('utf8')===input.workSpec,'ALPHA_UTF8_REQUIRED');
  const root=lexicalJSON(input.workSpec),s=object(root,['schema','market','executor','mission']);
  need(s.schema.value==='agialpha.bounded-work-spec.v1','ALPHA_SPEC_SCHEMA');
  need(s.market.value===ALPHA_MARKET,'ALPHA_MARKET_DENIED');
  need(s.executor.value==='fleet-linux-v1','ALPHA_EXECUTOR_DENIED');
  const mission=normalizeMission(s.mission);
  const budget=alphaOutputUpperBound(mission,Buffer.byteLength(input.workSpec));
  need(budget.wireBytes<=ALPHA_OUTPUT_BUDGET.wireBytes&&budget.receiptBytes<=ALPHA_OUTPUT_BUDGET.receiptBytes,'ALPHA_OUTPUT_BUDGET_EXCEEDED');
  return {raw:input.workSpec,specHash:'0x'+digest(input.workSpec),mission,budget,normalizedMissionSemanticSha256:digest(semanticJSON(mission)),kind:mission.work.kind,market:ALPHA_MARKET,sourceCommit:ALPHA_SOURCE_COMMIT};
}

function lexicalCanonical(node){
  if(node.kind==='object')return '{'+Object.keys(node.members).sort().map(k=>JSON.stringify(k)+':'+lexicalCanonical(node.members[k])).join(',')+'}';
  if(node.kind==='array')return '['+node.items.map(lexicalCanonical).join(',')+']';
  return node.kind==='number'?node.raw:JSON.stringify(node.value);
}

export function validateAlphaSpecValidation(input,raw){
  const spec=validateAlphaInput(input);
  need(typeof raw==='string','ALPHA_VALIDATION_REQUIRED');
  need(Buffer.byteLength(raw)<=spec.budget.validatorBytes,'ALPHA_OUTPUT_SIZE');
  const node=lexicalJSON(raw,2*ALPHA_MAX_BYTES+2048);
  object(node,['schema','spec_hash','executor','market','canonical_mission','mission_hash']);
  need(raw===lexicalCanonical(node)+'\n','ALPHA_VALIDATION_ENCODING');
  const value=node.value;
  need(value.schema==='agialpha.work-spec-validation.v1'&&value.executor==='fleet-linux-v1'&&value.market===ALPHA_MARKET,'ALPHA_VALIDATION_SCOPE');
  need(value.spec_hash===spec.specHash,'ALPHA_SPEC_HASH_MISMATCH');
  need(typeof value.canonical_mission==='string','ALPHA_MISSION_BYTES_REQUIRED');
  const mission=lexicalJSON(value.canonical_mission);
  need(value.canonical_mission===lexicalCanonical(mission),'ALPHA_MISSION_ENCODING');
  normalizeMission(mission);
  if(spec.kind==='forecast')need(mission.members.work.members.observations.items.every(n=>/[.eE]/.test(n.raw)),'ALPHA_MISSION_NORMALIZATION_MISMATCH');
  need(semanticJSON(mission.value)===semanticJSON(spec.mission),'ALPHA_MISSION_NORMALIZATION_MISMATCH');
  need(HASH.test(value.mission_hash)&&digest(value.canonical_mission)===value.mission_hash,'ALPHA_MISSION_HASH_MISMATCH');
  return {...value,raw};
}

export function validateAlphaOutput(input,envelope){
  const spec=validateAlphaInput(input);keys(envelope,['alphaOutput','alphaValidation']);
  // Native enablement must obtain this receipt by independently invoking the
  // pinned read-only validator on exact stdin, never accepting it from a task.
  const validation=validateAlphaSpecValidation(input,envelope.alphaValidation);
  const raw=envelope.alphaOutput;need(typeof raw==='string'&&Buffer.byteLength(raw)<=spec.budget.wireBytes&&Buffer.byteLength(raw)<=ALPHA_OUTPUT_BUDGET.wireBytes,'ALPHA_OUTPUT_SIZE');
  const node=lexicalJSON(raw,ALPHA_MAX_BYTES+1),fields=object(node,['schema','spec_hash','mission_hash','canonical_mission','canonical_result','spec_base64','result','result_hash','verification','authority']);
  need(raw===lexicalCanonical(node)+'\n','ALPHA_OUTPUT_ENCODING');
  const value=node.value;
  need(value.schema==='agialpha.fleet-work-result.v1','ALPHA_RESULT_SCHEMA');
  need(value.authority===ALPHA_AUTHORITY,'ALPHA_AUTHORITY_DENIED');
  need(value.spec_hash===spec.specHash&&value.spec_base64===Buffer.from(input.workSpec,'utf8').toString('base64'),'ALPHA_SPEC_HASH_MISMATCH');
  need(value.canonical_mission===validation.canonical_mission&&value.mission_hash===validation.mission_hash,'ALPHA_MISSION_HASH_MISMATCH');
  need(fields.result.kind==='object'&&typeof value.canonical_result==='string'&&value.canonical_result===fields.result.raw&&HASH.test(value.result_hash)&&digest(value.canonical_result)===value.result_hash,'ALPHA_RESULT_HASH_MISMATCH');
  const v=value.verification;keys(v,['passed','checks','result_hash','semantic_review_required']);
  need(v.passed===true&&v.result_hash===value.result_hash&&v.semantic_review_required===(spec.kind==='research')&&Array.isArray(v.checks)&&v.checks.length>0&&v.checks.length<=32&&v.checks.every(c=>typeof c==='string'&&c.length>0&&c.length<=1000),'ALPHA_VERIFICATION_INVALID');
  return {files:[{name:'alpha-result.json',mediaType:'application/json',content:raw},{name:'alpha-spec-validation.json',mediaType:'application/json',content:validation.raw}],alpha:{sourceCommit:ALPHA_SOURCE_COMMIT,market:ALPHA_MARKET,workKind:spec.kind,specHash:spec.specHash,missionHash:validation.mission_hash,resultHash:value.result_hash,validationSha256:digest(validation.raw),verification:'Alpha self-check; not independent review or settlement authorization'},authority:'none',provider:null,execution:'bounded-offline',independentReview:false};
}
