#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {selectRepairRole} from './repair-compute.mjs';
export async function main(args=process.argv.slice(2)){
 if(args.includes('--help')){console.log('Restart-Compute.command [--role agent|node]\nRestart the existing managed services in the Standard compute account without setup or configuration changes. Legacy profiles require reviewed repair. Both installed roles require an explicit --role or the companion launcher.');return 0;}
 const role=selectRepairRole(args),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'packages',role==='agent'?'AGI_Agent':'AGI_Node');
 const {restartMain}=await import(pathToFileURL(path.join(directory,'compute/restart.mjs')).href);return restartMain(args.includes('--role')?args:[...args,'--role',role]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(JSON.stringify(error.restartReport??{status:'BLOCKED',code:/^[A-Z_]+$/.test(error.message)?error.message:'RESTART_FAILED'}));process.exitCode=error.message==='RESTART_CANCELLED'||error.name==='AbortError'?130:2;});
