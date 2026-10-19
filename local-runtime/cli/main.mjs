#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {LocalRuntime} from '../supervisor/runtime.mjs';
import {readPrivate,privateDirectory} from '../supervisor/store.mjs';
import {createServer} from '../supervisor/server.mjs';
import {need,parseStrict,canonical} from '../contracts.mjs';
import {MAX_BYTES,CAPSULE_ENVELOPE_BYTES,decodeUTF8} from '../primitives.mjs';
import {recoverService} from '../supervisor/recover-service.mjs';

export async function client({state,tokenFile,action,input}) {
  privateDirectory(state);const token=readPrivate(tokenFile,100).toString().trim();
  return await new Promise((resolve,reject)=>{
    const req=http.request({socketPath:path.join(state,'control.sock'),method:'POST',path:'/v1/'+action,headers:{Host:'localhost',Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
      const maximum=['project-export','journey-export','journey-inspect','computer-export'].includes(action)?CAPSULE_ENVELOPE_BYTES:MAX_BYTES;
      const parts=[];let n=0;res.on('data',b=>{n+=b.length;if(n>maximum)req.destroy(new Error('OUTPUT_LIMIT'));else parts.push(b);});res.on('end',()=>{try{const value=parseStrict(decodeUTF8(Buffer.concat(parts)),maximum);need(res.statusCode===200,value.error||'REQUEST_FAILED');resolve(value);}catch(e){reject(e);}});
    });req.on('error',reject);req.setTimeout(action==='run'?180000:25000,()=>req.destroy(new Error('CONTROL_TIMEOUT')));req.end(canonical(input));
  });
}
export async function main(args=process.argv.slice(2)) {
  process.umask(0o077);
  const action=args.shift(),state=path.resolve(process.env.AGI_LOCAL_STATE||path.join(os.homedir(),'.local','state','agi-fleet-local'));
  if(!action||action==='help'){console.log('AGI Fleet Local Skills — development preview\ninit | serve [--computer-config /absolute/private-profile.json] | status | doctor | diagnostics\nrequest ACTION PRIVATE_INPUT.json\nrecover-service --confirm\nUse AGI_LOCAL_STATE for a fresh state directory outside the checkout.\nAGI_LOCAL_TOKEN_FILE selects an operator or scoped actor credential (0600).\nThe optional Computer Use route is a zero-cost scripted browser rehearsal.\nNo funded work, general desktop or live provider support is qualified.');return;}
  const tokenFile=process.env.AGI_LOCAL_TOKEN_FILE||path.join(state,'operator.token');
  if(action==='init'){
    need(args.length===0&&!fs.existsSync(state),'FRESH_STATE_REQUIRED');
    fs.mkdirSync(path.dirname(state),{recursive:true,mode:0o700});
    fs.mkdirSync(state,{mode:0o700});
    const staged=fs.mkdtempSync(path.join(path.dirname(state),'.fleet-init-'));
    let runtime;
    try{
      runtime=new LocalRuntime(staged,{create:true});
      const {token}=runtime.issueClient();
      const fd=fs.openSync(path.join(staged,'operator.token'),'wx',0o600);
      try{fs.writeFileSync(fd,token+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      runtime.close();runtime=null;
      fs.renameSync(staged,state);
      console.log(JSON.stringify({installed:true,state,authority:'none',next:'serve',credentialFile:path.join(state,'operator.token')}));
    }catch(e){if(runtime)runtime.close();fs.rmSync(staged,{recursive:true,force:true});if(fs.existsSync(state)&&fs.readdirSync(state).length===0)fs.rmdirSync(state);throw e;}
    return;
  }
  if(action==='recover-service'){need(args.length===1&&args[0]==='--confirm','CONFIRM_REQUIRED');console.log(JSON.stringify(await recoverService(state,{confirm:true})));return;}
  if(action==='serve'){
    need(args.length===0||(args.length===2&&args[0]==='--computer-config'&&path.isAbsolute(args[1])),'ARGUMENTS_INVALID');
    const runtime=new LocalRuntime(state,{computerConfigFile:args.length?args[1]:null});
    const socket=path.join(state,'control.sock');
    // Never remove an existing socket or guess that a supervisor is dead.
    const ipc=createServer(runtime,{socket});
    try{await ipc.start();runtime.store.recover();}catch(e){runtime.close();throw e;}
    const ui=createServer(runtime);const address=await ui.start();
    console.log(JSON.stringify({...address,credentialFile:tokenFile,notice:'Open the local dashboard and paste the operator credential. Keep it out of chat, URLs and shared files.'}));
    let closing=false;
    const shutdown=()=>{if(closing)return;closing=true;const p=runtime.authenticate(readPrivate(path.join(state,'operator.token'),100).toString().trim());runtime.stop({actor:null},p);ipc.server.close();ui.server.close();ui.server.closeIdleConnections();ipc.server.closeIdleConnections();const timer=setInterval(()=>{if(!runtime.active.size){clearInterval(timer);runtime.close();}},50);};
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);return;
  }
  let input={},operation=action;
  if(action==='request'){need(args.length===2&&/^[a-z-]+$/.test(args[0]),'ARGUMENTS_INVALID');operation=args[0];const maximum=['project-import','journey-import'].includes(operation)?CAPSULE_ENVELOPE_BYTES:MAX_BYTES;input=parseStrict(decodeUTF8(readPrivate(path.resolve(args[1]),maximum)),maximum);}
  else need(['status','doctor','diagnostics'].includes(action)&&args.length===0,'ARGUMENTS_INVALID');
  console.log(JSON.stringify(await client({state,tokenFile,action:operation,input}),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({error:e.code||e.message,help:e.code==='ENOENT'?'Initialize a fresh installation or start the local runtime. Do not fall back to unrestricted shell work.':undefined}));process.exitCode=1;});
