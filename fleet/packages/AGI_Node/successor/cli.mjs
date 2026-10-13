#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {fail,parseStrict} from './vendor/manager/site/assets/successor/safe.mjs';
import {compileRequest,inspectRequest} from './project.mjs';
import {SuccessorController} from './controller.mjs';
import {inspectSidecar,exportSidecar,restoreSidecar} from './sidecar.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [command,...args]=process.argv.slice(2);
const read=(name,max=6000000)=>{const fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);fail(s.isFile()&&s.nlink===1&&s.size<=max,'INPUT_FILE');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}};
const write=(name,value)=>fs.writeFileSync(name,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
try{
  if(command==='compile-request'&&args.length===3)write(args[2],(await compileRequest(parseStrict(read(args[0]),6000000),parseStrict(read(args[1])))).compiled);
  else if(command==='inspect-request'&&args.length===1){const r=await inspectRequest(read(args[0]));console.log(JSON.stringify({project:r.project,revision:r.revision,requestSha256:r.requestSha256,goal:r.request.plan.goal,authority:'none'},null,2));}
  else if(command==='inspect-pack'&&args.length===1)console.log(JSON.stringify(inspectSidecar(args[0]),null,2));
  else if(command==='restore-pack'&&args.length>=2)console.log(JSON.stringify(await restoreSidecar(args[0],args[1],args[2]==='--confirm'),null,2));
  else if(command==='export-pack'&&args.length===4){const app=fs.existsSync(path.join(root,'src/studio.mjs'))?root:path.join(root,'packages/AGI_Agent');const api=await import(pathToFileURL(path.join(app,'src/studio.mjs')));const artifacts=await import(pathToFileURL(path.join(app,'src/artifacts.mjs')));console.log(JSON.stringify(await exportSidecar(args[3],read(args[0]),parseStrict(read(args[1],96000000),96000000),parseStrict(read(args[2])),{...api,...artifacts}),null,2));}
  else if(['execute','review','stop'].includes(command)){
    const [role,home,inputFile,contextFile]=args;fail(['agent','node'].includes(role)&&path.isAbsolute(home),'CLI_ROLE_HOME');
    const app=fs.existsSync(path.join(root,'src/control/controller.mjs'))?root:path.join(root,'packages',role==='agent'?'AGI_Agent':'AGI_Node');
    const {Controller}=await import(pathToFileURL(path.join(app,'src/control/controller.mjs'))),api=await import(pathToFileURL(path.join(app,'src/studio.mjs'))),artifacts=await import(pathToFileURL(path.join(app,'src/artifacts.mjs')));
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
      const bridge=new SuccessorController(c,role,{...api,...artifacts});
      if(command==='stop'){console.log(await bridge.stop());}
      else {const input=parseStrict(read(inputFile,96000000),96000000);const proposal=await bridge.prepare(role==='agent'?{request:input,context:parseStrict(read(contextFile))}:{handoff:input.handoff??input},'local-terminal');const {ticket,...view}=proposal;console.log(JSON.stringify(view,null,2));
        fail(await rl.question('Type the complete specification SHA-256 to authorize this one attempt: ')===proposal.specificationSha256,'FLEET_CONFIRM_REQUIRED');
        const r=await c.mutate('SUCCESSOR bounded work',()=>bridge.execute({ticket,key:proposal.key,confirm:true},'local-terminal'));await c.studio.task;console.log(JSON.stringify({key:r.key,run:c.studio.export(r.run.id,'receipt')},null,2));}
    }finally{rl.close();try{await c.close();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}}
  }else{
    const result=spawnSync(process.execPath,[path.join(root,'successor/vendor/manager/scripts/successor/cli.mjs'),command??'--help',...args],{stdio:'inherit'});process.exitCode=result.status??1;
    if(!command||command==='--help')console.log('\nFleet additions:\ninspect-request REQUEST\ncompile-request REQUEST CONTEXT NEW_OUTPUT\nexecute agent ABSOLUTE_PROFILE REQUEST CONTEXT\nreview node ABSOLUTE_PROFILE HANDOFF\nstop agent|node ABSOLUTE_PROFILE\nexport-pack CAPSULE HANDOFF RECEIPT NEW_DIRECTORY\ninspect-pack DIRECTORY\nrestore-pack DIRECTORY NEW_DIRECTORY [--confirm]\nUse the installed application for authenticated GUI dispatch and receipt import. Never run two Controllers over one profile.');
  }
}catch(error){console.error(JSON.stringify({code:error.code||error.message,authority:'none'}));process.exitCode=1;}
