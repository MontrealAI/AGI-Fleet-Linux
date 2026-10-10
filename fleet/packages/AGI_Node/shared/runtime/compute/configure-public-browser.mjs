import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {makePublicBrowserPolicy} from './public-browser-config.mjs';
import {existingSetupKit} from './repair.mjs';
import {setupCapable} from './setup.mjs';

export async function configurePublicBrowser({role,proposalFile,rl,home=os.homedir(),setup=setupCapable,signal}){
 if(!['agent','node'].includes(role))throw Error('PUBLIC_BROWSER_ROLE_REQUIRED');
 const fd=fs.openSync(proposalFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let proposal;
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>8192)throw Error('PUBLIC_BROWSER_PROPOSAL_INVALID');proposal=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 const profileDir=path.join(home,role==='node'?'.openclaw-agi-node-compute':'.openclaw-agi-compute');
 const settings=JSON.parse(fs.readFileSync(path.join(profileDir,'compute-settings.json'),'utf8')),config=JSON.parse(fs.readFileSync(settings.gatewayConfig,'utf8'));
 makePublicBrowserPolicy({profileDir,previous:settings.publicWebPolicy,proposal});
 console.log('Protected public browser configuration. Commissioning allows only the separately approved fixed test fixture. Commercial public browsing remains blocked. Existing work and OAuth remain in the transactional repair. Services stop before publication; the exact policy change requires approval.');
 if((await rl.question('Type STOP AND REVIEW to prepare this configuration: ')).trim()!=='STOP AND REVIEW')throw Error('PUBLIC_BROWSER_CONFIGURATION_CANCELLED');
 const kit=existingSetupKit({...settings,model:config.agents?.defaults?.model?.primary},role);
 return setup(kit,rl,{repair:true,recoverLock:true,publicWebPolicyProposal:proposal,signal});
}
export async function configurePublicBrowserMain(args=process.argv.slice(2)){
 if(args.includes('--help')){console.log('Configure-Public-Browser.command --proposal FILE.json\nProposal: {"schema":"agi-public-browser-policy-proposal/v1","mode":"commissioning","browserImageID":"sha256:<64 hex>","proxyImageID":"sha256:<64 hex>","reviewerPublicKey":"<independently verified PUBLIC KEY PEM>"}\nUse mode "disabled" to return offline. Images must be built and reviewed first. The reviewer public key must be pinned before collecting qualification evidence; never use a private key. This runs a stopped transactional repair and asks for the exact security-diff approval. It does not authorize provider spending or prove qualification.');return;}
 let role,proposalFile;for(let i=0;i<args.length;i++){if(args[i]==='--role')role=args[++i];else if(args[i]==='--proposal')proposalFile=args[++i];else throw Error('PUBLIC_BROWSER_ARGUMENT_INVALID');}
 if(!proposalFile)throw Error('PUBLIC_BROWSER_PROPOSAL_REQUIRED');
 const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);const rl=createInterface({input:process.stdin,output:process.stdout});
 try{return await configurePublicBrowser({role,proposalFile,rl,signal:controller.signal});}finally{process.removeListener('SIGINT',abort);rl.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))configurePublicBrowserMain().catch(error=>{console.error(/^PUBLIC_[A-Z0-9_]+$/.test(error.message)?error.message:'PUBLIC_BROWSER_CONFIGURATION_FAILED');process.exitCode=1;});
