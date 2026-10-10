import fs from 'node:fs';
import path from 'node:path';
import {ensure,sha256,canonical} from '../src/util.mjs';

// Pinned to OpenClaw ec9c1a13db8938e5a3eaa51fca2e981cde2395a9 (2026.9.5).
// Canonical storage is SQLite, not the optional legacy JSONL mirror.
export const TRACE_VERSION='2026.9.5';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const safeID=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const PREFIX='export PATH="${OPENCLAW_PREPEND_PATH}:$PATH"; unset OPENCLAW_PREPEND_PATH; ';
export function expectedExecEventHashes(command){
 ensure(typeof command==='string'&&command.length>0&&command.length<=65536,'COMMISSIONING_TRACE_COMMAND');
 return ['',''+PREFIX].map(prefix=>sha256('exec_create: /bin/sh -lc '+prefix+command));
}
function plainFile(root,file){
 ensure(path.isAbsolute(root)&&file.startsWith(root+path.sep),'COMMISSIONING_TRACE_PATH');
 let cursor=root;for(const part of path.relative(root,file).split(path.sep)){ensure(!fs.existsSync(cursor)||fs.lstatSync(cursor).isDirectory()&&!fs.lstatSync(cursor).isSymbolicLink(),'COMMISSIONING_TRACE_PATH');cursor=path.join(cursor,part);}
 if(!fs.existsSync(file))return null;
 const stat=fs.lstatSync(file);ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.uid===process.getuid?.(),'COMMISSIONING_TRACE_PATH');
 for(const suffix of ['-wal','-shm'])if(fs.existsSync(file+suffix))ensure(fs.lstatSync(file+suffix).isFile()&&!fs.lstatSync(file+suffix).isSymbolicLink(),'COMMISSIONING_TRACE_PATH');
 return stat;
}
export async function readGatewayTranscript(c,scope,{metadataOnly=false}={}){
 ensure(c.runtimeDependencies?.openclaw===TRACE_VERSION&&['agi-creator','agi-reviewer'].includes(scope.agent)&&scope.sessionKey===`agent:${scope.agent}:agi-work-${scope.requestID}`,'COMMISSIONING_TRACE_VERSION');
 const root=path.resolve(c.profileDir),file=path.join(root,'agents',scope.agent,'agent','openclaw-agent.sqlite'),before=plainFile(root,file);
 if(!before)return {missing:true,sessionId:null,rows:[]};
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=2000; BEGIN');
  const meta=db.prepare("SELECT role,agent_id,app_version FROM schema_meta WHERE meta_key='primary'").get();
  ensure(meta?.role==='agent'&&meta.agent_id===scope.agent&&meta.app_version===TRACE_VERSION,'COMMISSIONING_TRACE_VERSION');
  const node=db.prepare('SELECT current_session_id,entry_json FROM session_nodes WHERE session_key=?').get(scope.sessionKey);
  if(!node)return {missing:false,sessionId:null,rows:[]};
  ensure(Buffer.byteLength(node.entry_json)<=262144,'COMMISSIONING_TRACE_LIMIT');
  const entry=JSON.parse(node.entry_json);ensure(safeID(node.current_session_id)&&entry.sessionId===node.current_session_id,'COMMISSIONING_TRACE_SESSION');
  const window=db.prepare('SELECT session_key FROM session_windows WHERE session_id=?').get(node.current_session_id);
  ensure(window?.session_key===scope.sessionKey,'COMMISSIONING_TRACE_SESSION');
  if(metadataOnly)return {sessionId:node.current_session_id,rows:[]};
  const totals=db.prepare('SELECT count(*) AS n,sum(length(CAST(event_json AS BLOB))) AS bytes,max(seq) AS maxSeq FROM transcript_events WHERE session_id=?').get(node.current_session_id);
  ensure(totals.n>0&&totals.n<=500&&totals.bytes<=2097152,'COMMISSIONING_TRACE_LIMIT');
  const rows=db.prepare('SELECT e.seq,e.event_json,e.created_at FROM transcript_events AS e JOIN session_transcript_active_events AS a ON a.session_id=e.session_id AND a.event_seq=e.seq WHERE e.session_id=? ORDER BY e.seq LIMIT 501').all(node.current_session_id);
  const after=plainFile(root,file);ensure(after&&before.dev===after.dev&&before.ino===after.ino,'COMMISSIONING_TRACE_REPLACED');
  return {sessionId:node.current_session_id,maxSeq:totals.maxSeq,rows:rows.map(r=>({seq:r.seq,createdAt:r.created_at,event:JSON.parse(r.event_json)}))};
 }finally{try{db.exec('ROLLBACK');}finally{db.close();}}
}
export function projectGatewayTools(snapshot,scope,{startedAt,finishedAt,finalText,engineEvents,containerID,requireExecCorrelation=true}){
 ensure(snapshot.sessionId&&Array.isArray(snapshot.rows)&&snapshot.rows.length<=500,'COMMISSIONING_TRACE_SESSION');
 const rows=snapshot.rows.filter(r=>r.event?.type==='message');
 ensure(rows.length>0&&rows.every(r=>Number.isSafeInteger(r.seq)&&Number.isSafeInteger(r.createdAt)&&r.createdAt>=startedAt&&r.createdAt<=finishedAt),'COMMISSIONING_TRACE_TIME');
 const outputs=rows.filter(r=>['assistant','toolResult'].includes(r.event.message?.role)),runs=new Set(outputs.map(r=>r.event.message.__openclaw?.runId));
 ensure(runs.size===1&&safeID([...runs][0]),'COMMISSIONING_TRACE_RUN');
 const terminal=outputs.filter(r=>r.event.message.role==='assistant'&&Array.isArray(r.event.message.content)&&!r.event.message.content.some(b=>['toolCall','toolUse','functionCall'].includes(b.type))).at(-1);
 ensure(terminal&&terminal.event.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim()===String(finalText).trim(),'COMMISSIONING_TRACE_FINAL_RESPONSE');
 const calls=[];
 for(const row of outputs){const m=row.event.message;if(m.role!=='assistant'||!Array.isArray(m.content))continue;
  for(const b of m.content){if(!['toolCall','toolUse','functionCall'].includes(b.type)||!safeID(b.id)||!safeID(b.name))continue;
   const result=outputs.filter(r=>r.seq>row.seq&&r.seq<terminal.seq&&r.event.message.role==='toolResult'&&r.event.message.toolCallId===b.id);
   if(result.length!==1)continue;const rm=result[0].event.message;
   if(rm.toolName!==b.name||rm.isError!==false||rm.details?.openclawSyntheticMissingToolResult===true)continue;
   const args=b.arguments??b.input,proof={tool:b.name,toolCallSHA256:sha256(b.id),callSeq:row.seq,resultSeq:result[0].seq,argumentsSHA256:sha256(canonical(args??{})),resultSHA256:sha256(canonical(rm)),isError:false};
   if(b.name==='agi_public_browser'){try{const text=rm.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');proof.resultTextSHA256=sha256(canonical(JSON.parse(text)));}catch{}}
   if(b.name==='exec'&&rm.details?.status==='completed'&&rm.details.exitCode===0){
    const candidates=expectedExecEventHashes(args?.command),create=engineEvents.find(e=>e.Actor?.ID===containerID&&e.Action==='exec_create'&&candidates.includes(e.commandSHA256));
    if(create&&hash(create.Actor.Attributes?.execID)){
     const execID=create.Actor.Attributes.execID,start=engineEvents.findIndex(e=>e.Actor?.ID===containerID&&e.Action==='exec_start'&&e.Actor.Attributes?.execID===execID),end=engineEvents.findIndex(e=>e.Actor?.ID===containerID&&e.Action==='exec_die'&&e.Actor.Attributes?.execID===execID&&e.Actor.Attributes?.exitCode==='0');
     if(start>engineEvents.indexOf(create)&&end>start)Object.assign(proof,{engineExecID:execID,engineCommandSHA256:create.commandSHA256,commandSHA256:sha256(args.command),containerID});
    }
   }
   calls.push(proof);
  }
 }
 if(requireExecCorrelation)ensure(calls.some(c=>c.tool==='exec'&&c.engineExecID),'COMMISSIONING_TRACE_EXEC_CORRELATION_REQUIRED');
 return {source:'openclaw-sqlite-observer/v1',openclawVersion:TRACE_VERSION,status:'CAPTURED',requestID:scope.requestID,agent:scope.agent,sessionKey:scope.sessionKey,sessionIDSHA256:sha256(snapshot.sessionId),runIDSHA256:sha256([...runs][0]),beforeSeq:0,afterSeq:snapshot.maxSeq,startedAt,finishedAt,finalResponseSHA256:sha256(String(finalText).trim()),calls};
}
export class GatewayToolObserver{
 constructor(c,scope,{now=Date.now,read=readGatewayTranscript}={}){Object.assign(this,{c,scope,now,read});this.startedAt=now();this.problem=null;}
 async start(){try{const before=await this.read(this.c,this.scope,{metadataOnly:true});ensure(before.sessionId===null,'COMMISSIONING_TRACE_SESSION_NOT_FRESH');}catch(e){this.problem=/^COMMISSIONING_[A-Z0-9_]+$/.test(e.message)?e.message:'COMMISSIONING_TRACE_UNAVAILABLE';}return this;}
 async finish(options){try{ensure(!this.problem,this.problem??'COMMISSIONING_TRACE_UNAVAILABLE');return projectGatewayTools(await this.read(this.c,this.scope),this.scope,{...options,startedAt:this.startedAt,finishedAt:this.now()});}catch(e){return {source:'openclaw-sqlite-observer/v1',status:'BLOCKED',code:/^COMMISSIONING_[A-Z0-9_]+$/.test(e.message)?e.message:'COMMISSIONING_TRACE_UNAVAILABLE'};}}
}
export function verifyGatewayTrace(trace,request,engine){
 ensure(trace?.source==='openclaw-sqlite-observer/v1'&&trace.status==='CAPTURED'&&trace.openclawVersion===TRACE_VERSION,'COMMISSIONING_TRACE_SOURCE');
 ensure(trace.requestID===request.id&&trace.agent===request.agent&&trace.sessionKey===engine.sessionKey&&trace.beforeSeq===0&&Number.isSafeInteger(trace.afterSeq)&&trace.afterSeq>0&&hash(trace.sessionIDSHA256)&&hash(trace.runIDSHA256)&&hash(trace.finalResponseSHA256),'COMMISSIONING_TRACE_SESSION');
 ensure(trace.startedAt>=engine.startedAt&&trace.finishedAt>=trace.startedAt&&trace.finishedAt<=engine.finishedAt+2000,'COMMISSIONING_TRACE_TIME');
 ensure(Array.isArray(trace.calls)&&trace.calls.length<=500,'COMMISSIONING_TRACE_LIMIT');
 const calls=trace.calls.filter(c=>c.tool==='exec'&&c.isError===false&&Number.isSafeInteger(c.callSeq)&&Number.isSafeInteger(c.resultSeq)&&c.callSeq>0&&c.resultSeq>c.callSeq&&c.resultSeq<=trace.afterSeq&&hash(c.toolCallSHA256)&&hash(c.argumentsSHA256)&&hash(c.resultSHA256)&&hash(c.commandSHA256)&&hash(c.engineExecID)&&c.containerID===engine.inspect?.Id);
 ensure(calls.some(c=>{const i=engine.events.findIndex(e=>e.Action==='exec_create'&&e.Actor?.ID===c.containerID&&e.Actor.Attributes?.execID===c.engineExecID&&e.commandSHA256===c.engineCommandSHA256);return i>=0&&engine.events.some((s,j)=>j>i&&s.Action==='exec_start'&&s.Actor?.ID===c.containerID&&s.Actor.Attributes?.execID===c.engineExecID&&engine.events.some((d,k)=>k>j&&d.Action==='exec_die'&&d.Actor?.ID===c.containerID&&d.Actor.Attributes?.execID===c.engineExecID&&d.Actor.Attributes?.exitCode==='0'));}),'COMMISSIONING_TRACE_EXEC_CORRELATION_REQUIRED');
 return {source:trace.source,sessionIDSHA256:trace.sessionIDSHA256,runIDSHA256:trace.runIDSHA256,completedToolCalls:trace.calls.length,correlatedExecCalls:calls.length,providerIdentityIndependentlyAttested:false};
}
