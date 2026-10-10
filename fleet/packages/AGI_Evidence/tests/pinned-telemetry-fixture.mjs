import http from 'node:http';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
/** Exercise the exact release SDK GET/update writer with feature telemetry off.
 * Only a disposable local HTTP endpoint is contacted; no provider call occurs. */
export async function pinnedTelemetry(root,{nowMs=Date.now(),version='2026.9.5',note='local SDK fixture'}={}){
 const requests=[];const server=http.createServer((req,res)=>{requests.push({method:req.method,url:req.url});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({version,note}));});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
 const source=`const pkg=process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT;const telemetry=await import(pkg+'/dist/telemetry-CwSEtSer.mjs');const state=await import(pkg+'/dist/openclaw-state-db-BGE_KP3L.mjs');try{const value=await telemetry.r(()=>({update:{checkOnStart:true},telemetry:{enabled:false}}),{surface:'gateway',nowMs:${JSON.stringify(nowMs)}});if(!value)throw Error('PINNED_TELEMETRY_RESULT_REQUIRED');}finally{await state.closeOpenClawStateDatabaseAsync();}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',AGI_TEST_OPENCLAW_PACKAGE_ROOT:process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT,OPENCLAW_STATE_DIR:root,OPENCLAW_CONFIG_PATH:path.join(root,'openclaw.json'),OPENCLAW_TELEMETRY_ENDPOINT:'http://127.0.0.1:'+server.address().port+'/update',DO_NOT_TRACK:'1',CI:'true',NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{const status=await new Promise((r,j)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');j(Error('PINNED_TELEMETRY_TIMEOUT'));},30000);child.once('error',j);child.once('exit',code=>{clearTimeout(timer);r(code);});});assert.equal(status,0,output.slice(-3000));assert.deepEqual(requests,[{method:'GET',url:'/update'}]);return {pinnedRuntime:'2026.9.5',featureTelemetry:false,method:'GET',requests:requests.length};}finally{await new Promise(r=>server.close(r));}
}
