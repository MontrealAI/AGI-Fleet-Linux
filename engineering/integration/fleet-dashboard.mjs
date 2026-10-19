// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {sha256} from './bridge.mjs';
export function privateDashboardDriver(file,args,options){try{return execFileSync(file,args,{...options,stdio:['pipe','pipe','pipe']});}catch{throw Error('DASHBOARD_DRIVER_FAILED');}}
export function requireNoDashboardCredential(directory,token){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);assert(!entry.isSymbolicLink(),'DASHBOARD_ARTIFACT_LINK');if(entry.isDirectory())requireNoDashboardCredential(file,token);else if(fs.readFileSync(file).includes(Buffer.from(token)))throw Error('DASHBOARD_CREDENTIAL_LEAK');}}
export function withPrivateDashboardOutput(output,executeAndVerify){
  try{fs.lstatSync(output);throw Error('Choose an absent dashboard evidence directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  const staging=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-dashboard-private-'));let created=false;
  try{const value=executeAndVerify(staging);fs.mkdirSync(output,{mode:0o700});created=true;for(const name of fs.readdirSync(staging))fs.cpSync(path.join(staging,name),path.join(output,name),{recursive:true,errorOnExist:true,force:false});return value;}
  catch(error){if(created)fs.rmSync(output,{recursive:true,force:true});throw error;}
  finally{fs.rmSync(staging,{recursive:true,force:true});}
}
export function captureFleetDashboard({url,token,actor,run,image,output,nativeReturnSha256,artifact}){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('DASHBOARD_CREDENTIAL_SHAPE');
  assert(path.isAbsolute(output));assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.match(run,/^[a-f0-9-]{36}$/);assert.match(artifact.name,/^screen-[0-9]{3}\.png$/);
  return withPrivateDashboardOutput(output,privateOutput=>captureInto({url,token,actor,run,image,output:privateOutput,nativeReturnSha256,artifact}));
}
function captureInto({url,token,actor,run,image,output,nativeReturnSha256,artifact}){
  const script=new URL('./fleet-dashboard-export.py',import.meta.url).pathname;
  const input=JSON.stringify({url,token,actor,run,image,nativeReturnSha256,artifact});
  // Credentials are never command arguments, environment values or public files.
  const name='fleet-dashboard-'+crypto.randomUUID();let result;
  try{result=privateDashboardDriver('/usr/bin/docker',['run','--name',name,'--rm','--interactive','--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--user',String(process.getuid())+':'+String(process.getgid()),'--env','PYTHONDONTWRITEBYTECODE=1','--mount','type=bind,source='+script+',target=/kit/fleet-dashboard-export.py,readonly','--mount','type=bind,source='+output+',target=/output','--entrypoint','python',image,'/kit/fleet-dashboard-export.py'],{input,encoding:'utf8',timeout:150000,maxBuffer:20000,env:{PATH:'/usr/bin:/bin'}});}finally{spawnSync('/usr/bin/docker',['rm','--force',name],{timeout:15000,env:{PATH:'/usr/bin:/bin'},stdio:'ignore'});const retained=spawnSync('/usr/bin/docker',['container','ls','--all','--quiet','--filter','name=^/'+name+'$'],{timeout:5000,maxBuffer:8192,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});if(retained.status!==0||retained.stdout.trim())throw Error('DASHBOARD_CONTAINER_CLEANUP_UNCONFIRMED');}
  requireNoDashboardCredential(output,token);
  if(result.includes(token))throw Error('DASHBOARD_CREDENTIAL_LEAK');
  let summary;try{summary=JSON.parse(result);}catch{throw Error('DASHBOARD_SUMMARY_INVALID');}
  if(Object.keys(summary).sort().join('|')!=='actualDashboardExports|credentialRetainedInEvidence|realWallets'||summary.actualDashboardExports!==2||summary.credentialRetainedInEvidence!==false||summary.realWallets!==false)throw Error('DASHBOARD_SUMMARY_INVALID');
  const observed=JSON.parse(fs.readFileSync(path.join(output,'dashboard-export-evidence.json')));assert.equal(observed.image,image);assert.equal(observed.driverSha256,sha256(fs.readFileSync(script)));assert.equal(observed.cases.length,2);
  for(const language of ['en','fr']){assert.equal(sha256(fs.readFileSync(path.join(output,language,'computer-return.json'))),nativeReturnSha256);assert.equal(sha256(fs.readFileSync(path.join(output,language,artifact.name))),artifact.sha256);}
  return {observationSha256:sha256(fs.readFileSync(path.join(output,'dashboard-export-evidence.json'))),nativeReturnSha256,artifactSha256:artifact.sha256,cases:observed.cases.length,containerClosed:true,publicSummary:summary};
}
