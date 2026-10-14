import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture} from './helpers.mjs';
import {createServer} from '../supervisor/server.mjs';
import {client} from '../cli/main.mjs';
import fs from 'node:fs';

test('HTTP rejects missing credentials, foreign Host/Origin, null Origin, unknown routes and scoped escalation',async()=>{
  const f=fixture(),s=createServer(f.runtime);try{const {url}=await s.start(),t=f.runtime.issueClient();
    const req=(route='status',headers={},body={})=>new Promise((resolve,reject)=>{const q=http.request(url+'/v1/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t.token,...headers}},r=>{r.resume();r.on('end',()=>resolve({status:r.statusCode}));});q.on('error',reject);q.end(JSON.stringify(body));});
    assert.equal((await req()).status,200);assert.equal((await req('status',{Authorization:''})).status,400);
    assert.equal((await req('status',{Origin:'http://evil.test'})).status,403);assert.equal((await req('status',{Origin:'null'})).status,403);assert.equal((await req('status',{Host:'localhost'})).status,403);
    assert.equal((await req('host-command',{},{})).status,400);
    const a=f.create(),c=f.runtime.issueClient(a.id);assert.equal((await req('create',{Authorization:'Bearer '+c.token},{role:'node',name:'forged'})).status,400);
    const page=await fetch(url+'/');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('access-control-allow-origin'),null);
  }finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}
});
test('local Unix socket CLI uses the same authority path; a second supervisor cannot take its socket',async()=>{
  const f=fixture(),socket=f.directory+'/control.sock',s=createServer(f.runtime,{socket});let second;
  try{await s.start();const {token}=f.runtime.issueClient();fs.writeFileSync(f.directory+'/credential',token,{mode:0o600});
    const result=await client({state:f.directory,tokenFile:f.directory+'/credential',action:'status',input:{}});assert.equal(result.schema,'agi-fleet/local-status/v1');assert.equal(fs.statSync(socket).mode&0o777,0o600);
    second=createServer(f.runtime,{socket});await assert.rejects(second.start(),/EADDRINUSE/);
  }finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}
});
test('WebSocket upgrades are closed without a control session',async()=>{
  const f=fixture(),s=createServer(f.runtime);try{const {url}=await s.start();await new Promise((resolve,reject)=>{const req=http.request(url,{headers:{Connection:'Upgrade',Upgrade:'websocket'}});req.on('upgrade',()=>reject(Error('UPGRADE_ACCEPTED')));req.on('error',()=>resolve());req.setTimeout(1000,()=>req.destroy());req.end();});}finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}
});
