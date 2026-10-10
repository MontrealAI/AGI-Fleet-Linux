import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import net from 'node:net';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {createInterface} from 'node:readline/promises';
import {roleContract,setupRole} from './roles.mjs';import {setupCapable} from './setup.mjs';import {validateHandoffFile} from './setup-ledger.mjs';import {assertComputePolicy} from './policy.mjs';import {runtimeEnvironment} from './runtime-env.mjs';import {assertLinuxHost,privateObject,stopLinuxServices,startLinuxService,linuxReleaseVersion} from './linux-host.mjs';import {publicBrowserSocketsStopped} from './public-browser-runtime.mjs';import {desktopCheck} from './setup-support.mjs';import {atomicWrite} from '../src/util.mjs';
const need=(v,c)=>{if(!v)throw Error(c);};
const code=e=>/^[A-Z0-9_]{3,100}$/.test(e?.message??'')?e.message:'LINUX_OPERATION_FAILED';
const listening=port=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(1000);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});
function settings(role){const contract=roleContract(role),dir=path.join(os.homedir(),'.openclaw-'+contract.profile),file=path.join(dir,'compute-settings.json');privateObject(dir,{directory:true});const st=privateObject(file);need(st.size<=1024*1024,'COMPUTE_SETTINGS');const c=JSON.parse(fs.readFileSync(file));need(c.deploymentPlatform==='linux'&&c.role===role&&c.home===os.homedir()&&c.profileDir===dir&&c.port===contract.port&&c.gatewayPort===contract.gatewayPort,'LINUX_SERVICE_IDENTITY');return c;}
function stopMarker(c,reason){const file=path.join(c.profileDir,'COMPUTE_STOP');if(fs.lstatSync(file,{throwIfNoEntry:false}))return;const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,reason+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
async function stop(c){return stopLinuxServices({home:c.home,role:c.role,probePort:listening,checkSockets:signal=>publicBrowserSocketsStopped({profileDir:c.profileDir,uid:process.getuid(),platform:'linux',signal})});}
export async function linuxMain(args=process.argv.slice(2)){
 const take=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];},action=take('--action'),role=take('--role');
 if(args.includes('--help')){console.log('AGI Fleet Linux — Ubuntu 24.04 LTS\nInstall.sh --file PRIVATE_SETUP.json\nInspect.sh\nStop-Compute.sh\nQualify-Linux.sh --cycles 1 (Agent/Node only; no provider call)\nStart-Approved.sh (stopped, approved, STOP-free services only)\nUse Linux-Guide.html. No migration or automatic STOP reconciliation.');return;}
 need(['agent','node','moderator','employer','evidence','recovery'].includes(role),'LINUX_ROLE_REQUIRED');need(process.platform==='linux'&&process.getuid()>=1000,'LINUX_STANDARD_ACCOUNT_REQUIRED');
 const allowed=new Set(['--role','--action',...(action==='install'?['--file']:action==='qualify'?['--cycles']:[])]);for(let i=0;i<args.length;i+=2)need(allowed.has(args[i])&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--')&&args.indexOf(args[i])===i,'LINUX_ARGUMENT_INVALID');
 if(action==='install'){
  const file=take('--file');need(file,'PRIVATE_SETUP_KIT_REQUIRED');const kit=validateHandoffFile(path.resolve(file),{repairPermissions:false});need(setupRole(kit)===role,'OPENCLAW_SETUP_FILE');
  const rl=createInterface({input:process.stdin,output:process.stdout});const abort=new AbortController(),cancel=()=>abort.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try{const result=await setupCapable(kit,rl,{filePath:path.resolve(file),cleanInstall:true,assuranceMode:'standard',signal:abort.signal});console.log('Sanitized setup result: '+path.join(result.supportDirectory,'setup-diagnostics.json'));}
  finally{rl.close();process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}return;
 }
 const c=settings(role);
 if(action==='inspect'){
  let policy='PASS',host='PASS';try{assertComputePolicy(c);}catch(e){policy=code(e);}try{assertLinuxHost(c);}catch(e){host=code(e);}
  let health=null;if(policy==='PASS')try{const r=await fetch('http://127.0.0.1:'+c.port+'/health',{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(5000)});if(r.ok){const v=await r.json();health={role:v.role===role?role:null,stopped:v.stopped===true,busy:v.busy===true,policyCurrent:v.policyCurrent===true,runs24h:Number.isSafeInteger(v.runs24h)&&v.runs24h>=0?v.runs24h:null,images24h:Number.isSafeInteger(v.images24h)&&v.images24h>=0?v.images24h:null};}}catch{}
  console.log(JSON.stringify({schema:'agi-linux-inspection/v1',platform:'linux',arch:process.arch,release:linuxReleaseVersion(),role,policy,host,computeSTOP:fs.existsSync(path.join(c.profileDir,'COMPUTE_STOP')),health,productionQualified:false,walletAccessed:false,providerCall:false},null,2));return;
 }
 if(action==='stop'){stopMarker(c,'OPERATOR_REQUESTED_STOP');console.log(JSON.stringify(await stop(c),null,2));console.log('COMPUTE_STOP preserved. Explicit reconciliation is required.');return;}
 assertLinuxHost(c);assertComputePolicy(c);need(!fs.existsSync(path.join(c.profileDir,'COMPUTE_STOP')),'COMPUTE_STOP_REQUIRES_RECONCILIATION');
 if(action==='start'){
  const rl=createInterface({input:process.stdin,output:process.stdout});try{need((await rl.question('Start the approved, STOP-free services? Type START APPROVED: ')).trim()==='START APPROVED','CANCELLED');startLinuxService(c,'gateway');startLinuxService(c,'compute');console.log('Services started. Verify authenticated identity and health from the signer.');}finally{rl.close();}return;
 }
 need(action==='qualify'&&['agent','node'].includes(role),'LINUX_ACTION_INVALID');const cycles=Number(take('--cycles')??'1');need(Number.isSafeInteger(cycles)&&cycles>=1&&cycles<=50,'LINUX_CYCLE_LIMIT');
 const directory=fs.mkdtempSync(path.join(c.home,'.agi-linux-qualification-'));fs.chmodSync(directory,0o700);const reportFile=path.join(directory,'report.json'),started=Date.now();
 const report={schema:'agi-linux-local-qualification/v1',release:linuxReleaseVersion(),role,startedAt:new Date(started).toISOString(),state:'RUNNING',requestedCycles:cycles,completedCycles:0,results:[],providerCalled:false,walletAccessed:false,productionQualified:false,scope:'Local Docker desktop/document checks; OAuth, live job cleanup, reboot and endurance remain separate.'};
 const save=()=>atomicWrite(reportFile,JSON.stringify(report,null,2));save();const env=runtimeEnvironment(c);let aborted=false;const cancel=()=>{aborted=true;};process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 const run=(exe,a,capture=true)=>spawnSync(exe,a,{env,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,shell:false});
 try{for(let i=0;i<cycles;i++){
  need(!aborted,'CANCELLED');assertComputePolicy(c);need(!fs.existsSync(path.join(c.profileDir,'COMPUTE_STOP')),'COMPUTE_STOP_REQUIRES_RECONCILIATION');
  const desk=desktopCheck(run,c.docker,c.imageID,{strictCleanup:true});need(desk.passed,'COMPUTE_DESKTOP_SELFTEST_FAILED');
  const name='agi-linux-check-'+crypto.randomBytes(10).toString('hex'),work=path.join(directory,'cycle-'+(i+1));fs.mkdirSync(work,{mode:0o700});
  let pass=false;try{
   const program="from docx import Document\nfrom pathlib import Path\nassert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='4294967296'\nassert Path('/sys/fs/cgroup/pids.max').read_text().strip()=='128'\nq,p=map(int,Path('/sys/fs/cgroup/cpu.max').read_text().split());assert q/p==2\nd=Document();d.add_paragraph('AGI Linux qualification');d.save('/work/qualification.docx')\nassert Document('/work/qualification.docx').paragraphs[0].text=='AGI Linux qualification'\n";
   const r=run(c.docker,['run','--name',name,'--label','ai.montreal.agi.linux-check='+name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','4g','--memory-swap','4g','--cpus','2','--user','0:0','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--mount','type=bind,source='+work+',target=/work',c.imageID,'python3','-c',program]);
   need(r.status===0&&!r.error&&!r.signal,'LINUX_DOCUMENT_CHECK_FAILED');const st=fs.lstatSync(path.join(work,'qualification.docx'));need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&st.size>1000,'LINUX_DOCUMENT_OWNERSHIP_FAILED');pass=true;
  }finally{
   const removed=run(c.docker,['rm','--force',name]),after=run(c.docker,['ps','-aq','--filter','name=^/'+name+'$']);need(removed.status===0&&!removed.error&&!removed.signal&&after.status===0&&!after.error&&!after.signal&&String(after.stdout??'').trim()==='','COMPUTE_SANDBOX_CLEANUP_FAILED');
  }
  need(pass&&!aborted,'CANCELLED');report.results.push({cycle:i+1,desktop:'PASS',document:'PASS',hostOwnership:'PASS',resourceLimits:'PASS',containerCleanup:'PASS'});report.completedCycles++;save();console.log('Local cycle '+(i+1)+'/'+cycles+' passed.');
 }report.state='PASS';}
 catch(e){report.state='FAIL';report.failureCode=code(e);stopMarker(c,code(e));throw e;}
 finally{report.finishedAt=new Date().toISOString();report.elapsedSeconds=Math.round((Date.now()-started)/1000);save();process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);console.log('Local qualification report: '+reportFile);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){process.umask(0o077);linuxMain().catch(e=>{console.error('Stopped: '+code(e));console.error('Preserve the profile, Docker state, journals and STOP marker. Use Inspect.sh and the sanitized setup report.');process.exitCode=1;});}
