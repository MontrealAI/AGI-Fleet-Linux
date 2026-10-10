import {sandboxScopeKey} from './sandbox-scope.mjs';
import {performance} from 'node:perf_hooks';
import {runDiagnosticCommand} from './cli-process.mjs';
import {beginCleanupEvidence,finishCleanupEvidence} from './cleanup-evidence.mjs';

const fail=code=>Object.assign(Error(code),{code});
const idPattern=/^[a-f0-9]{64}$/;
const scopePattern=/^agent:(agi-creator|agi-reviewer):agi-work-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const unavailable=()=>({status:'UNAVAILABLE',containerIDs:[]});
export async function inventorySessionContainers(c,sessionKey,target){
  if(!/^agent:(agi-creator|agi-reviewer):agi-work-[a-f0-9-]{36}:workspace:[a-f0-9]{32}$/.test(sessionKey)||!['base','browser'].includes(target))return unavailable();
  try{
    const result=await runDiagnosticCommand(c,c.docker,['ps','-a','--no-trunc','--filter','label=openclaw.sandbox=1','--filter',`label=openclaw.sessionKey=${sessionKey}`,'--format','{{.ID}}\t{{.Label "openclaw.sandboxBrowser"}}'],{timeoutMs:5000});
    const lines=result.stdout.trimEnd()?result.stdout.trimEnd().split('\n'):[];
    if(lines.length>32)return unavailable();
    const objects=lines.map(line=>{const [id,browser,...rest]=line.replace(/\r$/,'').split('\t');if(!idPattern.test(id)||rest.length||!['','1',undefined].includes(browser))throw fail('COMPUTE_CLEANUP_INVENTORY_FAILED');return {id,browser:browser==='1'};});
    if(new Set(objects.map(x=>x.id)).size!==objects.length)return unavailable();
    return {status:'CAPTURED',containerIDs:objects.filter(x=>x.browser===(target==='browser')).map(x=>x.id).sort()};
  }catch{return unavailable();}
}
function inventoryValue(value){
  if(value?.status!=='CAPTURED'||!Array.isArray(value.containerIDs)||value.containerIDs.length>32||!value.containerIDs.every(x=>idPattern.test(x))||new Set(value.containerIDs).size!==value.containerIDs.length)return unavailable();
  return {status:'CAPTURED',containerIDs:[...value.containerIDs].sort()};
}
function metadata(result){return {exitStatus:result?.exitStatus??null,signal:result?.signal??null,elapsedMs:result?.elapsedMs??null,timeoutMs:30000,timedOut:result?.timedOut===true,started:result?.started??null,processTerminationConfirmed:result?.processTerminationConfirmed??null};}
function contain(worker,requestId){try{worker.stopForCleanup({requestId});return 'PRESENT';}catch{return 'WRITE_FAILED';}}
function context(agent,sessionId,{phase='post-run',trigger='finalize'}={}){
  const scope=scopePattern.exec(sessionId);
  if(!scope||scope[1]!==agent)throw fail('COMPUTE_CLEANUP_SCOPE_REQUIRED');
  return {requestId:scope[2],sessionId,agent,phase,trigger};
}
export async function cleanupSandboxTargets(worker,agent,sessionKey,options={}){
  const scope=context(agent,sessionKey,options),targets=worker.c.workstation?['base','browser']:['base'];
  if(worker.cleanupBusy){contain(worker,scope.requestId);throw fail('COMPUTE_SANDBOX_CLEANUP_FAILED');}
  if(worker.cleanupTerminationUnconfirmed){
    const stopMarker=contain(worker,scope.requestId);
    for(const target of targets)try{const attempt=beginCleanupEvidence(worker.c,{...scope,stage:'sandbox-recreate',target});finishCleanupEvidence(worker.c,attempt,{result:'NOT_RUN',commandResult:'NOT_RUN',postcondition:'UNKNOWN',processTerminationConfirmed:false,failureCode:'COMPUTE_CLI_TERMINATION_UNCONFIRMED',stopReason:'COMPUTE_SANDBOX_CLEANUP_FAILED',stopMarker});}catch{}
    throw fail('COMPUTE_SANDBOX_CLEANUP_FAILED');
  }
  worker.cleanupBusy=true;
  try{
    for(let index=0;index<targets.length;index++){
      const target=targets[index];let attempt,command,problem,before=unavailable(),after=unavailable(),commandResult='NOT_RUN',postcondition='NOT_RUN';
      try{
        let resolvedScope,scopeError;try{resolvedScope=sandboxScopeKey(worker.c,sessionKey);}catch(error){scopeError=error;}
        attempt=beginCleanupEvidence(worker.c,{...scope,...(resolvedScope?{sandboxScopeKey:resolvedScope}:{}),stage:'sandbox-recreate',target});
        if(scopeError)throw scopeError;
        before=inventoryValue(await worker.cleanupInventory(worker.c,resolvedScope,target));
        if(before.status!=='CAPTURED')throw fail('COMPUTE_CLEANUP_INVENTORY_FAILED');
        try{
          command=await worker.cli(worker.c,['sandbox','recreate','--session',resolvedScope,'--force',...(target==='browser'?['--browser']:[])],AbortSignal.timeout(30000),{timeoutMs:30000});
          if(command?.processTerminationConfirmed===false)worker.cleanupTerminationUnconfirmed=true;
          if(command?.ok!==true||command.exitStatus!==0||command.signal!==null||command.started!==true||command.timedOut!==false||command.processTerminationConfirmed!==true)throw Object.assign(fail('COMPUTE_SANDBOX_CLEANUP_FAILED'),metadata(command));
          commandResult='PASS';
        }catch(error){command=error;commandResult='FAIL';problem=error;if(error?.processTerminationConfirmed===false)worker.cleanupTerminationUnconfirmed=true;}
        // Never overlap another observation/cleanup with an unconfirmed process shutdown.
        if(command?.processTerminationConfirmed!==false){after=inventoryValue(await worker.cleanupInventory(worker.c,resolvedScope,target));postcondition=after.status!=='CAPTURED'?'UNKNOWN':after.containerIDs.length?'FAIL':'PASS';}
        else postcondition='UNKNOWN';
        if(problem)throw problem;
        if(postcondition!=='PASS')throw fail(after.status!=='CAPTURED'?'COMPUTE_CLEANUP_INVENTORY_FAILED':'COMPUTE_CLEANUP_POSTCONDITION_FAILED');
        finishCleanupEvidence(worker.c,attempt,{result:'PASS',commandResult,postcondition,...metadata(command),dockerBefore:before,dockerAfter:after,stopMarker:'NOT_REQUIRED'});
      }catch(error){
        const stopMarker=contain(worker,scope.requestId);
        if(attempt)try{finishCleanupEvidence(worker.c,attempt,{result:'FAIL',commandResult,postcondition,...metadata(command),failureCode:error?.code??error?.message,dockerBefore:before,dockerAfter:after,stopReason:'COMPUTE_SANDBOX_CLEANUP_FAILED',stopMarker});}catch{}
        for(const skipped of targets.slice(index+1))try{const pending=beginCleanupEvidence(worker.c,{...scope,stage:'sandbox-recreate',target:skipped});finishCleanupEvidence(worker.c,pending,{result:'NOT_RUN',commandResult:'NOT_RUN',postcondition:'NOT_RUN',failureCode:'COMPUTE_SANDBOX_CLEANUP_FAILED',stopReason:'COMPUTE_SANDBOX_CLEANUP_FAILED',stopMarker});}catch{}
        throw fail('COMPUTE_SANDBOX_CLEANUP_FAILED');
      }
    }
  }finally{worker.cleanupBusy=false;}
}
export async function recordFinalization(worker,agent,sessionKey,stage,operation){
  const scope=context(agent,sessionKey,{phase:'post-run',trigger:'finalize'}),target=stage==='observer-finalize'?'observer':'workspace';
  let attempt;const started=performance.now();
  try{
    try{attempt=beginCleanupEvidence(worker.c,{...scope,stage,target});}catch(error){
      contain(worker,scope.requestId);
      // The observer must still be stopped if durable evidence cannot be written.
      // Workspaces remain quarantined in that case.
      if(stage==='observer-finalize')try{await operation();}catch{}
      throw error;
    }
    const value=await operation();
    finishCleanupEvidence(worker.c,attempt,{result:'PASS',commandResult:'NOT_RUN',postcondition:'PASS',elapsedMs:Math.round(performance.now()-started),stopMarker:'NOT_REQUIRED'});
    return value;
  }catch(error){
    const stopMarker=contain(worker,scope.requestId);
    if(attempt)try{finishCleanupEvidence(worker.c,attempt,{result:'FAIL',commandResult:'NOT_RUN',postcondition:'UNKNOWN',elapsedMs:Math.round(performance.now()-started),failureCode:stage==='observer-finalize'?'COMPUTE_OBSERVER_FINALIZE_FAILED':'COMPUTE_WORKSPACE_REMOVE_FAILED',stopReason:'COMPUTE_SANDBOX_CLEANUP_FAILED',stopMarker});}catch{}
    throw fail('COMPUTE_SANDBOX_CLEANUP_FAILED');
  }
}
