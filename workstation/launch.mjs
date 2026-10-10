#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {main} from './engine/cli.mjs';

const guide=fileURLToPath(new URL('./QUICKSTART.md',import.meta.url));
export const MENU=[['1','Check this Linux desktop'],['2','Create a task-account workspace'],['3','Connect OpenClaw and set budgets'],['4','Inspect connection and capability status'],['5','Register an installed application'],['6','Run one authorized encrypted job'],['7','Stop work'],['8','Review operating records'],['9','Resume after reviewing a stop'],['10','Install the optional queue service'],['11','Start the installed queue service'],['12','Read the setup guide'],['13','Draft a job from both runtime descriptors'],['0','Exit']];
export function friendlyError(error) {
  const code=/^(WORKFORCE|COMPUTER|EXECUTION)_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'WORKSTATION_COMMAND_FAILED';
  const advice={WORKFORCE_X11_SESSION_REQUIRED:'Log into the dedicated account with an X11 desktop. Wayland and a headless SSH shell are not supported.',WORKFORCE_LINUX_TASK_ACCOUNT_REQUIRED:'Use a dedicated non-root Linux account. Keep the operator signing key in a separate account.',WORKFORCE_STOP_REQUESTED:'Review operating records and cleanup first, then choose Resume. Starting again does not renew authority.',WORKFORCE_SECRET_PERMISSIONS:'Private configuration/key files must belong to this account and have permissions 600; private folders need 700.',WORKFORCE_CONFIG_SCOPE:'Finish Connect OpenClaw before running a job.',WORKFORCE_REVOCATION_REQUIRED:'Supply the current operator-signed authority record at the configured authority path.',WORKFORCE_SCOPED_BROKER_ADAPTER_REQUIRED:'Fine-grained broker permissions are unavailable. Use separately reviewed whole-account authority or an observe-only job.',WORKFORCE_DEDICATED_NONROOT_ACCOUNT_REQUIRED:'Use a dedicated non-root task account. Keep the operator signer elsewhere.',WORKFORCE_UNPRIVILEGED_ACCOUNT_REQUIRED:'Use a standard task account without sudo/admin membership.',WORKFORCE_X11_SESSION_REQUIRED_WAYLAND_NOT_QUALIFIED:'Log into the dedicated account using an X11 desktop. Wayland is not qualified.',WORKFORCE_LOCAL_X11_DISPLAY_REQUIRED:'Run from the local primary X11 desktop, not an SSH-forwarded display.',WORKFORCE_PRIVATE_DESKTOP_BUS_REQUIRED:'Use this account’s real interactive desktop session with its private session bus.',WORKFORCE_PRIVATE_COMPUTE_HOME_REQUIRED:'Use an account with a privately owned home directory and no writable directory links.',WORKFORCE_LINUX_GLIBC_X64_ARM64_REQUIRED:'This candidate requires glibc Linux on x86-64 or ARM64.',WORKFORCE_DRAFT_EXPLICIT_WHOLE_ACCOUNT_REQUIRED:'Creating deliverables requires desktop input. Explicitly request whole-account authority for this draft, then review the exact permissions before the separate signing step.',WORKFORCE_DRAFT_RECIPIENTS_MUST_MATCH:'Exchange authorized public recipient keys with add-recipient in both environments, then export fresh descriptors.',WORKFORCE_WORKER_STILL_RUNNING:'Wait for the active worker to stop and finish cleanup before resuming.',WORKFORCE_PRIVATE_RUNTIME_DIRECTORY_REQUIRED:'Log into the task account normally so its private /run/user/<uid> runtime exists.',WORKFORCE_OWNED_DESKTOP_BUS_REQUIRED:'Use the task account’s own desktop session bus, not a shared or sudo-switched desktop.',WORKFORCE_OWNED_XAUTHORITY_REQUIRED:'Use this task account’s own private Xauthority file from its normal login session.',WORKFORCE_LINUX_PREVIEW_V3_REQUIRED:'Use draft-job to create a version 3 job with explicit permissions, privacy and revocable authority.',WORKFORCE_LINUX_PREVIEW_PILOT_ONLY:'This Linux candidate supports pilot packets only; production qualification is not implemented.',WORKFORCE_SERVICE_EXISTS:'The queue service already exists. Use Start or inspect the existing unit; it will not be overwritten.'};
  return code+'\n'+(advice[code]??'No successful completion is being claimed. Check QUICKSTART.md and the saved operating records before retrying.');
}
export async function launch({input=process.stdin,output=process.stdout,run=main}={}) {
  if(!input.isTTY && input===process.stdin) {output.write('AGI Linux authorized workstation\nUse an interactive terminal for the guided menu.\nFor commands: npm run workforce -- help\nGuide: '+guide+'\n');return;}
  const rl=createInterface({input,output});
  let config=path.join(os.homedir(),'agi-workstation-agent','native-config.json');
  const ask=async(label,fallback)=>{const answer=(await rl.question(label+(fallback?' ['+fallback+']':'')+': ')).trim();return answer||fallback||'';};
  const chooseConfig=async()=>{config=await ask('Absolute native-config.json path',config);return config;};
  output.write('\nAGI Linux authorized workstation · development candidate\nWork in a dedicated task account with its own apps and logins.\nDesktop control can operate the whole account. Keep your signer elsewhere.\nPhysical qualification is not established by this menu.\n');
  try {
    for(;;) {
      output.write('\n'+MENU.map(([key,label])=>key+'. '+label).join('\n')+'\n');
      const choice=await ask('Choose an action','0');
      if(choice==='0')return;
      try {
        if(choice==='1')await run(['preflight']);
        else if(choice==='2') {
          const role=await ask('Role: agent or reviewer','agent'),dir=await ask('New empty absolute private folder',path.join(os.homedir(),'agi-workstation-'+role));
          const key=await ask('Operator PUBLIC key path (never its private key)'),installation=await ask('Canonical installed OpenClaw npm package directory');
          const model=await ask('Exact model id available to your provider','openai/gpt-6-astra');
          await run(['init','--dir',dir,'--role',role,'--operator-public-key',key,'--installation',installation,'--model',model]);config=path.join(dir,'native-config.json');
        } else if(choice==='3') {
          const args=['bind','--config',await chooseConfig()];
          for(const [flag,label,fallback]of [['gateway-config','Actual private OpenClaw gateway JSON path'],['node-id','Paired node id from OpenClaw'],['account-label','Dedicated task-account label'],['authority-file','Absolute signed authority record path'],['model-call-reserve','USDC reserve per model call'],['action-reserve','USDC reserve per desktop action'],['fixed-run-reserve','USDC fixed reserve per run'],['daily-reserve','Maximum daily USDC reserve']])args.push('--'+flag,await ask(label,fallback));
          args.push('--provider','cua-computer');await run(args);
        } else if(choice==='4') {
          const file=await chooseConfig();await run(['status','--config',file]);
          if(await ask('Also check the live gateway/provider? yes/no','no')==='yes')await run(['doctor','--config',file]);
        } else if(choice==='5')await run(['bind-app','--config',await chooseConfig(),'--app',await ask('Canonical executable path'),'--id',await ask('Application id, for example libreoffice')]);
        else if(choice==='6') {
          const file=await chooseConfig(),packet=await ask('Encrypted operator-approved job packet path'),recipient=await ask('Recipient decryption-key path in this task account');
          output.write('The job may control every app in this account within its signed authority. Confidential results stay encrypted; this does not submit a public blockchain job.\n');
          if(await ask('Run this packet now? type RUN','no')==='RUN')await run(['run','--config',file,'--packet',packet,'--recipient-key',recipient]);
        } else if(choice==='7')await run(['stop','--config',await chooseConfig()]);
        else if(choice==='8')await run(['operations','--config',await chooseConfig()]);
        else if(choice==='9') {
          const file=await chooseConfig();output.write('Review failed/uncertain actions and cleanup first. Recovery-required state must be resolved. Resuming does not start work or renew grants.\n');
          if(await ask('Clear the stop marker? type RESUME','no')==='RESUME')await run(['resume','--config',file,'--acknowledge','true']);
        } else if(choice==='10')await run(['install-service','--config',await chooseConfig(),'--recipient-key',await ask('Recipient decryption-key path')]);
        else if(choice==='11')await run(['service-start','--config',await chooseConfig()]);
        else if(choice==='12')output.write('\n'+fs.readFileSync(guide,'utf8')+'\n');
        else if(choice==='13') {
          const file=await chooseConfig(),reviewer=await ask('Reviewer descriptor JSON path'),chain=await ask('Settlement chain id','1'),manager=await ask('Settlement manager address');
          const authority=await ask('Creating files requires desktop input: type whole-account to request that authority in the draft');
          if(authority==='whole-account')output.write('This draft requests interaction with the whole dedicated account for both roles. The operator must review and sign the exact job before execution.\n');
          await run(['draft-job','--config',file,'--reviewer-descriptor',reviewer,'--chain-id',chain,'--manager',manager,'--authority',authority,'--title',await ask('Job title','Inspect the dedicated test workspace'),'--prompt',await ask('Complete job brief'),'--output',await ask('Output filename','report.md'),'--out',await ask('New draft job JSON path')]);
        }
        else output.write('Choose one of the numbered actions.\n');
      } catch(error) {output.write(friendlyError(error)+'\n');}
    }
  } finally {rl.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const work=process.argv.length>2?main(process.argv.slice(2)):launch();
  work.catch(error=>{console.error(friendlyError(error));process.exitCode=1;});
}
