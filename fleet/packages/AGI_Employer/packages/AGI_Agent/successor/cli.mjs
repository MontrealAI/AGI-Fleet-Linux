#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {fail,parseStrict} from './vendor/manager/site/assets/successor/safe.mjs';
import {REQUEST,compileRequest,inspectRequest,checkReturnedWork,prepareCustomProject} from './project.mjs';
import {inspectCapsule,compareCandidates,recordPlan,exportCapsule} from './vendor/manager/site/assets/successor/model.mjs';
import {SuccessorController} from './controller.mjs';
import {inspectSidecar,exportSidecar,restoreSidecar} from './sidecar.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [command,...args]=process.argv.slice(2);
const read=(name,max=6000000)=>{const fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);fail(s.isFile()&&s.nlink===1&&s.size<=max,'INPUT_FILE');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}};
const write=(name,value)=>fs.writeFileSync(name,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
async function studio(role='agent'){
  const app=fs.existsSync(path.join(root,'src/studio.mjs'))?root:path.join(root,'packages',role==='agent'?'AGI_Agent':'AGI_Node');
  return {...await import(pathToFileURL(path.join(app,'src/studio.mjs'))),...await import(pathToFileURL(path.join(app,'src/artifacts.mjs')))};
}
try{
  if(command==='request'&&args.length===3){const value={schema:REQUEST,capsule:read(args[0]),plan:parseStrict(read(args[1]))};const {state,inspected}=await inspectRequest(value);if(!state.plans.some(p=>p.commitment===value.plan.commitment))value.capsule=await exportCapsule(await recordPlan(state,value.plan),inspected.capsule.payload.sourceManifest);write(args[2],value);}
  else if(command==='compile-request'&&args.length===3)write(args[2],(await compileRequest(parseStrict(read(args[0]),6000000),parseStrict(read(args[1])))).compiled);
  else if(command==='inspect-request'&&args.length===1){const r=await inspectRequest(read(args[0]));console.log(JSON.stringify({project:r.project,revision:r.revision,requestSha256:r.requestSha256,goal:r.request.plan.goal,authority:'none'},null,2));}
  else if(command==='prepare-custom'&&args.length===4){
    const prepared=await prepareCustomProject(parseStrict(read(args[0])),parseStrict(read(args[1])),args[2]),destination=path.resolve(args[3]);
    fail(!fs.existsSync(destination),'OUTPUT_EXISTS');const temporary=fs.mkdtempSync(destination+'.partial-');
    try{for(const name of ['capsule','plan','mission','specification'])write(path.join(temporary,name+'.json'),prepared[name]);fail(!fs.existsSync(destination),'OUTPUT_EXISTS');fs.renameSync(temporary,destination);}catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
    console.log(JSON.stringify({directory:destination,authority:'none',next:'Review specification.json and import it into the existing public Studio. Separately authorize execution and review.'},null,2));
  }
  else if(command==='compare'&&args.length===2){const {capsule}=await inspectCapsule(read(args[0])),s=capsule.payload.state;const before=s.candidates.find(c=>c.id===s.active),after=s.candidates.find(c=>c.id===args[1]);fail(before&&after,'CANDIDATE_REQUIRED');console.log(JSON.stringify(compareCandidates(before,after),null,2));}
  else if(command==='check-result'&&args.length===4){const req=parseStrict(read(args[0]),6000000),agent=parseStrict(read(args[1],96000000),96000000),node=parseStrict(read(args[2],96000000),96000000);const checked=await checkReturnedWork(req,agent.handoff??agent,node.receipt??node,await studio());write(args[3],checked.capsule);const {capsule,...summary}=checked;console.log(JSON.stringify(summary,null,2));}
  else if(command==='inspect-pack'&&args.length===1)console.log(JSON.stringify(await inspectSidecar(args[0]),null,2));
  else if(command==='restore-pack'&&args.length>=2)console.log(JSON.stringify(await restoreSidecar(args[0],args[1],args[2]==='--confirm'),null,2));
  else if(command==='export-pack'&&args.length===4){const handoff=parseStrict(read(args[1],96000000),96000000),receipt=parseStrict(read(args[2],96000000),96000000);console.log(JSON.stringify(await exportSidecar(args[3],read(args[0]),handoff.handoff??handoff,receipt.receipt??receipt,await studio()),null,2));}
  else if(['execute','review','result','stop'].includes(command)){
    const [role,home,inputFile,contextFile]=args;fail(['agent','node'].includes(role)&&path.isAbsolute(home),'CLI_ROLE_HOME');
    fail(command==='execute'?role==='agent'&&args.length===5:command==='review'?role==='node'&&args.length===4:command==='result'?args.length===4:args.length===2,'CLI_ARGUMENTS');
    const destination=command==='execute'?args[4]:command==='stop'?null:args[3];
    if(destination){fail(!fs.existsSync(destination),'OUTPUT_EXISTS');fail(fs.statSync(path.dirname(path.resolve(destination))).isDirectory(),'OUTPUT_DIRECTORY');}
    const app=fs.existsSync(path.join(root,'src/control/controller.mjs'))?root:path.join(root,'packages',role==='agent'?'AGI_Agent':'AGI_Node');
    const {Controller}=await import(pathToFileURL(path.join(app,'src/control/controller.mjs'))),api=await studio(role);
    fail(process.stdin.isTTY,'CLI_INTERACTIVE_REQUIRED');
    // Share the launcher's exclusive profile lock. Never remove someone else's lock.
    const lock=path.join(home,'application.lock'),fd=fs.openSync(lock,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.fsyncSync(fd);
    let c;
    try{c=new Controller(home);}catch(error){fs.closeSync(fd);fs.unlinkSync(lock);throw error;}
    let muted=true;const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});const rl=createInterface({input:process.stdin,output,terminal:true});
    try{
      fail(process.stdin.isTTY,'CLI_INTERACTIVE_REQUIRED');
      process.stdout.write('Local vault password (hidden): ');
      const password=await rl.question('');muted=false;process.stdout.write('\n');await c.unlock(password);
      const bridge=new SuccessorController(c,role,api);
      if(command==='stop'){console.log(await bridge.stop());}
      else if(command==='result'){write(destination,await bridge.result(inputFile));console.log(JSON.stringify({key:inputFile,file:destination,authority:'none'}));}
      else {const input=parseStrict(read(inputFile,96000000),96000000);const proposal=await bridge.prepare(role==='agent'?{request:input,context:parseStrict(read(contextFile))}:{handoff:input.handoff??input},'local-terminal');const {ticket,...view}=proposal;console.log(JSON.stringify(view,null,2));
        fail(await rl.question('Type the complete specification SHA-256 to authorize this one attempt: ')===proposal.specificationSha256,'FLEET_CONFIRM_REQUIRED');
        const r=await c.mutate('SUCCESSOR bounded work',()=>bridge.execute({ticket,key:proposal.key,confirm:true},'local-terminal'));console.log(JSON.stringify({key:r.key,run:r.run.id}));await c.studio.task;write(destination,await bridge.result(r.key));console.log(JSON.stringify({key:r.key,file:destination,authority:'none'}));}
    }finally{rl.close();try{await c.close();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}}
  }else{
    const result=spawnSync(process.execPath,[path.join(root,'successor/vendor/manager/scripts/successor/cli.mjs'),command??'--help',...args],{stdio:'inherit'});process.exitCode=result.status??1;
    if(!command||command==='--help')console.log('\nFleet additions:\nprepare-custom MISSION_JSON SPEC_JSON USDC_BUDGET NEW_DIRECTORY\nrequest CAPSULE PLAN NEW_REQUEST\ninspect-request REQUEST\ncompile-request REQUEST CONTEXT NEW_OUTPUT\nexecute agent ABSOLUTE_PROFILE REQUEST CONTEXT NEW_AGENT_RESULT\nreview node ABSOLUTE_PROFILE AGENT_RESULT NEW_NODE_RESULT\nresult agent|node ABSOLUTE_PROFILE ATTEMPT_KEY NEW_RESULT\ncheck-result REQUEST AGENT_RESULT NODE_RESULT NEW_CAPSULE\ncompare CAPSULE CANDIDATE_HASH\nstop agent|node ABSOLUTE_PROFILE\nexport-pack CAPSULE HANDOFF_OR_AGENT_RESULT RECEIPT_OR_NODE_RESULT NEW_DIRECTORY\ninspect-pack DIRECTORY\nrestore-pack DIRECTORY NEW_DIRECTORY [--confirm]\nExecution requires local terminal confirmation and an unlocked existing vault. Never run two Controllers over one profile.');
  }
}catch(error){console.error(JSON.stringify({code:error.code||error.message,authority:'none'}));process.exitCode=1;}
