import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {need} from '../contracts.mjs';
import {privateDirectory} from './store.mjs';
import {LocalRuntime} from './runtime.mjs';

export async function recoverService(state,{confirm=false}={}) {
  need(confirm===true,'CONFIRM_REQUIRED');privateDirectory(state);
  const socket=path.join(state,'control.sock');
  let before=null;
  try {before=fs.lstatSync(socket);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(before){
    need(before.isSocket()&&before.uid===process.getuid()&&!(before.mode&0o077)&&before.nlink===1,'SOCKET_OWNERSHIP_UNKNOWN');
    const stopped=await new Promise((resolve,reject)=>{
      const probe=net.connect({path:socket});
      probe.once('connect',()=>{probe.destroy();resolve(false);});
      probe.once('error',e=>{if(e.code==='ECONNREFUSED')resolve(true);else reject(Object.assign(Error('SOCKET_STATE_UNCERTAIN'),{code:'SOCKET_STATE_UNCERTAIN'}));});
      probe.setTimeout(1000,()=>probe.destroy(Object.assign(Error('SOCKET_STATE_UNCERTAIN'),{code:'SOCKET_STATE_UNCERTAIN'})));
    });
    need(stopped,'SUPERVISOR_STILL_ACTIVE');
  }
  if(before){
    const current=fs.lstatSync(socket);
    need(current.isSocket()&&current.dev===before.dev&&current.ino===before.ino&&current.uid===before.uid&&current.mode===before.mode,'SOCKET_IDENTITY_CHANGED');
    fs.unlinkSync(socket);
  }
  // Own the actual service endpoint before touching authority. If a raw CLI
  // launch wins this bind, recovery fails without changing its live ledger.
  // A crash leaves an ordinary stale private socket for the same recovery path.
  const fence=net.createServer(connection=>connection.destroy());
  let runtime;
  try {
    await new Promise((resolve,reject)=>{fence.once('error',reject);fence.listen(socket,resolve);});
    fs.chmodSync(socket,0o600);
    runtime=new LocalRuntime(state);
    runtime.store.recover({forceStop:true});
    return {schema:'agi-fleet/service-recovery/v1',state:'STOP',unusedGrants:'revoked',interruptedRuns:'uncertain',actors:'inactive',
      replayAllowed:false,next:'Start the supervisor, inspect and reconcile uncertain runs, then explicitly resume and reactivate.'};
  }finally{
    try{runtime?.close();}
    finally{if(fence.listening)await new Promise(resolve=>fence.close(resolve));}
  }
}
