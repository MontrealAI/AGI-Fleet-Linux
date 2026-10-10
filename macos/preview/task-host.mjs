import {spawnSync} from 'node:child_process';
import {assertMacHost} from './mac-host.mjs';

export function assertMacTaskHost({host=assertMacHost,uid=process.getuid?.(),run=spawnSync}={}){
  const observed=host();
  if(!Number.isSafeInteger(uid)||uid<=0)throw Error('WORKFORCE_MAC_STANDARD_ACCOUNT_REQUIRED');
  let groups;try{groups=run('/usr/bin/id',['-Gn'],{encoding:'utf8',timeout:5000,maxBuffer:4096,shell:false,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});}catch{throw Error('WORKFORCE_MAC_ACCOUNT_OBSERVATION_FAILED');}
  if(groups?.status!==0||groups.error||groups.signal||typeof groups.stdout!=='string'||!groups.stdout.trim())throw Error('WORKFORCE_MAC_ACCOUNT_OBSERVATION_FAILED');
  const names=groups.stdout.trim().split(/\s+/);
  if(names.some(n=>!/^[A-Za-z0-9_.-]+$/.test(n)))throw Error('WORKFORCE_MAC_ACCOUNT_OBSERVATION_FAILED');
  if(names.some(n=>['admin','wheel','root','sudo'].includes(n)))throw Error('WORKFORCE_MAC_STANDARD_ACCOUNT_REQUIRED');
  return {...observed,standardAccount:true,qualified:false};
}
