import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './helpers.mjs';
import {recoverService} from '../supervisor/recover-service.mjs';
import {createServer} from '../supervisor/server.mjs';

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
