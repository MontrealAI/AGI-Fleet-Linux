import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {need,keys,parseStrict,canonical,ROOT} from '../../contracts.mjs';
import {readPrivate} from '../../private-file.mjs';
import {invoke,configuration} from './client.mjs';
import {profile,writeInstructions} from './profile.mjs';
import {verifyRuntimeArtifact} from '../../../fleet/shared/runtime/compute/runtime-artifacts.mjs';

export async function provision(input,{confirm=false}={}){
  need(confirm===true,'CONFIRM_REQUIRED');
  keys(input,['client','directory','model','port','openclaw']);
  const original=configuration(input.client);
  await invoke(input.client,{operation:'inspect'}); // Scope and role are checked server-side.
  const directory=path.resolve(input.directory);
  need(directory===input.directory&&!directory.startsWith(ROOT)&&!fs.existsSync(directory),'FRESH_ASSISTANT_DIRECTORY_REQUIRED');
  need(fs.realpathSync(path.dirname(directory))===path.dirname(directory),'CLIENT_DIRECTORY_ALIAS');
  need(path.isAbsolute(input.openclaw),'CLIENT_OPENCLAW_REQUIRED');
  const binary=fs.realpathSync(input.openclaw),artifact=verifyRuntimeArtifact(binary);
  need(artifact.version==='2026.9.5','CLIENT_OPENCLAW_VERSION');
  const staged=fs.mkdtempSync(path.join(path.dirname(directory),'.fleet-assistant-'));fs.chmodSync(staged,0o700);
  fs.mkdirSync(directory,{mode:0o700});
  try{
    const workspace=path.join(staged,'workspace');fs.mkdirSync(workspace,{mode:0o700});
    fs.mkdirSync(path.join(staged,'home'),{mode:0o700});
    fs.writeFileSync(path.join(staged,'actor.token'),original.token+'\n',{mode:0o600,flag:'wx'});
    writeInstructions(workspace,original.role);
    const config=profile({...input.client,tokenFile:path.join(staged,'actor.token')},{workspace,model:input.model,port:input.port,gatewayToken:crypto.randomBytes(32).toString('hex')});
    config.agents.entries[input.client.agentId].workspace=path.join(directory,'workspace');
    config.plugins.entries['agi-fleet-local'].config.tokenFile=path.join(directory,'actor.token');
    fs.writeFileSync(path.join(staged,'openclaw.json'),canonical(config)+'\n',{flag:'wx',mode:0o600});
    const receipt={schema:'agi-fleet/local-assistant-profile/v1',actor:input.client.actor,role:input.client.role,agentId:input.client.agentId,model:input.model,
      execution:'Fleet local supervisor; scoped actor only',inference:'Selected model route; availability, egress and costs require separate commissioning',
      inferenceQualified:false,providerCalls:0,started:false,providerCredentialsImported:false,scopedClientCopied:true,authority:'scoped-client-only',productionQualified:false,
      node:process.execPath,openclaw:binary,openclawVersion:artifact.version,openclawInventorySha256:artifact.packageInventorySha256,
      environment:{HOME:path.join(directory,'home'),OPENCLAW_STATE_DIR:path.join(directory,'gateway-state'),OPENCLAW_CONFIG_PATH:path.join(directory,'openclaw.json'),OPENCLAW_EXEC_SHELL_SNAPSHOT:'0',DO_NOT_TRACK:'1'},
      command:[process.execPath,binary,'gateway','run','--port',String(input.port)]};
    fs.writeFileSync(path.join(staged,'profile.json'),canonical(receipt)+'\n',{flag:'wx',mode:0o600});
    for(const file of ['actor.token','openclaw.json','profile.json','workspace/AGENTS.md']){const fd=fs.openSync(path.join(staged,file),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
    fs.renameSync(staged,directory);
    return {...receipt,directory,operatorAction:'Inspect this fresh profile and separately commission the selected inference route before running an assistant.'};
  }catch(e){fs.rmSync(staged,{recursive:true,force:true});if(fs.existsSync(directory)&&fs.readdirSync(directory).length===0)fs.rmdirSync(directory);throw e;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  process.umask(0o077);
  try{need(process.argv.length===4&&process.argv[3]==='--confirm','USAGE_PRIVATE_SETUP_JSON_CONFIRM');const input=parseStrict(readPrivate(path.resolve(process.argv[2]),100_000).toString());console.log(JSON.stringify(await provision(input,{confirm:true}),null,2));}
  catch(e){console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(e.code||e.message)?e.code||e.message:'ASSISTANT_PROVISION_FAILED'}));process.exitCode=1;}
}
