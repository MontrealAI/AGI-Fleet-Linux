#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {main} from './cli.mjs';

const guide=fileURLToPath(new URL('./QUICKSTART.md',import.meta.url));
export const MENU=[['1','Check this Mac account'],['2','Create a private task workspace'],['3','Connect the Mac provider and set budgets'],['4','Check connection status'],['5','Register a signed Mac application'],['6','Export a runtime descriptor'],['7','Draft a job for Agent and reviewer'],['8','Run one approved encrypted pilot job'],['9','Stop work'],['10','Review operating records'],['11','Resume after reviewing a stop'],['12','Read the setup guide'],['0','Exit']];
export function friendlyError(error){
  const code=/^(?:WORKFORCE|MAC|MACOS|COMPUTER|EXECUTION)_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'WORKSTATION_COMMAND_FAILED';
  const advice={MAC_APPLE_SILICON_REQUIRED:'Use the native Apple silicon Node runtime on an M1/M2 Mac.',MAC_NATIVE_EXECUTION_REQUIRED:'Reopen in native Apple silicon mode; Rosetta is unsupported.',MACOS_15_REQUIRED:'This preview requires macOS 15 or later.',WORKFORCE_MAC_STANDARD_ACCOUNT_REQUIRED:'Use a dedicated Standard account. Keep the signing operator and personal logins elsewhere.',WORKFORCE_MAC_ACCOUNT_OBSERVATION_FAILED:'The account could not be inspected. Stop and ask your helper to review it.',WORKFORCE_OPERATOR_STOP:'Inspect cleanup and operating records before choosing Resume.',WORKFORCE_DRAFT_EXPLICIT_WHOLE_ACCOUNT_REQUIRED:'Creating files requires explicit whole-account authority in the draft. Review it before signing.',WORKFORCE_DRAFT_RECIPIENTS_MUST_MATCH:'Exchange recipient public keys and export fresh descriptors for both roles.',WORKFORCE_MAC_PREVIEW_PILOT_ONLY:'Production execution is disabled in this source preview.',WORKFORCE_MAC_PREVIEW_V3_REQUIRED:'Use a v3 job with explicit permissions, recipient policy and signed revocable authority.',WORKFORCE_WORKER_STILL_RUNNING:'Wait for the active worker to stop and finish cleanup.',WORKFORCE_RECOVERY_REQUIRED:'Preserve the recovery marker and resolve the original execution through recover first.'};
  return code+'\n'+(advice[code]??'Review the setup guide and retained operating records. No successful completion is being claimed.');
}
export async function launch({input=process.stdin,output=process.stdout,run=main}={}){
  if(input===process.stdin&&!input.isTTY){output.write('AGI Mac source preview\nUse an interactive terminal for the guided menu.\nCommands: npm run workforce -- help\nGuide: '+guide+'\nProduction execution is disabled.\n');return;}
  const rl=createInterface({input,output});let config=path.join(os.homedir(),'agi-mac-preview-agent','native-config.json');
  const ask=async(label,fallback='')=>(await rl.question(label+(fallback?' ['+fallback+']':'')+': ')).trim()||fallback;
  const choose=async()=>config=await ask('Absolute native-config.json path',config);
  output.write('\nAGI Mac source preview · controlled pilot only\nUse a dedicated Standard task account. Desktop control can reach everything in that account.\nKeep the signing key in a different account. This menu does not qualify a physical Mac.\n');
  try{for(;;){
    output.write('\n'+MENU.map(([key,label])=>key+'. '+label).join('\n')+'\n');const choice=await ask('Choose an action','0');if(choice==='0')return;
    try{
      if(choice==='1')await run(['preflight']);
      else if(choice==='2'){
        const role=await ask('Role: agent or reviewer','agent'),dir=await ask('New empty absolute private folder',path.join(os.homedir(),'agi-mac-preview-'+role));
        await run(['init','--dir',dir,'--role',role,'--operator-public-key',await ask('Operator PUBLIC key path; keep its private key elsewhere'),'--app',await ask('Signed OpenClaw Mac app path','/Applications/OpenClaw.app'),'--model',await ask('Exact provider model id','openai/gpt-6-astra')]);config=path.join(dir,'native-config.json');
      }else if(choice==='3'){
        const args=['bind','--config',await choose()];
        for(const [flag,label]of [['gateway-config','Private gateway JSON path'],['node-id','Actual approved paired Mac node id'],['provider','Actual computer-use provider id'],['account-label','Dedicated task-account label'],['authority-file','Absolute signed authority record path'],['model-call-reserve','USDC reserve per model call'],['action-reserve','USDC reserve per desktop action'],['fixed-run-reserve','USDC fixed reserve per run'],['daily-reserve','Maximum daily USDC reserve']])args.push('--'+flag,await ask(label));
        await run(args);
      }else if(choice==='4'){
        const file=await choose();await run(['status','--config',file]);if(await ask('Also inspect the actual gateway/provider? yes/no','no')==='yes')await run(['doctor','--config',file]);
      }else if(choice==='5')await run(['bind-app','--config',await choose(),'--app',await ask('Installed signed application .app path')]);
      else if(choice==='6')await run(['descriptor','--config',await choose(),'--out',await ask('New descriptor JSON path')]);
      else if(choice==='7'){
        const file=await choose(),reviewer=await ask('Independent reviewer descriptor JSON path'),chain=await ask('Settlement chain id','1'),manager=await ask('Reviewed settlement manager address');
        const authority=await ask('Creating files needs desktop input: type whole-account to request that authority in this draft');
        output.write('The draft creates no authority or payment. Review both roles’ full account access, data, recipients and budgets before the separate signing step.\n');
        await run(['draft-job','--config',file,'--reviewer-descriptor',reviewer,'--chain-id',chain,'--manager',manager,'--authority',authority,'--title',await ask('Job title','Inspect the dedicated test workspace'),'--prompt',await ask('Complete job brief'),'--output',await ask('Output filename','report.md'),'--out',await ask('New draft JSON path')]);
      }else if(choice==='8'){
        const file=await choose(),packet=await ask('Operator-approved encrypted pilot packet path'),key=await ask('Recipient decryption-key path in this task account');
        output.write('This packet may control the dedicated account. Private results remain encrypted; no on-chain job or payment is submitted.\n');
        if(await ask('Run this packet now? type RUN','no')==='RUN')await run(['run','--config',file,'--packet',packet,'--recipient-key',key]);
      }else if(choice==='9')await run(['stop','--config',await choose()]);
      else if(choice==='10')await run(['operations','--config',await choose()]);
      else if(choice==='11'){
        const file=await choose();output.write('Inspect failed or uncertain actions and resolve cleanup first. Resume only clears STOP; it does not run work or renew a grant.\n');
        if(await ask('Clear the stop marker? type RESUME','no')==='RESUME')await run(['resume','--config',file,'--acknowledge','true']);
      }else if(choice==='12')output.write('\n'+fs.readFileSync(guide,'utf8')+'\n');
      else output.write('Choose a numbered action.\n');
    }catch(error){output.write(friendlyError(error)+'\n');}
  }}finally{rl.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (process.argv.length>2?main(process.argv.slice(2)):launch()).catch(error=>{console.error(friendlyError(error));process.exitCode=1;});
}
