// SPDX-License-Identifier: MIT
// Private child process: emits only its loopback address, never credentials.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [application,state,profile]=process.argv.slice(2);
for(const value of [application,state,profile])if(!path.isAbsolute(value??''))throw Error('ABSOLUTE_SERVICE_PATHS_REQUIRED');
process.umask(0o077);
const {LocalRuntime}=await import(pathToFileURL(path.join(application,'local-runtime/supervisor/runtime.mjs')));
const {createServer}=await import(pathToFileURL(path.join(application,'local-runtime/supervisor/server.mjs')));
const fresh=!fs.existsSync(path.join(state,'ledger.sqlite'));
const runtime=new LocalRuntime(state,{create:fresh,computerConfigFile:profile});
if(fresh){const operator=runtime.issueClient();fs.writeFileSync(path.join(state,'operator.token'),operator.token,{flag:'wx',mode:0o600});}
const principal=runtime.authenticate(fs.readFileSync(path.join(state,'operator.token'),'utf8'));
const ipc=createServer(runtime);console.log(JSON.stringify(await ipc.start()));
let closing=false;
async function shutdown(){if(closing)return;closing=true;await runtime.dispatch('stop',{actor:null},principal);await new Promise(resolve=>ipc.server.close(resolve));runtime.store.close();}
process.on('SIGTERM',()=>shutdown().then(()=>process.exit(0),()=>process.exit(1)));
process.on('SIGINT',()=>shutdown().then(()=>process.exit(0),()=>process.exit(1)));
