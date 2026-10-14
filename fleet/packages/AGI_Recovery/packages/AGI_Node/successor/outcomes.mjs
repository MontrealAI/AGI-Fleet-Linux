import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonical,parseStrict,fail,keys,isHash} from './vendor/manager/site/assets/successor/safe.mjs';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const stages=['setup','preparation','authorization','monitoring','review','repair','support','recovery'];
function validate(event){
  keys(event,['attempt','type','at','evidenceSha256','data'],'OUTCOME_FIELDS');fail(isHash(event.attempt)&&isHash(event.evidenceSha256)&&Number.isSafeInteger(event.at)&&event.at>=0,'OUTCOME_IDENTITY');
  const d=event.data;
  if(event.type==='attempt'){
    keys(d,['state','projectSha256','method','inputHashes','outputHashes','runtimeSha256'],'OUTCOME_ATTEMPT');
    fail(['reserved','dispatched','blocked-or-uncertain','paused','stopped','abandoned','completed'].includes(d.state)&&isHash(d.projectSha256)&&typeof d.method==='string'&&d.method.length<=120,'OUTCOME_ATTEMPT');
    fail([d.inputHashes,d.outputHashes].every(list=>Array.isArray(list)&&list.length<=40&&list.every(isHash))&&(d.runtimeSha256===null||isHash(d.runtimeSha256)),'OUTCOME_ATTEMPT');
  }else if(event.type==='cost'){
    keys(d,['id','category','basis','currency','amountMicros','billingReferenceSha256'],'OUTCOME_COST');
    fail(typeof d.id==='string'&&d.id.length>0&&d.id.length<=100&&['provider','compute','review','setup','support'].includes(d.category)&&['estimated','metered','invoiced','subscription-allocated','unknown'].includes(d.basis)&&/^[A-Z]{3,6}$/.test(d.currency),'OUTCOME_COST');
    fail(d.basis==='unknown'?d.amountMicros===null:typeof d.amountMicros==='string'&&/^(0|[1-9]\d{0,24})$/.test(d.amountMicros),'OUTCOME_COST');
    fail(d.billingReferenceSha256===null||isHash(d.billingReferenceSha256),'OUTCOME_COST');
  }else if(event.type==='human-time'){
    keys(d,['stage','activeSeconds','waitingSeconds','measurement'],'OUTCOME_TIME');fail(stages.includes(d.stage)&&['observed','operator-reported'].includes(d.measurement)&&[d.activeSeconds,d.waitingSeconds].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=604800),'OUTCOME_TIME');
  }else if(event.type==='review'){
    keys(d,['verdict','control','deliverySha256','eligibilityEvidenceSha256'],'OUTCOME_REVIEW');
    fail(['accepted','rejected','abstained'].includes(d.verdict)&&['internal','unverified','externally-attested'].includes(d.control)&&isHash(d.deliverySha256)&&(d.eligibilityEvidenceSha256===null||isHash(d.eligibilityEvidenceSha256)),'OUTCOME_REVIEW');
    fail(d.control!=='externally-attested'||isHash(d.eligibilityEvidenceSha256),'OUTCOME_REVIEW');
  }else fail(false,'OUTCOME_TYPE');
}
export function verifyLedger(records){
  fail(Array.isArray(records)&&records.length<=10000,'OUTCOME_LIMIT');const charges=new Set();
  for(const [i,r] of records.entries()){
    keys(r,['sequence','previous','event','sha256'],'OUTCOME_RECORD');const {sha256,...body}=r;
    fail(r.sequence===i&&r.previous===(i?records[i-1].sha256:null)&&sha256===digest(body),'OUTCOME_CHANGED');validate(r.event);
    if(r.event.type==='cost'){const id=r.event.attempt+':'+r.event.data.id;fail(!charges.has(id),'OUTCOME_DUPLICATE_COST');charges.add(id);}
  }return records;
}
export class OutcomeLedger{
  constructor(dir){this.dir=dir;this.file=path.join(dir,'attempts.jsonl');if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});this.read();}
  read(){
    const s=fs.lstatSync(this.dir);fail(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o077)&&(process.getuid===undefined||s.uid===process.getuid()),'OUTCOME_STORE_UNSAFE');
    if(!fs.existsSync(this.file))return [];
    const fd=fs.openSync(this.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);fail(s.isFile()&&s.nlink===1&&!(s.mode&0o077)&&s.size<8000000&&(process.getuid===undefined||s.uid===process.getuid()),'OUTCOME_STORE_UNSAFE');const raw=fs.readFileSync(fd,'utf8');fail(!raw||raw.endsWith('\n'),'OUTCOME_TORN');return verifyLedger(raw.trim()?raw.trim().split('\n').map(line=>parseStrict(line,20000)):[]);}finally{fs.closeSync(fd);}
  }
  append(event){
    validate(event);const lock=path.join(this.dir,'append.lock'),lockfd=fs.openSync(lock,'wx',0o600);
    try{const records=this.read(),body={sequence:records.length,previous:records.at(-1)?.sha256??null,event},record={...body,sha256:digest(body)};verifyLedger([...records,record]);const raw=canonical(record)+'\n';fail(Buffer.byteLength(raw)+records.reduce((n,r)=>n+Buffer.byteLength(canonical(r))+1,0)<8000000,'OUTCOME_LIMIT');
      const fd=fs.openSync(this.file,fs.constants.O_CREAT|fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return record;
    }finally{fs.closeSync(lockfd);fs.unlinkSync(lock);}
  }
}
export function summarizeOutcomes(records){
  verifyLedger(records);const attempts=new Set(),accepted=new Set(),costs={},time={},unknown=[];
  for(const {event:e} of records){attempts.add(e.attempt);const d=e.data;
    if(e.type==='review'&&d.control==='externally-attested'&&d.verdict==='accepted')accepted.add(e.attempt);
    if(e.type==='cost'){if(d.basis==='unknown')unknown.push({attempt:e.attempt,category:d.category,currency:d.currency});else{const key=d.currency+':'+d.basis;costs[key]=(BigInt(costs[key]??'0')+BigInt(d.amountMicros)).toString();}}
    if(e.type==='human-time'){const key=d.stage+':'+d.measurement;const row=time[key]??={activeSeconds:0,waitingSeconds:0};row.activeSeconds+=d.activeSeconds;row.waitingSeconds+=d.waitingSeconds;}
  }
  return {attempts:attempts.size,externallyAttestedAccepted:accepted.size,costMicrosByCurrencyAndBasis:costs,humanTimeByStage:time,unknownCosts:unknown,costPerIndependentlyAcceptedOutcome:null,activeMinutesPerIndependentlyAcceptedOutcome:null,independentControl:'External evidence must be audited; ledger does not establish reviewer eligibility.',economics:'NOT_EVALUATED',humanEffort:'NOT_EVALUATED',productionQualified:false};
}
