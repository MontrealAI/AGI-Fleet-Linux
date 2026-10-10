import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runtimeEnvironment} from './runtime-env.mjs';
import {GatewayToolObserver} from './gateway-tool-trace.mjs';
import {ensure,sha256,atomicWrite} from '../src/util.mjs';
const execute=promisify(execFile),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function sanitizeEngineEvent(event){
 if(event?.Type!=='container'||!hash(event.Actor?.ID)||!Number.isSafeInteger(event.time))return null;
 const action=String(event.Action??'').split(':')[0],attrs=event.Actor.Attributes??{};
 if(!['create','start','die','destroy','exec_create','exec_start','exec_die','copy','oom'].includes(action))return null;
 const safe={Type:'container',Action:action,time:event.time,Actor:{ID:event.Actor.ID,Attributes:{}}};
 // Docker JSON commonly carries nanoseconds as a JSON number. Millisecond
 // precision is sufficient here; retain seconds when that field is absent.
 const timeMS=typeof event.timeNano==='number'?Math.floor(event.timeNano/1000000):typeof event.timeNano==='string'&&/^\d{1,20}$/.test(event.timeNano)?Number(BigInt(event.timeNano)/1000000n):NaN;
 if(Number.isSafeInteger(timeMS)&&timeMS>=event.time*1000&&timeMS<(event.time+1)*1000)safe.timeMS=timeMS;
 if(hash(attrs.execID))safe.Actor.Attributes.execID=attrs.execID;
 if(/^\d{1,3}$/.test(attrs.exitCode??''))safe.Actor.Attributes.exitCode=attrs.exitCode;
 if(action.startsWith('exec_'))safe.commandSHA256=sha256(String(event.Action));
 return safe;
}
export function selectSessionContainer(inspections,root,imageID){
 ensure(Array.isArray(inspections)&&inspections.length<=128,'COMMISSIONING_CONTAINER_LIMIT');
 const matching=inspections.filter(c=>c?.Image===imageID&&c.Mounts?.some(m=>m.Source===root&&m.Destination==='/workspace'&&m.RW===true));
 ensure(matching.length===1&&hash(matching[0].Id),'COMMISSIONING_SESSION_CONTAINER_REQUIRED');
 return matching[0];
}
const safeCode=e=>/^COMMISSIONING_[A-Z0-9_]+$/.test(e?.message)?e.message:'COMMISSIONING_OBSERVER_UNAVAILABLE';
export class DockerExecutionObserver {
 constructor(c,{requestID,agent,sessionKey},{command,spawnImpl=spawn,now=Date.now,environment=runtimeEnvironment}={}){this.c=c;this.now=now;this.spawn=spawnImpl;this.environment=environment;this.commandOverride=command;this.events=[];this.partial='';this.problem=null;this.record={source:'docker-engine-observer/v1',requestID,agent,sessionKey,startedAt:now(),expectedImageID:c.imageID,status:'BLOCKED',artifacts:[]};}
 async command(args){if(this.commandOverride)return this.commandOverride(args);ensure(this.env&&typeof this.c.docker==='string','COMMISSIONING_OBSERVER_UNAVAILABLE');const r=await execute(this.c.docker,args,{env:this.env,encoding:'utf8',timeout:10000,maxBuffer:4194304,shell:false,windowsHide:true});return r.stdout;}
 async ids(){const raw=await this.command(['ps','-aq','--no-trunc']);const ids=raw.trim()?raw.trim().split(/\r?\n/):[];ensure(ids.length<=128&&ids.every(hash),'COMMISSIONING_CONTAINER_LIMIT');return ids;}
 async start(){
  this.gateway=await new GatewayToolObserver(this.c,this.record,{now:this.now}).start();
  try{
   this.env=this.environment(this.c);ensure(typeof this.c.docker==='string'&&path.isAbsolute(this.c.docker),'COMMISSIONING_DOCKER_PATH_REQUIRED');
   this.record.beforeContainerIDs=await this.ids();
   this.child=this.spawn(this.c.docker,['events','--since',new Date(this.record.startedAt).toISOString(),'--format','json','--filter','type=container'],{env:this.env,stdio:['ignore','pipe','pipe'],shell:false});
   this.child.stdout.on('data',data=>{this.partial+=data.toString('utf8');if(this.partial.length>1048576){this.problem='COMMISSIONING_EVENT_LIMIT';this.child.kill('SIGTERM');return;}let p;while((p=this.partial.indexOf('\n'))>=0){const line=this.partial.slice(0,p);this.partial=this.partial.slice(p+1);try{const event=sanitizeEngineEvent(JSON.parse(line));if(event)this.events.push(event);if(this.events.length>2000){this.problem='COMMISSIONING_EVENT_LIMIT';this.child.kill('SIGTERM');}}catch{this.problem='COMMISSIONING_EVENT_FORMAT';}}});
   this.child.stderr.on('data',()=>{});
   this.deadline=setTimeout(()=>{this.problem='COMMISSIONING_EVENT_DEADLINE';this.child.kill('SIGTERM');},700000);this.deadline.unref();
   this.closed=new Promise(resolve=>{this.child.once('error',()=>{this.problem='COMMISSIONING_EVENT_STREAM_UNAVAILABLE';if(!this.child.pid)this.processClosed=true;resolve();});this.child.once('close',code=>{this.processClosed=true;if(!this.stopping&&code!==null)this.problem='COMMISSIONING_EVENT_STREAM_INTERRUPTED';resolve();});});
  }catch(e){this.problem=safeCode(e);}
  return this;
 }
 async capture(session,outputs=[],finalText=''){
  this.finalText=finalText;
  if(this.problem)return;
  try{
   const ids=await this.ids();ensure(ids.length>0,'COMMISSIONING_SESSION_CONTAINER_REQUIRED');
   const inspections=JSON.parse(await this.command(['inspect',...ids])),container=selectSessionContainer(inspections,session.root,this.c.imageID);
   const workspaceSHA256=sha256(session.root);
   this.record.inspect={Id:container.Id,Image:container.Image,HostConfig:{NetworkMode:container.HostConfig?.NetworkMode,Privileged:container.HostConfig?.Privileged,ReadonlyRootfs:container.HostConfig?.ReadonlyRootfs},Mounts:container.Mounts.filter(m=>m.Destination==='/workspace').map(m=>({sourceSHA256:sha256(m.Source),Destination:m.Destination,RW:m.RW}))};
   this.record.explainArguments=['sandbox','explain','--agent',session.agent,'--session',session.key,'--json'];
   this.record.explain={agentId:session.explain.agentId,sandbox:{sessionIsSandboxed:session.explain.sandbox.sessionIsSandboxed,backend:session.explain.sandbox.backend,scope:session.explain.sandbox.scope,workspaceAccess:session.explain.sandbox.workspaceAccess,workspaceSHA256}};
   this.record.unrelatedBefore=this.record.beforeContainerIDs.filter(id=>id!==container.Id);
   const temp=fs.mkdtempSync(path.join(this.c.profileDir,'observation-'));fs.chmodSync(temp,0o700);
   try{for(const output of outputs){ensure(/^[A-Za-z0-9][A-Za-z0-9_.\/-]*$/.test(output.name)&&!output.name.split('/').some(p=>p==='.'||p==='..'||!p),'COMMISSIONING_ARTIFACT_PATH');const destination=path.join(temp,crypto.randomUUID());await this.command(['cp',container.Id+':/workspace/deliverables/'+output.name,destination]);const fd=fs.openSync(destination,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);ensure(st.isFile()&&st.nlink===1&&st.size>0&&st.size<=output.maxBytes,'COMMISSIONING_ARTIFACT_SIZE');const bytes=fs.readFileSync(fd);this.record.artifacts.push({name:output.name,bytes:bytes.length,sha256:sha256(bytes),readMethod:'docker-cp',containerID:container.Id,path:'/workspace/deliverables/'+output.name});}finally{fs.closeSync(fd);}}}finally{fs.rmSync(temp,{recursive:true,force:true});}
  }catch(e){this.problem=safeCode(e);}
 }
 async finish(finalFiles=null){
  this.stopping=true;clearTimeout(this.deadline);
  if(this.child){const wait=async()=>{let timer;try{await Promise.race([this.closed,new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{clearTimeout(timer);}};this.child.kill('SIGTERM');await wait();if(!this.processClosed){this.child.kill('SIGKILL');await wait();}}
  this.record.processTerminationConfirmed=!this.child||this.processClosed===true;
  if(!this.record.processTerminationConfirmed)this.problem='COMMISSIONING_OBSERVER_TERMINATION_UNCONFIRMED';
  try{this.record.afterContainerIDs=await this.ids();this.record.unrelatedAfter=this.record.afterContainerIDs.filter(id=>id!==this.record.inspect?.Id);if(finalFiles)for(const [name,bytes]of finalFiles){const artifact=this.record.artifacts.find(a=>a.name===name);ensure(artifact&&artifact.sha256===sha256(bytes)&&artifact.bytes===bytes.length,'COMMISSIONING_ARTIFACT_CHANGED_DURING_CLEANUP');}}catch(e){this.problem??=safeCode(e);}
  if(!this.record.inspect)this.problem??='COMMISSIONING_SESSION_CONTAINER_REQUIRED';
  this.record.events=this.events.filter(e=>e.Actor.ID===this.record.inspect?.Id);this.record.finishedAt=this.now();this.record.status=this.problem?'BLOCKED':'CAPTURED';this.record.code=this.problem;
  this.record.gatewayTrace=this.gateway?await this.gateway.finish({finalText:this.finalText,engineEvents:this.record.events,containerID:this.record.inspect?.Id}):{status:'BLOCKED',code:'COMMISSIONING_TRACE_NOT_STARTED'};this.finalText=undefined;this.record.finishedAt=this.now();
  const directory=path.join(this.c.profileDir,'commissioning-observations');
  try{ensure(!fs.existsSync(directory)||fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink(),'COMMISSIONING_EVIDENCE_DIRECTORY');fs.mkdirSync(directory,{recursive:true,mode:0o700});const names=fs.readdirSync(directory);ensure(names.length<1000,'COMMISSIONING_EVIDENCE_LIMIT');atomicWrite(path.join(directory,this.record.requestID+'.json'),JSON.stringify(this.record)+'\n');this.record.persistence='PASS';}catch(e){this.record.status='BLOCKED';this.record.code=safeCode(e);this.record.persistence='FAIL';}
  return this.record;
 }
}
export async function observeExecution(worker,agent,id){
 const scope={requestID:id,agent,sessionKey:`agent:${agent}:agi-work-${id}`};
 if(worker.executionObserverFactory)return worker.executionObserverFactory(worker.c,scope);
 if(worker.verifyPolicy===false)return {capture:async()=>{},finish:async()=>({status:'NOT_TESTED',code:'MOCKED_EXECUTION'})};
 return new DockerExecutionObserver(worker.c,scope).start();
}
