import {spawn} from 'node:child_process';

export async function stopFixtureChild(child,{signal='SIGTERM',graceMs=500,killMs=1000}={}){
  if(child.exitCode!==null||child.signalCode!==null)return;
  let closed=false;
  const onClose=()=>{closed=true;};
  child.once('close',onClose);
  const wait=async ms=>{
    const end=Date.now()+ms;
    while(!closed&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));
    return closed;
  };
  try{
    child.kill(signal);
    if(await wait(graceMs))return;
    child.kill('SIGKILL');
    if(!await wait(killMs))throw Error('FIXTURE_CHILD_TERMINATION_UNCONFIRMED');
  }finally{child.removeListener('close',onClose);}
}

export async function startFixtureChild(executable,args,{ready='ready',timeoutMs=2000,...options}={}){
  const child=spawn(executable,args,{...options,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{
      let output='',bytes=0;
      const finish=error=>{
        clearTimeout(timer);
        child.stdout.removeListener('data',onData);
        child.removeListener('error',onError);
        child.removeListener('close',onClose);
        error?reject(error):resolve();
      };
      const onData=chunk=>{
        bytes+=chunk.length;
        if(bytes>65536)return finish(Error('FIXTURE_CHILD_OUTPUT_LIMIT'));
        output+=chunk.toString();
        if(output.includes(ready))finish();
      };
      const onError=error=>finish(Object.assign(Error('FIXTURE_CHILD_SPAWN_FAILED'),{cause:error}));
      const onClose=(code,signal)=>finish(Object.assign(Error('FIXTURE_CHILD_EXITED_BEFORE_READY'),{exitCode:code,signal}));
      const timer=setTimeout(()=>finish(Error('FIXTURE_CHILD_READY_TIMEOUT')),timeoutMs);
      child.stdout.on('data',onData);
      child.stderr.resume();
      child.once('error',onError);
      child.once('close',onClose);
    });
    return child;
  }catch(error){
    try{await stopFixtureChild(child);}catch(cleanup){error.cleanupFailure=cleanup.message;}
    throw error;
  }
}
