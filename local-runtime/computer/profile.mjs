// SPDX-License-Identifier: MIT
// Owner-installed control configuration; imported tasks cannot select code, tools or providers.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {need,keys,digest,canonical,parseStrict} from '../contracts.mjs';
import {readPrivate} from '../private-file.mjs';
import {decodeUTF8} from '../primitives.mjs';
import {publicOnly} from '../../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';

export const ALPHA_COMPUTER_SOURCE=Object.freeze({commit:'7cf97aa3b36354b9ae5ab72e70aa88364a910313',tree:'8ff159a8f91db5fb4363cc736aeb66e7eefc07ea'});
export const LAUNCHER=fileURLToPath(new URL('./launcher.py',import.meta.url));
export const COMPUTER_LIMITS=Object.freeze({wallMs:150000,maxSeconds:120,maxActions:30,maxTurns:10,
  handoffBytes:1_000_000,artifactBytes:2_000_000,artifactTotalBytes:80_000_000,historyBytes:320_000_000});
const ENV=Object.freeze({PATH:'/usr/bin:/bin',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'});
export const computerEnvironment=()=>({...ENV});
export function computerInvocation(profile,mode){
  const cache=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-computer-cache-'));fs.chmodSync(cache,0o700);
  return {executable:profile.python,args:['-I','-S','-B','-X','pycache_prefix='+cache,LAUNCHER,mode],close:()=>fs.rmSync(cache,{recursive:true,force:true})};
}
function fileHash(file,maximum=32_000_000){
  need(path.isAbsolute(file)&&fs.realpathSync(file)===file,'COMPUTER_RUNTIME_PATH');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const stat=fs.fstatSync(fd);need(stat.isFile()&&(stat.uid===0||stat.uid===process.getuid())&&!(stat.mode&0o022)&&stat.size<=maximum,'COMPUTER_RUNTIME_FILE');return digest(fs.readFileSync(fd));}
  finally{fs.closeSync(fd);}
}
function git(root,args){const result=spawnSync('/usr/bin/git',['--no-replace-objects','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:4_000_000,env:{...ENV,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1'}});need(result.status===0,'COMPUTER_ALPHA_SOURCE');return result.stdout.trim();}
export function verifyAlphaImportClosure(root,tracked){
  need(path.isAbsolute(root)&&fs.realpathSync(root)===root,'COMPUTER_ALPHA_SOURCE');const rootStat=fs.statSync(root);need((rootStat.uid===0||rootStat.uid===process.getuid())&&!(rootStat.mode&0o022),'COMPUTER_ALPHA_SOURCE');
  const inspect=(relative,recursive)=>{
    const file=path.join(root,relative),stat=fs.lstatSync(file);need(!stat.isSymbolicLink()&&fs.realpathSync(file)===file&&(stat.uid===0||stat.uid===process.getuid())&&!(stat.mode&0o022),'COMPUTER_ALPHA_SOURCE');
    if(stat.isDirectory()){
      if(path.basename(relative)==='__pycache__')return;
      if(recursive)for(const name of fs.readdirSync(file))inspect(relative?relative+'/'+name:name,true);
    }else if(/\.(?:py|pyc|pyd|so)$/.test(relative)||relative==='requirements-agent.lock'){
      need(stat.isFile()&&tracked.has(relative)&&stat.size<=32_000_000,'COMPUTER_UNTRACKED_IMPORT');const raw=fs.readFileSync(file);need(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex')===tracked.get(relative),'COMPUTER_ALPHA_SOURCE');
    }
  };
  inspect('alpha_factory_v1',true);inspect('requirements-agent.lock',false);
  for(const name of fs.readdirSync(root)){
    if(name.startsWith('.')||name==='alpha_factory_v1'||name==='node_modules')continue;
    const file=path.join(root,name),stat=fs.lstatSync(file);
    need(!stat.isSymbolicLink(),'COMPUTER_ALPHA_SOURCE');
    if(stat.isFile()&&/\.(?:py|pyc|pyd|so)$/.test(name))inspect(name,false);
    if(stat.isDirectory()&&fs.readdirSync(file).some(entry=>entry.startsWith('__init__.')&&/\.(?:py|pyc|pyd|so)$/.test(entry)))inspect(name,true);
  }
}
function source(root){
  need(git(root,['rev-parse','HEAD'])===ALPHA_COMPUTER_SOURCE.commit&&git(root,['rev-parse','HEAD^{tree}'])===ALPHA_COMPUTER_SOURCE.tree,'COMPUTER_ALPHA_SOURCE');
  const rows=git(root,['ls-tree','-r',ALPHA_COMPUTER_SOURCE.commit]).split('\n'),tracked=new Map();
  for(const row of rows){const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);if(match)tracked.set(match[3],match[2]);}
  verifyAlphaImportClosure(root,tracked);return digest(rows);
}
export function validateComputerInput(input){
  keys(input,['handoffRaw','publicNonpersonal']);need(input.publicNonpersonal===true,'COMPUTER_PUBLIC_NONPERSONAL_REQUIRED');
  need(typeof input.handoffRaw==='string'&&Buffer.byteLength(input.handoffRaw)<=COMPUTER_LIMITS.handoffBytes,'COMPUTER_HANDOFF_SIZE');
  publicOnly(input.handoffRaw);const handoff=parseStrict(input.handoffRaw,COMPUTER_LIMITS.handoffBytes);
  need(handoff.schema==='successor-alpha-computer-handoff/v1'&&handoff.authority==='none'&&handoff.settlement==='not_connected','COMPUTER_HANDOFF_SCHEMA');
  need(['public','synthetic'].includes(handoff.task?.input_rights),'COMPUTER_PUBLIC_NONPERSONAL_REQUIRED');
  return handoff;
}
export function callComputer(profile,mode,request={},timeout=15000){
  const input=canonical({profile,...request}),command=computerInvocation(profile,mode);let result;
  try{result=spawnSync(command.executable,command.args,{input,encoding:'utf8',timeout,maxBuffer:2_100_000,env:computerEnvironment()});}finally{command.close();}
  const code=String(result.stderr||'').trim();need(result.status===0,/^[A-Z0-9_]{1,100}$/.test(code)?code:'COMPUTER_NATIVE_VALIDATION_FAILED');
  return parseStrict(result.stdout,2_100_000);
}
export function inspectComputerInstallation(configFile,{checkDocker=true}={}){
  const disabled={supported:false,code:'COMPUTER_DISABLED',productionQualified:false,liveProvider:'UNCOMMISSIONED_PROVIDER_COST'};
  if(configFile===null||configFile===undefined)return disabled;
  try{
    need(path.isAbsolute(configFile)&&fs.realpathSync(configFile)===configFile,'COMPUTER_PROFILE_PATH');const parent=fs.statSync(path.dirname(configFile));need(parent.uid===process.getuid()&&!(parent.mode&0o077),'COMPUTER_PROFILE_PARENT');const raw=readPrivate(configFile,2_000_000),profile=parseStrict(decodeUTF8(raw),2_000_000);
    keys(profile,['schema','enabled','alphaRoot','source','python','pythonSha256','image','dockerSha256','provider','fixture','fixtureSha256','runtimeFiles']);
    need(profile.schema==='agi-fleet/alpha-computer-installation/v1'&&profile.enabled===true,'COMPUTER_PROFILE_INVALID');
    need(profile.provider?.mode==='scripted-zero-cost','UNCOMMISSIONED_PROVIDER_COST');keys(profile.provider,['mode']);
    need(canonical(profile.source)===canonical(ALPHA_COMPUTER_SOURCE)&&/^sha256:[a-f0-9]{64}$/.test(profile.image),'COMPUTER_PROFILE_INVALID');
    keys(profile.fixture,['handoffSha256','actions']);need(/^[a-f0-9]{64}$/.test(profile.fixture.handoffSha256)&&Array.isArray(profile.fixture.actions)&&profile.fixture.actions.length<=30,'COMPUTER_FIXTURE_INVALID');
    need(profile.fixtureSha256===digest(profile.fixture),'COMPUTER_FIXTURE_CHANGED');publicOnly(canonical(profile.fixture.actions));
    const sourceSha256=source(profile.alphaRoot);need(fileHash(profile.python)===profile.pythonSha256,'COMPUTER_PYTHON_CHANGED');
    need(profile.runtimeFiles&&typeof profile.runtimeFiles==='object'&&!Array.isArray(profile.runtimeFiles)&&Object.keys(profile.runtimeFiles).length>0&&Object.keys(profile.runtimeFiles).length<=2048,'COMPUTER_RUNTIME_FILES');
    for(const [file,sha256] of Object.entries(profile.runtimeFiles))need(/^[a-f0-9]{64}$/.test(sha256)&&fileHash(file)===sha256,'COMPUTER_RUNTIME_CHANGED');
    if(checkDocker){
      need(fileHash('/usr/bin/docker')===profile.dockerSha256,'COMPUTER_DOCKER_CHANGED');
      const image=spawnSync('/usr/bin/docker',['image','inspect','--format','{{.Id}}',profile.image],{encoding:'utf8',timeout:5000,maxBuffer:8192,env:ENV});need(image.status===0&&image.stdout.trim()===profile.image,'COMPUTER_IMAGE_UNAVAILABLE');
    }
    const runtimeIdentity=digest({profile:digest(raw),sourceSha256,launcher:fileHash(LAUNCHER),runtimeFiles:profile.runtimeFiles,python:profile.pythonSha256,docker:profile.dockerSha256});
    return {supported:true,code:null,mode:'scripted-zero-cost',runtimeIdentity,alphaCommit:profile.source.commit,image:profile.image,
      provider:{mode:'scripted-zero-cost',model:'SCRIPTED_ZERO_COST_REHEARSAL_'+profile.fixtureSha256},productionQualified:false,
      liveProvider:'UNCOMMISSIONED_PROVIDER_COST',profile};
  }catch(error){return {...disabled,code:/^[A-Z0-9_]{1,100}$/.test(error.code||error.message)?error.code||error.message:'COMPUTER_CONFIGURATION_INVALID'};}
}
const PREPARED=new Map();
export function prepareComputer(input,installation){
  validateComputerInput(input);need(installation?.supported,installation?.code||'COMPUTER_DISABLED');
  need(digest(input.handoffRaw)===installation.profile.fixture.handoffSha256,'COMPUTER_FIXTURE_BINDING');
  const key=installation.runtimeIdentity+':'+digest(input.handoffRaw);let prepared=PREPARED.get(key);
  if(!prepared){prepared=callComputer(installation.profile,'prepare',{handoffRaw:input.handoffRaw});if(PREPARED.size>=128)PREPARED.clear();PREPARED.set(key,prepared);}
  return {...prepared,runtimeIdentity:installation.runtimeIdentity,alphaCommit:installation.alphaCommit,image:installation.image,
    evidenceClass:'NATIVE_ALPHA_SCRIPTED_REHEARSAL',artifactReservationBytes:COMPUTER_LIMITS.artifactTotalBytes,
    providerCost:'SCRIPTED_ZERO_PROVIDER_REQUESTS',deviceCost:'UNKNOWN',independentReview:false,productionQualified:false};
}
export function createComputerProfile({alphaRoot,python,image,handoffRaw,actions,output}){
  validateComputerInput({handoffRaw,publicNonpersonal:true});publicOnly(canonical(actions));need(/^sha256:[a-f0-9]{64}$/.test(image),'COMPUTER_IMAGE_INVALID');source(alphaRoot);
  need(path.isAbsolute(python)&&fs.realpathSync(python)===python,'COMPUTER_PYTHON_PHYSICAL_REQUIRED');const fixture={handoffSha256:digest(handoffRaw),actions},partial={alphaRoot,python};
  const probe=callComputer(partial,'probe');
  const profile={schema:'agi-fleet/alpha-computer-installation/v1',enabled:true,alphaRoot,source:ALPHA_COMPUTER_SOURCE,
    python,pythonSha256:fileHash(python),image,dockerSha256:fileHash('/usr/bin/docker'),provider:{mode:'scripted-zero-cost'},
    fixture,fixtureSha256:digest(fixture),runtimeFiles:probe.files};
  callComputer(profile,'prepare',{handoffRaw});need(path.isAbsolute(output),'COMPUTER_PROFILE_PATH');
  const fd=fs.openSync(output,'wx',0o600);try{fs.writeFileSync(fd,canonical(profile));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {profile:output,authority:'none',executionStarted:false,providerRequests:0,next:'Start the service with --computer-config, inspect doctor, activate and prepare a new exact one-use grant.'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2),values={};need(args.length===12,'COMPUTER_PROFILE_ARGUMENTS');for(let index=0;index<args.length;index+=2){need(['--alpha-root','--python','--image','--handoff','--actions','--output'].includes(args[index])&&!Object.hasOwn(values,args[index]),'COMPUTER_PROFILE_ARGUMENTS');values[args[index]]=args[index+1];}
    console.log(JSON.stringify(createComputerProfile({alphaRoot:path.resolve(values['--alpha-root']),python:path.resolve(values['--python']),image:values['--image'],handoffRaw:decodeUTF8(readPrivate(path.resolve(values['--handoff']),1_000_000)),actions:parseStrict(decodeUTF8(readPrivate(path.resolve(values['--actions']),100000)),100000),output:path.resolve(values['--output'])})));}
  catch(error){console.error(JSON.stringify({error:error.code||'COMPUTER_PROFILE_FAILED'}));process.exitCode=1;}
}
