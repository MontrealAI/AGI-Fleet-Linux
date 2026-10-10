import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {startFixtureChild,stopFixtureChild} from './child-fixture.mjs';
import {publicBrowserRuntimeSocketPath,ensurePublicBrowserRuntimeDirectory,inspectPublicBrowserSocket,publicBrowserSocketsStopped,reclaimPublicBrowserSocket} from '../compute/public-browser-runtime.mjs';
import {startPublicBrowserBroker} from '../compute/public-browser-broker.mjs';
import {makePublicBrowserPolicy} from '../compute/public-browser-config.mjs';
import {startComputePublicBrowserBroker,ComputeWorker} from '../compute/server.mjs';

function fixture(t){const profileDir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'agi-runtime-test-'));fs.chmodSync(profileDir,0o700);const socketPath=publicBrowserRuntimeSocketPath(profileDir),directory=path.dirname(socketPath);t.after(()=>{fs.rmSync(profileDir,{recursive:true,force:true});fs.rmSync(directory,{recursive:true,force:true});});return {profileDir,socketPath,directory};}
async function abandoned(socketPath){const child=await startFixtureChild(process.execPath,['--input-type=module','-e',"import net from 'node:net';import fs from 'node:fs';const server=net.createServer();server.once('error',()=>process.exit(2));server.listen(process.argv[1],()=>{fs.chmodSync(process.argv[1],0o600);process.stdout.write('ready');});",socketPath]);await stopFixtureChild(child,{signal:'SIGKILL'});assert.ok(fs.lstatSync(socketPath).isSocket());}

test('runtime endpoint is stable, short on macOS, separate from durable state and independent of TMPDIR',()=>{
 const profileDir='/Users/'+ 'a'.repeat(1000)+'/.openclaw-agi-compute',options={uid:504,platform:'darwin'},socketPath=publicBrowserRuntimeSocketPath(profileDir,options);
 assert.match(socketPath,/^\/private\/tmp\/agi-web-504-[a-f0-9]{20}\/web\.sock$/);assert.ok(Buffer.byteLength(socketPath)<104);assert.equal(socketPath,publicBrowserRuntimeSocketPath(profileDir,options));assert.notEqual(socketPath,publicBrowserRuntimeSocketPath(profileDir+'-node',options));assert.ok(!socketPath.startsWith(profileDir+'/'));
 for(const value of ['relative','/tmp/../tmp/profile','/tmp/profile\0'])assert.throws(()=>publicBrowserRuntimeSocketPath(value),/SOCKET_INVALID/);
});
test('policy records external runtime path without creating it, including disabled policy',t=>{
 const f=fixture(t),p=makePublicBrowserPolicy({profileDir:f.profileDir});assert.equal(p.enabled,false);assert.equal(p.mode,'disabled');assert.equal(p.brokerSocketPath,f.socketPath);assert.equal(fs.existsSync(f.directory),false);
 const darwin=makePublicBrowserPolicy({profileDir:'/Users/compute/.openclaw-agi-compute',uid:504,platform:'darwin'});assert.match(darwin.brokerSocketPath,/^\/private\/tmp\/agi-web-504-/);
});
test('disabled public web never calls broker start and creates no runtime socket or directory',async t=>{
 const f=fixture(t);for(const p of [undefined,{enabled:false,mode:'disabled',brokerSocketPath:f.socketPath},{enabled:true,mode:'disabled',brokerSocketPath:f.socketPath},{enabled:false,mode:'commissioning',brokerSocketPath:f.socketPath}])assert.equal(await startComputePublicBrowserBroker({c:{profileDir:f.profileDir,publicWebPolicy:p}},{startBroker:()=>{throw Error('must not start');}}),null);
 assert.equal(fs.existsSync(f.directory),false);assert.equal(fs.existsSync(path.join(f.profileDir,'web.sock')),false);
});
test('enabled commissioning starts a real external broker and graceful close removes only its socket',async t=>{
 const f=fixture(t),worker={c:{profileDir:f.profileDir,publicWebPolicy:{enabled:true,mode:'commissioning',brokerSocketPath:f.socketPath}},publicWeb:{execute:async()=>({ok:true})},assertPolicy(){}};
 const broker=await startComputePublicBrowserBroker(worker);assert.ok(fs.lstatSync(f.socketPath).isSocket());assert.equal(fs.statSync(f.directory).mode&0o777,0o700);assert.equal(fs.statSync(f.socketPath).mode&0o777,0o600);assert.equal(fs.existsSync(path.join(f.profileDir,'web.sock')),false);assert.equal(await publicBrowserSocketsStopped(f),false);
 await broker.close();await broker.close();assert.equal(fs.existsSync(f.socketPath),false);assert.equal(await publicBrowserSocketsStopped(f),true);
});
test('enabled runtime rejects legacy and arbitrary endpoint paths before broker startup',async t=>{
 const f=fixture(t);for(const socketPath of [path.join(f.profileDir,'web.sock'),path.join(f.directory,'other.sock')])await assert.rejects(startComputePublicBrowserBroker({c:{profileDir:f.profileDir,publicWebPolicy:{enabled:true,mode:'commissioning',brokerSocketPath:socketPath}}},{startBroker:()=>{throw Error('must not start');}}),/SOCKET_INVALID/);
 assert.equal(fs.existsSync(f.directory),false);
});
test('fresh-install stop inspection permits absent profile and runtime without creating anything',async t=>{
 const f=fixture(t);fs.rmdirSync(f.profileDir);assert.equal(await publicBrowserSocketsStopped(f),true);assert.equal(fs.existsSync(f.directory),false);assert.equal(fs.existsSync(f.profileDir),false);
});
test('runtime directory symlink and permissive permissions fail closed without rewriting them',t=>{
 const f=fixture(t);fs.symlinkSync(f.profileDir,f.directory);assert.throws(()=>ensurePublicBrowserRuntimeDirectory(f),/SOCKET_SYMLINK/);assert.ok(fs.lstatSync(f.directory).isSymbolicLink());fs.unlinkSync(f.directory);fs.mkdirSync(f.directory,{mode:0o755});assert.throws(()=>ensurePublicBrowserRuntimeDirectory(f),/SOCKET_PERMISSIONS/);assert.equal(fs.statSync(f.directory).mode&0o777,0o755);
});
test('regular files, symlinks, directories and permissive sockets are never reclaimed',async t=>{
 const f=fixture(t);ensurePublicBrowserRuntimeDirectory(f);
 fs.writeFileSync(f.socketPath,'keep',{mode:0o600});await assert.rejects(publicBrowserSocketsStopped(f),/SOCKET_EXISTS/);assert.equal(fs.readFileSync(f.socketPath,'utf8'),'keep');fs.unlinkSync(f.socketPath);
 fs.symlinkSync(path.join(f.profileDir,'missing'),f.socketPath);await assert.rejects(publicBrowserSocketsStopped(f),/SOCKET_EXISTS/);assert.ok(fs.lstatSync(f.socketPath).isSymbolicLink());fs.unlinkSync(f.socketPath);
 fs.mkdirSync(f.socketPath,{mode:0o700});assert.throws(()=>inspectPublicBrowserSocket(f.socketPath,f),/SOCKET_EXISTS/);fs.rmdirSync(f.socketPath);
 const broker=await startPublicBrowserBroker({...f,execute:async()=>({})});fs.chmodSync(f.socketPath,0o666);await assert.rejects(publicBrowserSocketsStopped(f),/SOCKET_EXISTS/);assert.ok(fs.lstatSync(f.socketPath).isSocket());fs.chmodSync(f.socketPath,0o600);await broker.close();
});
test('foreign ownership metadata is rejected before connecting or deleting',async t=>{
 const f=fixture(t);ensurePublicBrowserRuntimeDirectory(f);assert.throws(()=>ensurePublicBrowserRuntimeDirectory({...f,uid:(process.getuid()+1)%65535}),/SOCKET_INVALID/);
 const lstat=fs.lstatSync;
 try{
  t.mock.method(fs,'lstatSync',(file,...args)=>{const st=lstat(file,...args);if(file===f.directory)st.uid=process.getuid()+1;return st;});
  assert.throws(()=>ensurePublicBrowserRuntimeDirectory(f),/SOCKET_PERMISSIONS/);
 }finally{t.mock.restoreAll();}
 fs.writeFileSync(f.socketPath,'preserved fixture',{mode:0o600});
 try{
  t.mock.method(fs,'lstatSync',(file,...args)=>{const st=lstat(file,...args);if(file===f.socketPath){st.uid=process.getuid()+1;st.mode=fs.constants.S_IFSOCK|0o600;}return st;});
  t.mock.method(net,'connect',()=>assert.fail('foreign owner must be rejected before connection'));
  t.mock.method(fs,'unlinkSync',()=>assert.fail('foreign object must never be removed'));
  await assert.rejects(publicBrowserSocketsStopped(f),/SOCKET_EXISTS/);
 }finally{t.mock.restoreAll();}
 assert.equal(fs.readFileSync(f.socketPath,'utf8'),'preserved fixture');
});
test('real foreign-owned runtime directory and socket are rejected',async t=>{
 const f=fixture(t);ensurePublicBrowserRuntimeDirectory(f);
 const original=fs.lstatSync(f.directory),foreignUID=original.uid===1?2:1;
 try{fs.chownSync(f.directory,foreignUID,original.gid);}
 catch(error){if(['EPERM','EACCES','EINVAL'].includes(error.code)){t.skip('Host cannot create a real foreign-owned fixture: '+error.code);return;}throw error;}
 try{assert.throws(()=>ensurePublicBrowserRuntimeDirectory(f),/SOCKET_PERMISSIONS/);}
 finally{fs.chownSync(f.directory,original.uid,original.gid);}
 await abandoned(f.socketPath);
 fs.chownSync(f.socketPath,foreignUID,original.gid);
 try{
  await assert.rejects(publicBrowserSocketsStopped(f),/SOCKET_EXISTS/);
  assert.equal(fs.lstatSync(f.socketPath).uid,foreignUID);
 }finally{fs.chownSync(f.socketPath,original.uid,original.gid);}
});
test('strict crash-left external and exact legacy sockets are automatically reclaimed after quiescence',async t=>{
 const f=fixture(t);ensurePublicBrowserRuntimeDirectory(f);await abandoned(f.socketPath);await abandoned(path.join(f.profileDir,'web.sock'));assert.equal(await publicBrowserSocketsStopped(f),true);assert.equal(fs.existsSync(f.socketPath),false);assert.equal(fs.existsSync(path.join(f.profileDir,'web.sock')),false);
});
test('an unexpected socket remains untouched by scoped runtime cleanup',async t=>{
 const f=fixture(t),unexpected=path.join(f.profileDir,'unrelated.sock');await abandoned(unexpected);assert.equal(await publicBrowserSocketsStopped(f),true);assert.ok(fs.lstatSync(unexpected).isSocket());await assert.rejects(reclaimPublicBrowserSocket(unexpected,{profileDir:f.profileDir,allowLegacy:true}),/SOCKET_INVALID/);assert.ok(fs.lstatSync(unexpected).isSocket());
});
test('socket hard-link aliases are rejected and neither pathname is removed',async t=>{
 const f=fixture(t);ensurePublicBrowserRuntimeDirectory(f);await abandoned(f.socketPath);const alias=path.join(f.directory,'alias.sock');fs.linkSync(f.socketPath,alias);assert.equal(fs.lstatSync(f.socketPath).nlink,2);assert.throws(()=>inspectPublicBrowserSocket(f.socketPath,f),/SOCKET_EXISTS/);await assert.rejects(publicBrowserSocketsStopped(f),/SOCKET_EXISTS/);assert.ok(fs.lstatSync(alias).isSocket());assert.ok(fs.lstatSync(f.socketPath).isSocket());
});
test('live exact legacy listener blocks stop confirmation and is never deleted',async t=>{
 const f=fixture(t),socketPath=path.join(f.profileDir,'web.sock'),server=net.createServer(socket=>socket.destroy());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});fs.chmodSync(socketPath,0o600);assert.equal(await publicBrowserSocketsStopped(f),false);assert.ok(fs.lstatSync(socketPath).isSocket());await new Promise(resolve=>server.close(resolve));assert.equal(await publicBrowserSocketsStopped(f),true);
});
test('broker close refuses a replacement file before native close can unlink it',async t=>{
 const f=fixture(t),broker=await startPublicBrowserBroker({...f,execute:async()=>({})});fs.unlinkSync(f.socketPath);fs.writeFileSync(f.socketPath,'preserve-replacement',{mode:0o600});await assert.rejects(broker.close(),/SOCKET_CHANGED/);assert.equal(fs.readFileSync(f.socketPath,'utf8'),'preserve-replacement');
});
test('socket disappearance during bounded shutdown probing confirms stopped without a false cleanup error',async t=>{
 const f=fixture(t);for(let i=0;i<5;i++){const broker=await startPublicBrowserBroker({...f,execute:async()=>({})}),stopping=publicBrowserSocketsStopped(f);await broker.close();assert.equal(await stopping,true);assert.equal(fs.existsSync(f.socketPath),false);}
});
test('worker session cleanup failure still closes broker and preserves primary failure',async t=>{
 const f=fixture(t),broker=await startPublicBrowserBroker({...f,execute:async()=>({})}),primary=Error('PUBLIC_WEB_CLEANUP_REQUIRED');await assert.rejects(ComputeWorker.prototype.close.call({publicWeb:{closeAll:async()=>{throw primary;}},publicBrowserBroker:broker}),error=>error===primary);assert.equal(fs.existsSync(f.socketPath),false);
});
test('aborted cleanup preserves a crash-left socket and reports cancellation',async t=>{
 const f=fixture(t);ensurePublicBrowserRuntimeDirectory(f);await abandoned(f.socketPath);const controller=new AbortController();controller.abort();await assert.rejects(publicBrowserSocketsStopped({...f,signal:controller.signal}),/SOCKET_CANCELLED/);assert.ok(fs.lstatSync(f.socketPath).isSocket());
});
