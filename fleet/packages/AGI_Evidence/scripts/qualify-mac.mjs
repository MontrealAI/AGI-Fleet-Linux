#!/usr/bin/env node
import {COMPUTE_ROLES,roleContract} from '../compute/roles.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';
import {collectPreflight,sanitizeDiagnostics} from '../src/control/system-preflight.mjs';import {contextHash,waitForDocker,desktopCheck,safeDesktopReport,requireStandardComputeAccount} from '../compute/setup-support.mjs';
import {releaseIdentity} from '../compute/desktop-evidence.mjs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1],role=args.includes('--role')?value('--role'):'agent';
const scenarios=['cold-docker','warm-docker','after-login','after-reboot','cached-image','fresh-image','cold-start','repeated-run','screen-sharing-attached','screen-sharing-disconnected'];
const scenario=args.includes('--scenario')?value('--scenario'):'warm-docker',runs=args.includes('--runs')?Number(value('--runs')):50;
if(!COMPUTE_ROLES.includes(role)||!scenarios.includes(scenario)||!Number.isSafeInteger(runs)||runs<1||runs>50)throw Error('Use --role agent|node --scenario '+scenarios.join('|')+' --runs 1..50');
const out=path.resolve(args.includes('--out')?value('--out'):'AGI-Mac-Commissioning-'+new Date().toISOString().replaceAll(':','-'));fs.mkdirSync(out,{mode:0o700});
const report={schema:'agi-real-mac-commissioning/v2',startedAt:new Date().toISOString(),scenario,scenarioSource:'operator-supplied label, not automatically proven',requestedRuns:runs,role,physicalMac:process.platform==='darwin',preflight:sanitizeDiagnostics(collectPreflight()),checks:[],status:'NOT_RUN',qualification:'UNVERIFIED',limits:{workstationMemory:'4g',cpus:2,pids:384,network:'none'},walletAccessed:false,providerCalls:false,paidSettlements:false};
const save=()=>fs.writeFileSync(path.join(out,'commissioning.json'),JSON.stringify(report,null,2),{mode:0o600});save();
const run=(exe,a,capture=false,timeout=900000)=>spawnSync(exe,a,{encoding:'utf8',timeout,maxBuffer:2*1024*1024,stdio:capture?'pipe':'inherit',env:{HOME:os.homedir(),PATH:process.env.PATH,LANG:'C'}});
let sampler;
try{
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('REAL_APPLE_SILICON_MAC_REQUIRED');
 const rawPreflight=collectPreflight();requireStandardComputeAccount(rawPreflight.facts);
 if(rawPreflight.facts.openclawVersion!=='2026.9.5'||rawPreflight.gates.find(g=>g.id==='runtime')?.state!=='passed')throw Error('QUALIFIED_RUNTIME_REQUIRED');
 const packageRoot=fileURLToPath(new URL('..',import.meta.url));report.release=releaseIdentity(packageRoot);
 const verified=run(process.execPath,[path.join(packageRoot,'scripts/verify-package.mjs')],true,120000);if(verified.status!==0)throw Error('PACKAGE_INTEGRITY_FAILED');
 const profileDir=path.join(os.homedir(),'.openclaw-'+roleContract(role).profile);
 let c;try{c=JSON.parse(fs.readFileSync(path.join(profileDir,'compute-settings.json'),'utf8'));}catch{}
 if(!c){
   const previous=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.agi-genesis-setup-'+role,'setup-diagnostics.json'),'utf8'));
   if(previous.stages?.preflight!=='passed'||previous.stages?.images!=='passed'||previous.packageManifestSHA256!==report.release.packageManifestSHA256)throw Error('RUN_CURRENT_DESKTOP_SETUP_FIRST');
   c={role,workstation:true,imageID:previous.images?.work};report.profileState='not yet installed; using verified current-release setup image';
 }else{if(c.signerUID===process.getuid())throw Error('ISOLATED_WORKSTATION_PROFILE_REQUIRED');report.profileState='dedicated profile present';}
 if(c.role!==role||process.getuid()===0||c.workstation!==true||!/^sha256:[a-f0-9]{64}$/.test(c.imageID))throw Error('ISOLATED_WORKSTATION_PROFILE_REQUIRED');
 await waitForDocker(remaining=>run('docker',['info'],true,Math.min(4000,remaining)).status===0,{progress:n=>{if(n%5===1)console.log('Waiting for Docker…');}});
 const root=fileURLToPath(new URL('../compute',import.meta.url)),i=JSON.parse(run('docker',['image','inspect',c.imageID],true).stdout)[0];if(i.Config?.Labels?.['ai.montreal.agi.recipe']!==contextHash(root))throw Error('CURRENT_RELEASE_IMAGE_REQUIRED_RERUN_SETUP');
 report.preflight=sanitizeDiagnostics(collectPreflight());report.status='RUNNING';save();
 sampler=spawn(process.execPath,[fileURLToPath(new URL('./resource-sampler.mjs',import.meta.url)),path.join(out,'host-resources.json')],{stdio:'ignore'});
 for(let n=1;n<=runs;n++){console.log(`Official workstation check ${n}/${runs}`);const checked=desktopCheck(run,'docker',c.imageID);const safe=safeDesktopReport(checked);const attempt={run:n,at:new Date().toISOString(),preflight:sanitizeDiagnostics(collectPreflight()),...safe};report.checks.push(attempt);fs.writeFileSync(path.join(out,'attempt-'+String(n).padStart(3,'0')+'.json'),JSON.stringify(attempt,null,2),{flag:'wx',mode:0o600});save();if(!checked.passed)throw Error(checked.oomKilled?'WORKSTATION_OOM':'WORKSTATION_CHECK_FAILED');}
 report.status='PASSED';report.desktopReliabilityEvidence=report.checks.length===50?'50 consecutive observed passes':'fewer than 50 runs';
 report.qualification='PENDING_OTHER_SCENARIOS_AND_OPERATOR_GATES';
}catch(e){report.status=report.checks.length?'FAILED':'BLOCKED';report.failure=/^[A-Z_]+$/.test(e.message)?e.message:'LOCAL_PRECONDITION_FAILED';process.exitCode=1;console.error(report.failure);}
finally{if(sampler){await new Promise(resolve=>{sampler.once('exit',resolve);sampler.kill('SIGTERM');setTimeout(()=>{sampler.kill('SIGKILL');resolve();},6000).unref();});}report.finishedAt=new Date().toISOString();save();console.log('Commissioning report: '+path.join(out,'commissioning.json'));console.log('This utility exercises the disposable workstation. It does not qualify provider billing, reviewer independence, payments, Safari or FileVault. Complete the checklist for those gates.');}
