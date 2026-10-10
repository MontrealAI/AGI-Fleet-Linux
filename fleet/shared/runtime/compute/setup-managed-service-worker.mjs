// The default mode renders read-only. Preparation writes pinned service files
// without loading. Neither mode executes shell files or opens profile databases.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
try {
 const {packageRoot,env,config,wrapperPath,node,openclaw,port,write,expectedEnvironmentSHA256}=JSON.parse(fs.readFileSync(0,'utf8'));
 process.argv=[node,openclaw];
 const {t:buildGatewayInstallPlan}=await import(pathToFileURL(path.join(packageRoot,'dist/daemon-install-helpers-BQ0CTd58.mjs')));
 const warnings=[];
 const plan=await buildGatewayInstallPlan({env,config,authStore:{version:1,profiles:{}},runtime:'node',platform:'darwin',devMode:false,port,wrapperPath,warn:message=>warnings.push(message)});
 // The private candidate wrapper is used only to satisfy upstream's existence
 // check. The rendered launch authority must reference the approved live path.
 plan.environment.OPENCLAW_WRAPPER=env.OPENCLAW_WRAPPER;
 if(write){
  const {managedServiceEnvironmentFile}=await import('./setup-managed-service.mjs');
  const {createHash}=await import('node:crypto');
  if(wrapperPath!==env.OPENCLAW_WRAPPER||createHash('sha256').update(managedServiceEnvironmentFile(plan.environment)).digest('hex')!==expectedEnvironmentSHA256)throw Error('render mismatch');
  const {l:writeLaunchAgentPlist}=await import(pathToFileURL(path.join(packageRoot,'dist/launchd-service-files-Chcm4HTZ.mjs')));
  await writeLaunchAgentPlist({env,...plan});
  process.stdout.write(JSON.stringify({status:'prepared'}));
 }else process.stdout.write(JSON.stringify({environment:plan.environment}));
} catch { process.stderr.write('SETUP_MANAGED_SERVICE_RENDER_FAILED\n'); process.exitCode=1; }
