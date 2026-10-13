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

export async function client({state,tokenFile,action,input}) {
  privateDirectory(state);const token=readPrivate(tokenFile,100).toString().trim();
  return await new Promise((resolve,reject)=>{
    const req=http.request({socketPath:path.join(state,'control.sock'),method:'POST',path:'/v1/'+action,headers:{Host:'localhost',Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
      const parts=[];let n=0;res.on('data',b=>{n+=b.length;if(n>4_000_000)req.destroy(new Error('OUTPUT_LIMIT'));else parts.push(b);});res.on('end',()=>{try{const value=parseStrict(Buffer.concat(parts).toString());need(res.statusCode===200,value.error||'REQUEST_FAILED');resolve(value);}catch(e){reject(e);}});
    });req.on('error',reject);req.setTimeout(25000,()=>req.destroy(new Error('CONTROL_TIMEOUT')));req.end(canonical(input));
  });
}
export async function main(args=process.argv.slice(2)) {
  process.umask(0o077);
  const action=args.shift(),state=path.resolve(process.env.AGI_LOCAL_STATE||path.join(os.homedir(),'.local','state','agi-fleet-local'));
  if(!action||action==='help'){console.log('AGI Fleet Local Skills — development preview\ninit | serve | status | doctor\nrequest ACTION PRIVATE_INPUT.json\nUse AGI_LOCAL_STATE for a fresh state directory outside the checkout.\nAGI_LOCAL_TOKEN_FILE selects an operator or scoped actor credential (0600).\nNo funded work, native desktop or live provider support is qualified.');return;}
  const tokenFile=process.env.AGI_LOCAL_TOKEN_FILE||path.join(state,'operator.token');
  if(action==='init'){
    need(!fs.existsSync(state),'FRESH_STATE_REQUIRED');const runtime=new LocalRuntime(state,{create:true});
    try{const {token}=runtime.issueClient();fs.writeFileSync(path.join(state,'operator.token'),token+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({installed:true,state,authority:'none',next:'serve',credentialFile:path.join(state,'operator.token')}));}finally{runtime.close();}return;
  }
  if(action==='serve'){
    need(args.length===0,'ARGUMENTS_INVALID');const runtime=new LocalRuntime(state);
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
  if(action==='request'){need(args.length===2&&/^[a-z-]+$/.test(args[0]),'ARGUMENTS_INVALID');operation=args[0];input=parseStrict(readPrivate(path.resolve(args[1])).toString());}
  else need(['status','doctor'].includes(action)&&args.length===0,'ARGUMENTS_INVALID');
  console.log(JSON.stringify(await client({state,tokenFile,action:operation,input}),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({error:e.code||e.message,help:e.code==='ENOENT'?'Initialize a fresh installation or start the local runtime. Do not fall back to unrestricted shell work.':undefined}));process.exitCode=1;});
