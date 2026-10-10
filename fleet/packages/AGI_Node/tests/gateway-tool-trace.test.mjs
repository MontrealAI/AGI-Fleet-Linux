import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {sha256} from '../src/util.mjs';
import {GatewayToolObserver,readGatewayTranscript,projectGatewayTools,expectedExecEventHashes,verifyGatewayTrace} from '../compute/gateway-tool-trace.mjs';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-gateway-trace-')),requestID=crypto.randomUUID(),agent='agi-creator',scope={requestID,agent,sessionKey:`agent:${agent}:agi-work-${requestID}`},c={profileDir:root,runtimeDependencies:{openclaw:'2026.9.5'}},sessionId=crypto.randomUUID(),runId=crypto.randomUUID(),container='a'.repeat(64),execID='b'.repeat(64),command='python3 -c "print(42)"',finalText='{"status":"complete","content":"files-ready"}',at=10000;
 const dbfile=path.join(root,'agents',agent,'agent','openclaw-agent.sqlite');fs.mkdirSync(path.dirname(dbfile),{recursive:true});const db=new DatabaseSync(dbfile);
 // Exact pinned upstream table/column names; unrelated schema is unnecessary.
 db.exec("CREATE TABLE schema_meta(meta_key TEXT PRIMARY KEY,role TEXT,agent_id TEXT,app_version TEXT); CREATE TABLE session_nodes(session_key TEXT PRIMARY KEY,current_session_id TEXT,entry_json TEXT); CREATE TABLE session_windows(session_id TEXT PRIMARY KEY,session_key TEXT); CREATE TABLE transcript_events(session_id TEXT,seq INTEGER,event_json TEXT,created_at INTEGER,PRIMARY KEY(session_id,seq)); CREATE TABLE session_transcript_active_events(session_id TEXT,event_seq INTEGER,PRIMARY KEY(session_id,event_seq));");
 db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?)').run('primary','agent',agent,'2026.9.5');
 const add=()=>{
  db.prepare('INSERT INTO session_nodes VALUES(?,?,?)').run(scope.sessionKey,sessionId,JSON.stringify({sessionId}));db.prepare('INSERT INTO session_windows VALUES(?,?)').run(sessionId,scope.sessionKey);
  const messages=[{role:'user',content:[{type:'text',text:'Complete public fixture'}]},{role:'assistant',content:[{type:'toolCall',id:'call_1',name:'exec',arguments:{command}}],__openclaw:{runId}},{role:'toolResult',toolCallId:'call_1',toolName:'exec',isError:false,details:{status:'completed',exitCode:0,aggregated:'PRIVATE OUTPUT NOT EXPORTED'},content:[{type:'text',text:'42'}],__openclaw:{runId}},{role:'assistant',content:[{type:'text',text:finalText}],__openclaw:{runId}}];
  messages.forEach((message,i)=>{db.prepare('INSERT INTO transcript_events VALUES(?,?,?,?)').run(sessionId,i+1,JSON.stringify({type:'message',id:crypto.randomUUID(),message}),at+i+1);db.prepare('INSERT INTO session_transcript_active_events VALUES(?,?)').run(sessionId,i+1);});
 };
 const engineEvents=['exec_create','exec_start','exec_die'].map(Action=>({Type:'container',Action,time:10,commandSHA256:expectedExecEventHashes(command)[1],Actor:{ID:container,Attributes:{execID,...(Action==='exec_die'?{exitCode:'0'}:{})}}}));
 return {root,c,scope,sessionId,runId,command,db,dbfile,add,options:{startedAt:at,finishedAt:at+100,finalText,engineEvents,containerID:container},close(){db.close();fs.rmSync(root,{recursive:true,force:true});}};
}
test('pinned SQLite observer reads exact fresh session and correlates actual tool command with Engine exec',async()=>{
 const h=fixture();try{
  const observer=await new GatewayToolObserver(h.c,h.scope,{now:()=>10000}).start();assert.equal(observer.problem,null);h.add();observer.now=()=>10100;
  const before=sha256(fs.readFileSync(h.dbfile)),result=await observer.finish(h.options);assert.equal(result.status,'CAPTURED');assert.equal(result.calls.length,1);assert.equal(result.calls[0].commandSHA256,sha256(h.command));assert.equal(sha256(fs.readFileSync(h.dbfile)),before);
  const text=JSON.stringify(result);for(const privateValue of [h.root,h.command,'PRIVATE OUTPUT',h.runId,h.sessionId])assert.ok(!text.includes(privateValue));
  assert.ok(verifyGatewayTrace(result,{id:h.scope.requestID,agent:h.scope.agent},{sessionKey:h.scope.sessionKey,startedAt:10000,finishedAt:10100,inspect:{Id:h.options.containerID},events:h.options.engineEvents}));
 }finally{h.close();}
});
test('historical sessions, another agent, schema drift and a symlink cannot become live tool proof',async()=>{
 const h=fixture();try{
  h.add();const observer=await new GatewayToolObserver(h.c,h.scope,{now:()=>10000}).start();assert.equal(observer.problem,'COMMISSIONING_TRACE_SESSION_NOT_FRESH');
  await assert.rejects(readGatewayTranscript({...h.c,runtimeDependencies:{openclaw:'other'}},h.scope),/VERSION/);
  h.db.prepare('UPDATE schema_meta SET agent_id=?').run('another-agent');await assert.rejects(readGatewayTranscript(h.c,h.scope),/VERSION/);h.db.prepare('UPDATE schema_meta SET agent_id=?').run(h.scope.agent);
  const alias=path.join(h.root,'alias');fs.symlinkSync(path.dirname(h.dbfile),alias);await assert.rejects(readGatewayTranscript({...h.c,profileDir:alias},h.scope),/TRACE_PATH/);
 }finally{h.close();}
});
test('model echo, synthetic results, wrong runs, stale rows, branch removal and infrastructure exec fail tool provenance',async()=>{
 const h=fixture();try{
  h.add();const snapshot=await readGatewayTranscript(h.c,h.scope);assert.equal(snapshot.rows.length,4);
  for(const mutate of [x=>x.rows[1].event.message.content=[{type:'text',text:'I ran Python and got 42'}],x=>x.rows[2].event.message.isError=true,x=>x.rows[2].event.message.details.openclawSyntheticMissingToolResult=true,x=>x.rows[2].event.message.__openclaw.runId='other-run',x=>x.rows[0].createdAt=9999,x=>x.rows=x.rows.filter(r=>r.seq!==3),x=>x.rows[2].event.message.details.exitCode=1]){const altered=structuredClone(snapshot);mutate(altered);assert.throws(()=>projectGatewayTools(altered,h.scope,h.options));}
  assert.throws(()=>projectGatewayTools(snapshot,h.scope,{...h.options,engineEvents:h.options.engineEvents.map(e=>({...e,commandSHA256:'f'.repeat(64)}))}),/EXEC_CORRELATION/);
  h.db.prepare('DELETE FROM session_transcript_active_events WHERE event_seq=3').run();assert.equal((await readGatewayTranscript(h.c,h.scope)).rows.length,3);
 }finally{h.close();}
});
test('trace materialization limits fail before unbounded event loading',async()=>{
 const h=fixture();try{h.add();h.db.prepare('UPDATE transcript_events SET event_json=? WHERE seq=3').run(JSON.stringify({type:'message',message:{content:'x'.repeat(2097152)}}));await assert.rejects(readGatewayTranscript(h.c,h.scope),/TRACE_LIMIT/);}finally{h.close();}
});
