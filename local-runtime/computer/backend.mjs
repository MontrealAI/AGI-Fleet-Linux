// SPDX-License-Identifier: MIT
// Native Alpha browser execution is optional, operator configured and never selected by task data.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {need,keys,uuid,digest,canonical,parseStrict} from '../contracts.mjs';
import {COMPUTER_LIMITS,LAUNCHER,computerEnvironment,inspectComputerInstallation,prepareComputer} from './profile.mjs';

const NAMES=/^(?:run\.json|receipt\.json|signed-receipt\.json|handoff\.json|computer-return\.json|visible-text\.txt|screen-\d{3}\.png)$/;
const mime=name=>name.endsWith('.png')?'image/png':name.endsWith('.txt')?'text/plain':'application/json';
function regular(file,maximum){
  const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const stat=fs.fstatSync(descriptor);need(stat.isFile()&&stat.nlink===1&&stat.uid===process.getuid()&&!(stat.mode&0o077)&&stat.size<=maximum,'COMPUTER_ARTIFACT_INVALID');const raw=fs.readFileSync(descriptor);need(raw.length<=maximum,'COMPUTER_ARTIFACT_SIZE');return raw;}
  finally{fs.closeSync(descriptor);}
}
function containersGone(){
  const result=spawnSync('/usr/bin/docker',['container','ls','--all','--quiet','--filter','name=^/successor-computer-'],{encoding:'utf8',timeout:5000,maxBuffer:8192,env:computerEnvironment()});
  return result.status===0&&result.stdout.trim()==='';
}
export function computerArtifactInventory(directory){
  need(fs.realpathSync(directory)===directory,'COMPUTER_ARTIFACT_ROOT');let total=0;
  const artifacts=fs.readdirSync(directory).sort().map(name=>{need(NAMES.test(name),'COMPUTER_ARTIFACT_NAME');const raw=regular(path.join(directory,name),COMPUTER_LIMITS.artifactBytes);if(name.endsWith('.png'))need(raw.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'COMPUTER_ARTIFACT_MIME');else new TextDecoder('utf-8',{fatal:true}).decode(raw);total+=raw.length;return {name,mediaType:mime(name),sha256:digest(raw),bytes:raw.length};});
  need(artifacts.length<=40&&total<=COMPUTER_LIMITS.artifactTotalBytes,'COMPUTER_ARTIFACT_CAPACITY');return artifacts;
}
export function requireComputerCapacity(runtime){
  const rows=runtime.store.db.prepare("SELECT value FROM grants WHERE state IN ('prepared','authorized','consumed')").all();
  const reserved=rows.map(row=>parseStrict(row.value)).filter(grant=>grant.task?.action==='alpha-computer-run').length*COMPUTER_LIMITS.artifactTotalBytes;
  need(reserved+COMPUTER_LIMITS.artifactTotalBytes<=COMPUTER_LIMITS.historyBytes,'COMPUTER_HISTORY_CAPACITY');
}
export async function executeComputer({configFile,role,task,directory,signal,expectedHost,approval,revalidate,home}){
  need(role==='agent'&&task.action==='alpha-computer-run','ROLE_ACTION_DENIED');
  const installed=inspectComputerInstallation(configFile);need(installed.supported,installed.code);
  const prepared=prepareComputer(task.input,installed);need(approval&&canonical(prepared)===canonical(approval),'COMPUTER_APPROVAL_CHANGED');
  need(expectedHost?.alphaComputerRuntimeIdentity===installed.runtimeIdentity,'COMPUTER_RUNTIME_REBIND_REQUIRED');
  need(typeof revalidate==='function','COMPUTER_REVALIDATION_REQUIRED');signal?.throwIfAborted();await revalidate();
  need(containersGone(),'COMPUTER_CONTAINER_ALREADY_ACTIVE');
  const output=path.join(directory,'computer');
  const payload=canonical({profile:installed.profile,handoffRaw:task.input.handoffRaw,permit:prepared.permit,home,output});
  const started=performance.now();
  return await new Promise((resolve,reject)=>{
    const child=spawn(installed.profile.python,['-E','-B',LAUNCHER,'run'],{stdio:['pipe','pipe','pipe'],env:computerEnvironment(),detached:true,shell:false});
    let stdout=[],stderr=[],outputBytes=0,errorBytes=0,problem=null,exited=false,killTimer;
    const interrupt=code=>{problem??=code;if(!exited){try{process.kill(child.pid,'SIGTERM');}catch{};killTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},20000);}};
    const abort=()=>interrupt('RUN_CANCELLED');signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>interrupt('RUN_TIMEOUT'),Math.min(COMPUTER_LIMITS.wallMs,prepared.maxSeconds*1000+25000));
    let checking=false;
    const checkTimer=setInterval(async()=>{if(checking)return;checking=true;try{signal?.throwIfAborted();await revalidate();}catch{interrupt('COMPUTER_APPROVAL_REVOKED');}finally{checking=false;}},250);
    child.stdout.on('data',data=>{outputBytes+=data.length;if(outputBytes>16384)interrupt('COMPUTER_OUTPUT_LIMIT');else stdout.push(data);});
    child.stderr.on('data',data=>{errorBytes+=data.length;if(errorBytes>8192)interrupt('COMPUTER_ERROR_LIMIT');else stderr.push(data);});
    child.stdin.on('error',()=>interrupt('COMPUTER_IPC_FAILED'));child.on('error',()=>{problem??='COMPUTER_LAUNCH_FAILED';});
    child.on('exit',()=>{exited=true;});
    child.on('close',async(status,exitSignal)=>{
      clearTimeout(timer);clearTimeout(killTimer);clearInterval(checkTimer);signal?.removeEventListener('abort',abort);
      let processGroupGone=false;try{process.kill(-child.pid,0);}catch(error){processGroupGone=error.code==='ESRCH';}
      const containerClosed=containersGone();
      const observation={backend:'native-alpha-computer-scripted/v1',evidenceClass:'NATIVE_ALPHA_SCRIPTED_REHEARSAL',runtimeIdentity:installed.runtimeIdentity,
        processGroupGone,containerClosed,network:'exact-public-read-broker',providerCalls:0,providerCost:'SCRIPTED_ZERO_PROVIDER_REQUESTS',
        deviceCost:'UNKNOWN',exitStatus:status,signal:exitSignal,wallMilliseconds:Math.ceil(performance.now()-started),artifactDirectory:path.basename(directory)+'/computer'};
      try{
        if(fs.existsSync(output))observation.artifacts=computerArtifactInventory(output);
        need(processGroupGone&&containerClosed,'CLEANUP_UNCONFIRMED');need(!problem,problem);
        const code=Buffer.concat(stderr).toString().trim();need(status===0,/^[A-Z0-9_]{1,100}$/.test(code)?code:'COMPUTER_FAILED_OR_UNCERTAIN');
        signal?.throwIfAborted();await revalidate();const result=parseStrict(Buffer.concat(stdout).toString(),16384);need(result.state==='review'&&result.providerRequests===0&&result.scriptedAdvice===true,'COMPUTER_NATIVE_RESULT');
        const native=parseStrict(regular(path.join(output,'computer-return.json'),COMPUTER_LIMITS.artifactBytes).toString(),COMPUTER_LIMITS.artifactBytes);
        need(native.handoffSha256===prepared.nativeHandoffSha256&&native.taskCommitment===prepared.permit&&native.receipt?.cleanup==='VERIFIED'&&native.receipt?.state==='review'&&native.verified===false,'COMPUTER_RETURN_BINDING');
        resolve({result:{files:[],artifacts:observation.artifacts,nativeState:'review',projectSha256:prepared.projectSha256,
          handoffSha256:prepared.handoffSha256,scriptedAdvice:true,providerRequests:0,independentReview:false,authority:'none',settlement:'not-connected'},observation});
      }catch(error){error.observation=observation;reject(error);}
    });
    child.stdin.end(payload);if(signal?.aborted)abort();
  });
}
export function computerOutputOperation(runtime,action,input,principal){
  keys(input,action==='computer-artifact'?['actor','run','name']:['actor','run']);runtime.scope(principal,'output',input.actor);
  const row=runtime.store.db.prepare('SELECT * FROM runs WHERE id=?').get(uuid(input.run));need(row?.actor===uuid(input.actor)&&row.state!=='running','RUN_UNKNOWN');
  const grant=runtime.store.db.prepare('SELECT value FROM grants WHERE id=?').get(row.grant_id);need(grant&&parseStrict(grant.value).task?.action==='alpha-computer-run','COMPUTER_RUN_REQUIRED');
  const retained=row.result?parseStrict(row.result):null,observation=retained?.observation??retained?.priorOutcome?.observation;
  need(observation?.backend==='native-alpha-computer-scripted/v1'&&typeof observation.artifactDirectory==='string','COMPUTER_ARTIFACT_UNAVAILABLE');
  const relative=observation.artifactDirectory;need(new RegExp('^'+row.id+'-[A-Za-z0-9]+/computer$').test(relative),'COMPUTER_ARTIFACT_ROOT');
  const directory=path.join(runtime.directory,'runs',relative);need(fs.realpathSync(directory)===directory,'COMPUTER_ARTIFACT_ROOT');
  const name=action==='computer-export'?'computer-return.json':input.name;need(typeof name==='string'&&NAMES.test(name),'COMPUTER_ARTIFACT_NAME');
  const record=observation.artifacts?.find(entry=>entry.name===name);need(record&&record.mediaType===mime(name),'COMPUTER_ARTIFACT_UNAVAILABLE');
  const raw=regular(path.join(directory,name),COMPUTER_LIMITS.artifactBytes);need(digest(raw)===record.sha256&&raw.length===record.bytes,'COMPUTER_ARTIFACT_CHANGED');
  if(action==='computer-export')return {name,content:new TextDecoder('utf-8',{fatal:true}).decode(raw),sha256:record.sha256,authority:'none',independentReview:false,settlement:'not-connected'};
  return {name,mediaType:record.mediaType,contentBase64:raw.toString('base64'),sha256:record.sha256};
}
