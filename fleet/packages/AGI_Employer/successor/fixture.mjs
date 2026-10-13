// Explicit engineering fixture: real Fleet controllers/compute; simulated provider and sandbox CLI.
// No installed Docker, provider access, independent controller or physical qualification is claimed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {executeMission} from './vendor/manager/site/assets/successor/missions.mjs';
import {checkArtifacts} from './vendor/manager/site/assets/successor/checker.mjs';
import {SuccessorController} from './controller.mjs';
export async function fixture(root,role='agent',options={}){
  const app=path.join(root,'packages',role==='agent'?'AGI_Agent':'AGI_Node'),load=file=>import(pathToFileURL(path.join(app,file)));
  const {Controller}=await load('src/control/controller.mjs'),{ComputeWorker}=await load('compute/server.mjs'),{computeProfile}=await load('compute/profile.mjs'),{runtimeManifest}=await load('compute/runtime.mjs'),{sandboxWorkspaceRoot}=await load('compute/sandbox-scope.mjs');
  const api={...await load('src/studio.mjs'),...await load('src/artifacts.mjs')};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-successor-fixture-'));let clock=Date.now(),workspace;
  const c={role,workstation:true,profileDir:path.join(dir,'compute'),workspace:dir,jobRoot:path.join(dir,'jobs'),inputRoot:path.join(dir,'inputs'),maxRuns24h:48,maxImages24h:0,gatewayConfig:path.join(dir,'gateway.json'),policyHash:'a'.repeat(64),imageID:'sha256:'+'b'.repeat(64),browserImageID:'sha256:'+'c'.repeat(64)};
  for(const d of [c.profileDir,c.jobRoot,c.inputRoot])fs.mkdirSync(d,{mode:0o700});
  fs.writeFileSync(c.gatewayConfig,JSON.stringify(computeProfile({token:'a'.repeat(64),port:18896,model:'openai/gpt-6-astra',workspace:dir,imageID:c.imageID,browserImageID:c.browserImageID,jobRoot:c.jobRoot,inputRoot:c.inputRoot,workstation:true,role})));
  const worker=new ComputeWorker(c,{verifyPolicy:false,now:()=>clock,cleanupInventory:async()=>({status:'CAPTURED',containerIDs:[]}),cli:async(config,args)=>{
    if(args[1]==='recreate')return {ok:true,exitStatus:0,signal:null,elapsedMs:1,timeoutMs:30000,timedOut:false,started:true,processTerminationConfirmed:true};
    const agent=args[args.indexOf('--agent')+1],key=args[args.indexOf('--session')+1];workspace=sandboxWorkspaceRoot(config,key);return {agentId:agent,sandbox:{scope:'session',workspaceAccess:'none',sessionIsSandboxed:true,backend:'docker',effectiveHostWorkspaceRoot:workspace}};
  }});
  const inputs=new Map();worker.inputReader={read:async uri=>{const name=new URL(uri).pathname.split('/').at(-1);if(!inputs.has(name))throw Error('FIXTURE_INPUT_MISSING');return {bytes:inputs.get(name)};}};
  worker.chat=async(agent,prompt,data)=>{
    const mission=JSON.parse(fs.readFileSync(path.join(c.inputRoot,'inputs/mission.json'),'utf8')),spec=data.specification;
    if(agent==='agi-creator'){
      const output=executeMission(mission,options.bad?'baseline':'improved');
      if(options.browser)await options.browser({mission,output,workspace});
      for(const file of output.files)fs.writeFileSync(path.join(workspace,'deliverables',file.name),file.content);
      fs.writeFileSync(path.join(workspace,'deliverables/checker-results.json'),JSON.stringify(checkArtifacts(mission,'improved',output.files)));
      return JSON.stringify({status:'complete',content:'files-ready'});
    }
    const delivered=spec.outputs.filter(f=>f.name!=='checker-results.json').map(f=>({name:f.name,mediaType:f.mediaType,content:fs.readFileSync(path.join(c.inputRoot,'delivery',f.name),'utf8')}));
    const checked=checkArtifacts(mission,'improved',delivered);
    return JSON.stringify({safeToReview:true,checks:spec.criteria.map(criterion=>({id:criterion.id,status:checked.passed?'pass':'fail',method:'Separate deterministic checker reopens immutable inputs and actual delivered bytes.',observed:checked.passed?'Every local checker condition passed.':'A deterministic checker condition failed.',files:criterion.evidence}))});
  };
  const health=()=>({protocol:'agi-compute/v2',role,uid:(process.getuid?.()??0)+1,auth:'chatgpt-oauth',policyCurrent:true,configuredCapabilities:['desktop','files','code'],capabilities:['desktop','files','code','computer-review','revision'],policyHash:c.policyHash,gatewayReady:true,stopped:worker.cleanupBlocked(),runtime:runtimeManifest(c),qualification:{production:'NOT_TESTED'}});
  const controller=new Controller(path.join(dir,'signer'),{companion:{now:()=>clock,fetchImpl:async(url,init={})=>{
    if(new URL(url).pathname==='/health')return Response.json(health());
    const kind=init.headers['x-agi-kind'],input=JSON.parse(JSON.parse(init.body).messages.at(-1).content);
    try{const value=await worker.execute(kind,input,{id:init.headers['x-agi-request-id']??crypto.randomUUID(),signal:init.signal});clock+=31000;return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});}
    catch(e){return Response.json({error:{message:e.code||e.message}},{status:400});}
  }}});
  await controller.createVault('Synthetic fixture password 123!');controller.vault.set({openclawToken:'a'.repeat(64)});
  controller.companion.config={...controller.companion.config,mode:'workstation',enabled:true,acknowledged:true,timeoutMs:720000};controller.companion.state.testedAt=clock;controller.companion.state.computePolicy=c.policyHash;controller.companion.save();controller.companion.persist();
  const bridge=new SuccessorController(controller,role,api);
  return {dir,c,controller,worker,bridge,api,inputs,health,advance:ms=>{clock+=ms;},close:async()=>{await controller.close();await worker.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
