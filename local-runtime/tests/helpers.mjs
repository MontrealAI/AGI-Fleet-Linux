import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalRuntime} from '../supervisor/runtime.mjs';
import {perform} from '../worker.mjs';
import {defaultMission} from '../../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';

export const task=(language='en')=>({schema:'agi-fleet/local-task/v1',action:'successor-run',workspace:'files',input:{mission:defaultMission('analyst',language),variant:'improved'},review:'none',sourceActor:null,sourceController:null});
export function fixture(options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-local-test-'));fs.chmodSync(directory,0o700);
  let now=Date.now();
  const backend={inspect:()=>({supported:true,backend:'synthetic-boundary',identity:'synthetic-host'}),execute:async({role,task})=>({result:await perform(role,task),observation:{processGroupGone:true,evidenceClass:'synthetic; no OS isolation demonstrated'}}),...options};
  const runtime=new LocalRuntime(directory,{create:true,backend,now:()=>now}),operator=runtime.issueClient().principal;
  const create=(role='agent')=>{const actor=runtime.addActor({role,name:'Public '+role},operator);return runtime.activate({actor:actor.id,confirm:true},operator);};
  const prepare=(actor,input=task(),principal=operator)=>runtime.prepare({actor:actor.id,task:input},principal);
  const authorize=g=>runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},operator);
  const run=(actor,g,p=operator)=>runtime.run({actor:actor.id,grant:g.grant},p);
  return {directory,runtime,operator,create,prepare,authorize,run,backend,advance:ms=>now+=ms,close:()=>{runtime.close();fs.rmSync(directory,{recursive:true,force:true});}};
}
