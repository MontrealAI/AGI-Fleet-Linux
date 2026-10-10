import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {runtimeEnvironment} from './runtime-env.mjs';
import {ensure,sha256,canonical} from '../src/util.mjs';
import {verifyPlan} from './commissioning-fixture.mjs';
import {inspectPNG} from '../src/images.mjs';
const execute=promisify(execFile),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const scripts=fileURLToPath(new URL('./commissioning-controls',import.meta.url));
export function controlsSourceHashes(){return Object.fromEntries(['probe.mjs','desktop-fixture.py','desktop-probe.py'].map(name=>[name,sha256(fs.readFileSync(path.join(scripts,name)))]));}
function bytes(file,max){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const st=fs.fstatSync(fd);ensure(st.isFile()&&st.nlink===1&&st.size>0&&st.size<=max,'CONTROLS_ARTIFACT_LIMIT');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
export function verifyLocalControls(plan,capture){
 verifyPlan(plan);ensure(capture?.schema==='agi-local-controls-capture/v1'&&capture.runID===plan.runID&&capture.releaseSHA256===plan.releaseSHA256,'CONTROLS_SCOPE');
 ensure(capture.providerCalls===0&&capture.normalAgentPipeline===false&&capture.modelDriven===false&&capture.container?.network==='none'&&capture.container.readOnlyRoot===true&&capture.container.privileged===false&&capture.container.removed===true&&hash(capture.container.id)&&/^sha256:[a-f0-9]{64}$/.test(capture.container.imageID),'CONTROLS_ISOLATION');
 ensure(canonical(capture.sourceHashes)===canonical(controlsSourceHashes()),'CONTROLS_SOURCE_CHANGED');
 const report=capture.report;ensure(report?.schema==='agi-local-controls/v1'&&report.runID===plan.runID&&report.network==='none'&&report.providerCalls===0&&report.modelDriven===false&&report.normalAgentPipeline===false,'CONTROLS_REPORT');
 ensure(report.startedAt>=plan.createdAt&&report.finishedAt>=report.startedAt&&report.finishedAt<=plan.expiresAt,'CONTROLS_TIME');
 for(const name of ['browser','desktop']){const data=Buffer.from(capture.screenshots?.[name]??'','base64');ensure(data.length>32&&data.length<=4194304&&sha256(data)===report[name]?.screenshotSHA256,'CONTROLS_SCREENSHOT');const size=inspectPNG(data);ensure(name==='desktop'?size.width===1440&&size.height===900:size.width>=640&&size.height>=480,'CONTROLS_SCREENSHOT');}
 const b=report.browser,d=report.desktop;ensure(b.status==='PASS'&&b.capability==='local-browser-controls'&&b.observedValue===plan.privateOracle.browserChallenge&&b.effect?.action==='submit'&&b.effect.value===plan.privateOracle.browserChallenge&&b.domSHA256===sha256(b.domBytes)&&b.domBytes.includes(plan.privateOracle.browserChallenge)&&b.events?.some(e=>e.method==='Page.navigate')&&b.events.some(e=>e.method==='Input.insertText')&&b.events.filter(e=>e.method==='Input.dispatchMouseEvent').length>=4,'CONTROLS_BROWSER');
 ensure(d.status==='PASS'&&d.capability==='local-desktop-input'&&d.modelDriven===false&&d.visionTested===false&&d.effect?.runID===plan.runID&&d.effect.value===plan.privateOracle.desktopChallenge&&d.effect.clicks===1&&d.actions?.some(e=>e.action==='type'&&e.textHash===sha256(plan.privateOracle.desktopChallenge)&&hash(e.frame))&&d.actions.filter(e=>e.action==='click'&&hash(e.frame)).length>=2,'CONTROLS_DESKTOP');
 return {status:'PASS',scope:'offline local browser controls and frame-bound desktop input',modelDriven:false,normalAgentPipeline:false,desktopVision:false,publicWeb:false,productionQualified:false};
}
export async function runLocalControls(c,plan,kit,{command,now=Date.now,pause=delay,environment=runtimeEnvironment}={}){
 verifyPlan(plan);ensure(now()<plan.expiresAt,'CONTROLS_PLAN_EXPIRED');ensure(typeof c.docker==='string'&&path.isAbsolute(c.docker)&&/^sha256:[a-f0-9]{64}$/.test(c.imageID),'CONTROLS_PINNED_RUNTIME');
 const env=environment(c),run=command??(async args=>(await execute(c.docker,args,{env,encoding:'utf8',timeout:10000,maxBuffer:2097152,shell:false})).stdout);
 const scratch=fs.mkdtempSync(path.join(kit,'local-controls-')),incoming=path.join(scratch,'input');fs.mkdirSync(incoming,{mode:0o755});fs.chmodSync(incoming,0o755);
 fs.writeFileSync(path.join(incoming,'input.json'),JSON.stringify({runID:plan.runID,browserChallenge:plan.privateOracle.browserChallenge,desktopChallenge:plan.privateOracle.desktopChallenge}),{mode:0o444,flag:'wx'});
 const name='agi-controls-'+crypto.randomBytes(16).toString('hex');let containerID,report,screenshots={},inspection,removed=false,failure;
 try{
  containerID=(await run(['create','--name',name,'--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','384','--memory','4g','--cpus','2','--tmpfs','/tmp:rw,nosuid,size=768m','--tmpfs','/workspace:rw,uid=1000,gid=1000,mode=700,size=128m','--mount',`type=bind,source=${scripts},target=/proof,readonly`,'--mount',`type=bind,source=${incoming},target=/proof-input,readonly`,c.imageID,'node','/proof/probe.mjs'])).trim();ensure(hash(containerID),'CONTROLS_CONTAINER');
  await run(['start',containerID]);const deadline=now()+180000;let done=false;
  while(now()<deadline){const log=await run(['logs','--tail','2',containerID]);if(log.trim().split('\n').includes('AGI_CONTROLS_COMPLETE')){done=true;break;}const state=JSON.parse(await run(['inspect','--format','{{json .State}}',containerID]));ensure(state.Running===true,'CONTROLS_PROCESS_FAILED');await pause(1000);}
  ensure(done,'CONTROLS_TIMEOUT');inspection=JSON.parse(await run(['inspect',containerID]))[0];ensure(inspection?.Id===containerID&&inspection.Image===c.imageID,'CONTROLS_CONTAINER');
  await run(['cp',containerID+':/workspace/proof/report.json',path.join(scratch,'report.json')]);report=JSON.parse(bytes(path.join(scratch,'report.json'),1048576));
  for(const n of ['browser','desktop']){await run(['cp',containerID+':/workspace/proof/'+n+'.png',path.join(scratch,n+'.png')]);screenshots[n]=bytes(path.join(scratch,n+'.png'),4194304).toString('base64');}
 }catch(e){failure=/^CONTROLS_[A-Z0-9_]+$/.test(e.message)?e.message:'CONTROLS_RUNTIME_UNAVAILABLE';}
 finally{try{await run(['rm','--force',containerID??name]);removed=true;}catch{failure='CONTROLS_CLEANUP_FAILED';}fs.rmSync(scratch,{recursive:true,force:true});}
 const capture={schema:'agi-local-controls-capture/v1',runID:plan.runID,releaseSHA256:plan.releaseSHA256,createdAt:now(),sourceHashes:controlsSourceHashes(),host:{platform:process.platform,arch:process.arch},container:{id:containerID,imageID:inspection?.Image,network:inspection?.HostConfig?.NetworkMode,readOnlyRoot:inspection?.HostConfig?.ReadonlyRootfs,privileged:inspection?.HostConfig?.Privileged,removed},report,screenshots,providerCalls:0,normalAgentPipeline:false,modelDriven:false,productionQualified:false,failure};
 try{ensure(!failure,failure??'CONTROLS_FAILED');capture.validation=verifyLocalControls(plan,capture);}catch(e){capture.validation={status:'BLOCKED',code:/^CONTROLS_[A-Z0-9_]+$/.test(e.message)?e.message:'CONTROLS_EVIDENCE_INVALID',productionQualified:false};}
 return capture;
}
