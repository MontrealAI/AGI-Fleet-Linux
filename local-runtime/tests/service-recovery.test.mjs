import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers.mjs';
import {recoverService} from '../supervisor/recover-service.mjs';
import {createServer} from '../supervisor/server.mjs';
import {Store} from '../supervisor/store.mjs';

test('operator recovery without a socket stops intake, revokes unused grants and invalidates bindings',async()=>{
  const f=fixture();try{
    const a=f.create(),g=f.prepare(a);f.authorize(g);
    await assert.rejects(recoverService(f.directory),/CONFIRM_REQUIRED/);
    const result=await recoverService(f.directory,{confirm:true});
    assert.equal(result.state,'STOP');assert.equal(result.replayAllowed,false);
    assert.equal(f.runtime.store.meta('stopped'),true);
    assert.equal(f.runtime.store.actor(a.id).active,false);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'revoked');
    assert.throws(()=>f.prepare(a),/STOP_RECONCILIATION_REQUIRED/);
  }finally{f.close();}
});
test('recovery never removes a live supervisor socket or an unowned file',async()=>{
  const f=fixture(),socket=path.join(f.directory,'control.sock'),s=createServer(f.runtime,{socket});
  try{
    await s.start();await assert.rejects(recoverService(f.directory,{confirm:true}),/SUPERVISOR_STILL_ACTIVE/);
    assert.equal(fs.lstatSync(socket).isSocket(),true);
    await new Promise(resolve=>s.server.close(resolve));
    fs.writeFileSync(socket,'unowned',{mode:0o600});
    await assert.rejects(recoverService(f.directory,{confirm:true}),/SOCKET_OWNERSHIP_UNKNOWN/);
    assert.equal(fs.readFileSync(socket,'utf8'),'unowned');
  }finally{if(s.server.listening)await new Promise(resolve=>s.server.close(resolve));f.close();}
});
test('service recovery owns the endpoint while changing authority and releases it after a storage fault',async()=>{
  const f=fixture(),socket=path.join(f.directory,'control.sock'),recover=Store.prototype.recover;
  let observed=0;
  try{
    const a=f.create(),g=f.prepare(a);f.authorize(g);
    Store.prototype.recover=function(){
      assert.equal(fs.lstatSync(socket).isSocket(),true);assert.equal(fs.statSync(socket).mode&0o777,0o600);
      const contender=spawnSync(process.execPath,['--input-type=module','-e',"import net from 'node:net';const s=net.createServer();s.once('error',e=>{console.log(e.code);process.exitCode=e.code==='EADDRINUSE'?0:1;});s.listen(process.argv[1],()=>{console.log('STOLE_SOCKET');s.close();process.exitCode=1;});",socket],{encoding:'utf8',timeout:10000});
      assert.equal(contender.status,0,contender.stderr);assert.equal(contender.stdout.trim(),'EADDRINUSE');observed++;
      throw Error('STORAGE_FAULT');
    };
    await assert.rejects(recoverService(f.directory,{confirm:true}),/STORAGE_FAULT/);
    assert.equal(observed,1);assert.equal(fs.existsSync(socket),false);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'authorized');
    Store.prototype.recover=recover;
    assert.equal((await recoverService(f.directory,{confirm:true})).state,'STOP');
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'revoked');
  }finally{Store.prototype.recover=recover;f.close();}
});
