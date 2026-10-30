// SPDX-License-Identifier: MIT
// Fixed public UI drivers. Actual Alpha workers use a separate network-none native path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const [phase,root,alphaRoot,jobsRoot,managerRoot,image]=process.argv.slice(2);
assert(['forward','complete'].includes(phase));for(const value of [root,alphaRoot,jobsRoot,managerRoot])assert(path.isAbsolute(value??'')&&!/[,\r\n]/.test(value));assert.match(image,/^sha256:[a-f0-9]{64}$/);process.umask(0o077);
const lock=JSON.parse(fs.readFileSync(new URL('./compatibility-set.json',import.meta.url))),producer=JSON.parse(fs.readFileSync(path.join(root,'execution-context.json'))),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-public-gui-')),output=path.join(root,phase==='forward'?'forward':'gui');fs.mkdirSync(output,{recursive:true,mode:0o700});
const inputs=phase==='forward'?{'project.json':'accepted/project.json','handoff.json':'accepted/handoff.json','frozen-mission-report.json':'accepted/frozen-mission-report.json'}:{'handoff.json':'accepted/handoff.json','computer-return.json':'accepted/dashboard/en/computer-return.json','frozen-mission-report.json':'accepted/frozen-mission-report.json','recovery-retained-history.json':'recovery-retained-history.json','initial-alpha-project.json':'forward/initial-alpha-project.json'};
for(const [name,file]of Object.entries(inputs)){fs.copyFileSync(path.join(root,file),path.join(temporary,name));if(phase==='forward')fs.copyFileSync(path.join(root,file),path.join(output,'starter-'+name));}
const script=new URL(phase==='forward'?'./gui-forward.py':'./gui-roundtrip.py',import.meta.url).pathname,name='fleet-public-gui-'+crypto.randomUUID(),mount=(source,target)=>['--mount','type=bind,source='+source+',target='+target+',readonly'];
let execution;
try{
  const command=['run','--name',name,'--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--user',String(process.getuid())+':'+String(process.getgid()),'--env','PYTHONDONTWRITEBYTECODE=1',...mount(script,'/kit/driver.py'),...mount(path.join(jobsRoot,'build/pages'),'/sites/jobs'),...mount(temporary,'/inputs'),'--mount','type=bind,source='+output+',target=/output'];
  command.push(...mount(path.join(alphaRoot,'docs'),'/sites/alpha'));
  if(phase==='complete')command.push(...mount(path.join(managerRoot,'build/pages'),'/sites/manager'));
  command.push('--entrypoint','python',image,'/kit/driver.py','--alpha-site','/sites/alpha','--alpha-commit',lock.alpha,'--jobs-site','/sites/jobs','--inputs','/inputs','--output','/output','--image',image,'--jobs-commit',lock.jobs,'--fleet-commit',producer.commit);
  if(phase==='complete')command.push('--manager-site','/sites/manager','--manager-commit',lock.manager);
  execution=execFileSync('/usr/bin/docker',command,{encoding:'utf8',timeout:240000,maxBuffer:20000,env:{PATH:'/usr/bin:/bin'}});
}finally{
  spawnSync('/usr/bin/docker',['rm','--force',name],{timeout:15000,env:{PATH:'/usr/bin:/bin'},stdio:'ignore'});fs.rmSync(temporary,{recursive:true,force:true});const retained=spawnSync('/usr/bin/docker',['container','ls','--all','--quiet','--filter','name=^/'+name+'$'],{timeout:5000,maxBuffer:8192,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});if(retained.status!==0||retained.stdout.trim())throw Error('PUBLIC_GUI_CONTAINER_CLEANUP_UNCONFIRMED');
}
console.log(execution.trim());
