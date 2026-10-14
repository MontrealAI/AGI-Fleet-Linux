// Actual pinned OpenClaw loads the role skill and invokes the real supervisor.
// Model responses come from a declared local transport fixture: zero paid calls.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {LocalRuntime} from '../supervisor/runtime.mjs';
import {createServer} from '../supervisor/server.mjs';
import {provision} from '../clients/openclaw/provision.mjs';
import {task} from '../tests/helpers.mjs';
import {example} from '../examples.mjs';
import {defaultMission,executeMission} from '../../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';
import {verifyRuntimeArtifact} from '../../fleet/shared/runtime/compute/runtime-artifacts.mjs';
import {perform} from '../worker.mjs';

process.umask(0o077);
const binary=process.env.OPENCLAW_BIN;assert.ok(binary,'OPENCLAW_BIN must select the exact pinned installation.');
const verified=verifyRuntimeArtifact(fs.realpathSync(binary));assert.equal(verified.version,'2026.9.5');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-openclaw-local-')),state=path.join(dir,'supervisor');
const args=process.argv.slice(2),synthetic=args.includes('--synthetic-worker-boundary');
assert.ok(args.every(x=>x==='--synthetic-worker-boundary'||/^--role=(agent|node|moderator|employer|evidence|recovery)$/.test(x)));
assert.ok(args.filter(x=>x.startsWith('--role=')).length<=1);
const role=args.find(x=>x.startsWith('--role='))?.slice(7)||'agent';
const mission=defaultMission('website','en');
const inputTask=role==='agent'?task():role==='node'?{schema:'agi-fleet/local-task/v1',action:'successor-check',workspace:'files',input:{mission,variant:'improved',files:executeMission(mission,'improved').files},review:'internal',sourceActor:crypto.randomUUID(),sourceController:crypto.randomUUID()}:example(role);
const expected=await perform(role,inputTask);
const skill=fs.readFileSync(new URL('../../role-skills/agi-'+role+'/SKILL.md',import.meta.url),'utf8');
const skillBody=skill.slice(skill.indexOf('\n# ')+1).trim();
const runtime=new LocalRuntime(state,{create:true,...(synthetic?{backend:{inspect:()=>({supported:true,backend:'synthetic-boundary',identity:'synthetic-host'}),execute:async({role,task})=>({result:await perform(role,task),observation:{processGroupGone:true,evidenceClass:'synthetic; no OS isolation demonstrated'}})}}:{})}),server=createServer(runtime);
let gatewayToken='not-initialized';
let child,childDone,logs='',model,completed=0,phase='prepare',calls=0,prepared,runID,fixtureError,skillObserved=false;
const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:path.join(dir,'gateway-home'),OPENCLAW_STATE_DIR:path.join(dir,'gateway-state'),OPENCLAW_CONFIG_PATH:path.join(dir,'gateway.json'),OPENCLAW_SKIP_CHANNELS:'1',OPENCLAW_EXEC_SHELL_SNAPSHOT:'0'};
fs.mkdirSync(env.HOME);
try{
  const {url}=await server.start(),operator=runtime.issueClient().principal;
  const actor=runtime.addActor({role,name:'Pinned '+role+' assistant qualification'},operator);
  runtime.activate({actor:actor.id,confirm:true},operator);
  const scoped=runtime.issueClient(actor.id),tokenFile=path.join(dir,'actor-client.token');fs.writeFileSync(tokenFile,scoped.token,{mode:0o600});
  const clientConfig={actor:actor.id,role:actor.role,agentId:'fleet-'+actor.id,origin:url,tokenFile};
  model=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const b of req){raw+=b;assert.ok(raw.length<500_000);}
      const body=JSON.parse(raw);calls++;assert.ok(calls<=8,'Unbounded model loop');
      assert.deepEqual(body.tools.map(t=>t.function.name),['fleet_local'],'No shell, session or other tool may be offered');
      skillObserved ||= body.messages.some(m=>typeof m.content==='string'&&m.content.includes(skillBody));
      const toolMessage=[...body.messages].reverse().find(m=>m.role==='tool');
      const parameters=phase==='prepare'?{operation:'prepare',task:inputTask}:{operation:'run',grant:prepared.grant};
      const last=body.messages.at(-1);
      const returning=last?.role==='tool';
      if(returning){
        const text=typeof toolMessage.content==='string'?toolMessage.content:JSON.stringify(toolMessage.content);
        assert.ok(!text.includes(scoped.token)&&!text.includes(gatewayToken),'Credential in tool response');
        const value=JSON.parse(text).value;
        if(phase==='prepare'){assert.ok(value.grant);prepared=value;}
        else {assert.equal(value.state,'complete');assert.deepEqual(value.receipt.result,expected);assert.equal(value.receipt.independentReview,false);runID=value.run;completed++;}
      }
      const delta=returning?{role:'assistant',content:'Observed real runtime result. No independent review or payment claim.'}:{role:'assistant',content:null,tool_calls:[{index:0,id:'fleet-call-'+phase,type:'function',function:{name:'fleet_local',arguments:JSON.stringify(parameters)}}]};
      if(body.stream){
        res.writeHead(200,{'Content-Type':'text/event-stream'});
        for(const choices of [[{index:0,delta,finish_reason:null}],[{index:0,delta:{},finish_reason:returning?'stop':'tool_calls'}]])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'model',choices})+'\n\n');
        res.end('data: [DONE]\n\n');
      }else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'model',choices:[{index:0,message:delta,finish_reason:returning?'stop':'tool_calls'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));}
    }catch(e){fixtureError??=e;res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"QUALIFICATION_FIXTURE_FAILED"}');}
  });
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const provisioned=await provision({client:clientConfig,directory:path.join(dir,'fresh-client'),model:'fixture/model',port,openclaw:binary},{confirm:true});
  assert.equal(provisioned.started,false);assert.equal(provisioned.providerCalls,0);assert.equal(provisioned.inferenceQualified,false);
  Object.assign(env,provisioned.environment);
  const config=JSON.parse(fs.readFileSync(env.OPENCLAW_CONFIG_PATH,'utf8'));gatewayToken=config.gateway.auth.token;
  config.models={...config.models,mode:'replace',providers:{fixture:{baseUrl:'http://127.0.0.1:'+model.address().port+'/v1',apiKey:'declared-local-fixture',api:'openai-completions',models:[{id:'model',name:'Local qualification fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}};
  config.plugins.allow=['agi-fleet-local'];
  fs.writeFileSync(env.OPENCLAW_CONFIG_PATH,JSON.stringify(config),{mode:0o600});
  const validate=spawnSync(process.execPath,[binary,'config','validate'],{env,encoding:'utf8',timeout:60000});assert.equal(validate.status,0,validate.stderr+validate.stdout);
  child=spawn(process.execPath,[binary,'gateway','run','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});
  childDone=new Promise(resolve=>child.once('exit',resolve));
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{logs=(logs+b).slice(-24000);});
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let n=0;n<160;n++){assert.equal(child.exitCode,null,logs);try{const r=await fetch(base+'/v1/models',{signal:AbortSignal.timeout(500)});if(r.status===401){ready=true;await r.body?.cancel();break;}await r.body?.cancel();}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'Gateway did not become ready: '+logs);
  async function converse(){
    const r=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+gatewayToken,'Content-Type':'application/json'},body:JSON.stringify({model:'openclaw/'+clientConfig.agentId,user:'local-qualification-'+phase,messages:[{role:'user',content:phase==='prepare'?'Use the AGI '+role+' skill to prepare the supplied public task. Stop for separate operator authorization.':'Execute the exact grant separately authorized by the operator. Return the actual outcome.'}],stream:false}),signal:AbortSignal.timeout(90000)});
    const text=await r.text();if(fixtureError)throw fixtureError;assert.equal(r.status,200,text);return text;
  }
  await converse();assert.ok(prepared?.grant,'Assistant did not prepare work. '+logs);
  assert.equal(runtime.status(operator).runs.length,0,'Preparation cannot execute work');
  runtime.authorize({grant:prepared.grant,commitment:prepared.commitment,confirm:true},operator);phase='run';
  await converse();assert.equal(completed,1);assert.ok(skillObserved);
  const receipt=runtime.output({actor:actor.id,run:runID},operator);assert.equal(receipt.receipt.observation.processGroupGone,true);
  const evidence={schema:'agi-fleet/local-openclaw-observation/v1',role,actualGateway:true,openclaw:verified.version,inventorySha256:verified.packageInventorySha256,skillObserved,skillBodySHA256:crypto.createHash('sha256').update(skillBody).digest('hex'),actualRuntime:true,actualSandbox:!synthetic,evidenceClass:synthetic?'SYNTHETIC_WORKER_BOUNDARY':'NATIVE_LOCAL_RUNTIME',separateAuthorization:true,scopedActor:true,offeredTools:['fleet_local'],providerTransport:'local-synthetic-fixture',liveProviderJudgment:false,modelRequests:calls,outputSha256:receipt.receipt.outputSha256,files:receipt.receipt.result.files.map(f=>({name:f.name,sha256:crypto.createHash('sha256').update(f.content).digest('hex')})),independentReview:false,productionQualified:false};
  if(process.env.AGI_LOCAL_OPENCLAW_EVIDENCE)fs.writeFileSync(process.env.AGI_LOCAL_OPENCLAW_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}catch(e){console.error(logs.replaceAll(gatewayToken,'REDACTED'));throw e;}
finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([childDone,new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await childDone;}}
  server.server.closeAllConnections();if(server.server.listening)await new Promise(r=>server.server.close(r));
  if(model){model.closeAllConnections();await new Promise(r=>model.close(r));}
  runtime.close();fs.rmSync(dir,{recursive:true,force:true});
}
