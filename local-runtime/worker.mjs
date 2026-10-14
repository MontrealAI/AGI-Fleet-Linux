import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import {canonical, parseStrict} from '../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';
import {validateMission, executeMission} from '../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';
import {checkArtifacts} from '../fleet/successor/vendor/manager/site/assets/successor/checker.mjs';
import {jobAction} from '../fleet/shared/operator/ops/policy.mjs';
import {validateConfig} from '../fleet/shared/operator/ops/config.mjs';
import {need, keys, digest, validateTask} from './contracts.mjs';
import {validateAlphaInput} from './alpha/contract.mjs';
import {refuseUnprovisionedAlpha} from './alpha/package.mjs';

// This is a bounded, offline worker. It never loads or executes supplied code.
// Live Computer Use stays on the established ComputeWorker path, separately gated.
export function validateTaskInput(role,task) {
  validateTask(task, role);
  if(task.action==='alpha-run')validateAlphaInput(task.input);
  else if(task.action==='successor-run') {keys(task.input,['mission','variant']);validateMission(task.input.mission);need(['baseline','improved'].includes(task.input.variant),'VARIANT');}
  else if(task.action==='successor-check') {keys(task.input,['mission','variant','files']);validateMission(task.input.mission);need(['baseline','improved'].includes(task.input.variant),'VARIANT');need(Array.isArray(task.input.files)&&task.input.files.length<=3,'FILES');for(const f of task.input.files){keys(f,['name','mediaType','content']);need(typeof f.content==='string'&&Buffer.byteLength(f.content)<=300_000,'FILE_SIZE');}}
  else if(task.action==='evidence-inspect') {keys(task.input,['files']);need(Array.isArray(task.input.files)&&task.input.files.length<=24,'FILES');for(const f of task.input.files){keys(f,['name','content','sha256']);need(typeof f.content==='string'&&Buffer.byteLength(f.content)<=300_000,'FILE_SIZE');}}
  else {
    keys(task.input,['config','snapshot','row','proof']);need(task.input.config?.role===role,'ROLE_ACTION_DENIED');validateConfig(structuredClone(task.input.config));
    const s=task.input.snapshot;need(s&&typeof s==='object','SNAPSHOT_INVALID');
    for(const k of ['paused','completed','expired','disputed','requested','moderator'])need(typeof s[k]==='boolean','SNAPSHOT_BOOLEAN');
    for(const k of ['payout','neutralRefundAfter','settlementAfter','assignmentDeadline','reviewEnd'])need(typeof s[k]==='string'&&/^\d{1,78}$/.test(s[k]),'PROTOCOL_INTEGER');
    need(Number.isSafeInteger(s.now)&&s.now>=0&&typeof s.id==='string'&&/^\d{1,78}$/.test(s.id),'SNAPSHOT_IDENTITY');
    for(const k of ['buyer','agent'])need(typeof s[k]==='string'&&/^0x[a-fA-F0-9]{40}$/.test(s[k]),'SNAPSHOT_IDENTITY');
  }
  return task;
}
export async function perform(role, task) {
  validateTaskInput(role,task);
  // Alpha cannot accidentally reach the in-process JS/protocol worker.
  if(task.action==='alpha-run')refuseUnprovisionedAlpha();
  let result;
  if (task.action === 'successor-run') {
    keys(task.input,['mission','variant']); validateMission(task.input.mission);
    need(['baseline','improved'].includes(task.input.variant),'VARIANT');
    result = executeMission(task.input.mission,task.input.variant);
    result.checker = checkArtifacts(task.input.mission,task.input.variant,result.files);
  } else if (task.action === 'successor-check') {
    keys(task.input,['mission','variant','files']); validateMission(task.input.mission);
    need(['baseline','improved'].includes(task.input.variant),'VARIANT');
    need(Array.isArray(task.input.files) && task.input.files.length <= 3,'FILES');
    for(const f of task.input.files) { keys(f,['name','mediaType','content']); need(typeof f.content==='string' && Buffer.byteLength(f.content)<=300_000,'FILE_SIZE'); }
    result={files:[],checker:checkArtifacts(task.input.mission,task.input.variant,task.input.files),deliverySha256:digest(task.input.files)};
  } else if (task.action === 'evidence-inspect') {
    keys(task.input,['files']); need(Array.isArray(task.input.files)&&task.input.files.length<=24,'FILES');
    const seen=new Set();
    const inventory=task.input.files.map(f=>{keys(f,['name','content','sha256']);need(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}\.(txt|json|csv|html)$/.test(f.name)&&!seen.has(f.name.toLowerCase()),'FILE_NAME');seen.add(f.name.toLowerCase());need(typeof f.content==='string'&&Buffer.byteLength(f.content)<=300_000,'FILE_SIZE');return {name:f.name,bytes:Buffer.byteLength(f.content),sha256:digest(f.content),matches:digest(f.content)===f.sha256};});
    result={files:[{name:'evidence-report.json',mediaType:'application/json',content:canonical({inventory,meaning:'Byte integrity only. No correctness, authorship, independence or settlement claim.'})}]};
  } else {
    keys(task.input,['config','snapshot','row','proof']);
    need(task.input.config.role===role,'ROLE_ACTION_DENIED');
    const config=validateConfig(structuredClone(task.input.config));
    // Reuse the exact existing formal policy; no transaction construction or signing.
    const snapshot=structuredClone(task.input.snapshot);
    for(const k of ['payout','neutralRefundAfter','settlementAfter','assignmentDeadline','reviewEnd']) {
      need(typeof snapshot[k]==='string'&&/^\d{1,78}$/.test(snapshot[k]),'PROTOCOL_INTEGER');snapshot[k]=BigInt(snapshot[k]);
    }
    const action=jobAction(config,snapshot,task.input.row,task.input.proof);
    result={files:[{name:'protocol-inspection.json',mediaType:'application/json',content:JSON.stringify({role,action,authority:'none',source:'unverified supplied snapshot',signerRequestCreated:false,modelVeto:'unchanged; no model approval supplied',notice:'The existing signer must independently refresh chain state, eligibility, deadlines, conflicts and policy before any action.'})}]};
  }
  for(const f of result.files)need(Buffer.byteLength(f.content)<=300_000,'OUTPUT_LIMIT');
  return {...result,authority:'none',provider:null,execution:'bounded-offline',independentReview:false};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const started=performance.now();
    const raw=fs.readFileSync('/input/task.json','utf8');need(Buffer.byteLength(raw)<=4_000_000,'INPUT_LIMIT');
    const {role,task}=parseStrict(raw,4_000_000);
    const result=await perform(role,task),usage=process.resourceUsage();
    const workerObservation={pidNamespace:fs.readlinkSync('/proc/self/ns/pid'),networkNamespace:fs.readlinkSync('/proc/self/ns/net'),
      userCPUMicroseconds:usage.userCPUTime,systemCPUMicroseconds:usage.systemCPUTime,maxRSSKiB:usage.maxRSS,taskMilliseconds:Math.ceil(performance.now()-started)};
    const bytes=canonical({result,workerObservation});need(Buffer.byteLength(bytes)<=2_000_000,'OUTPUT_LIMIT');
    process.stdout.write(bytes);
  } catch(e) { process.stderr.write(/^[A-Z0-9_]{1,100}$/.test(e.code||e.message)?e.code||e.message:'WORKER_FAILED');process.exitCode=1; }
}
