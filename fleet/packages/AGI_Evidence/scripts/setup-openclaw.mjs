import {setupCapable} from '../compute/setup.mjs';
import {readSetupArguments,validateHandoffFile} from '../compute/setup-ledger.mjs';
import {openCompletionPanel} from '../compute/setup-completion.mjs';
import {safeSetupFailure} from '../compute/setup-auth.mjs';
import {safeFailureFields} from '../compute/setup-failure-report.mjs';
import {setupRole} from '../compute/roles.mjs';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';import os from 'node:os';
process.umask(0o077);const rl=createInterface({input:process.stdin,output:process.stdout});
try{const options=readSetupArguments(process.argv.slice(2));console.log('AGI Evidence Setup — '+(options.assuranceMode==='standard'?'Standard Install · RECOMMENDED':'Advanced installation'));
let file=options.file??await rl.question('Drag AGI-Evidence-OpenClaw-Setup.json here, then press Return: ');file=file.trim().replace(/^['"]|['"]$/g,'').replace(/\\([ ()])/g,'$1');
const kit=validateHandoffFile(file,{repairPermissions:!options.cleanInstall});if(setupRole(kit)!=='evidence')throw Error('OPENCLAW_SETUP_FILE');
const result=await setupCapable(kit,rl,{filePath:path.resolve(file),...options});rl.close();
if(result?.supportReport&&process.stdin.isTTY){const panel=await openCompletionPanel(result.supportReport,{directory:path.join(os.homedir(),'.agi-genesis-setup-evidence')});await panel.completed;}
}catch(error){const failure=safeFailureFields(error);console.error(JSON.stringify({...failure,failureCode:failure.failureCode??safeSetupFailure(error),supportReport:typeof error.supportReport==='string'?error.supportReport:null}));process.exitCode=1;}finally{rl.close();}
