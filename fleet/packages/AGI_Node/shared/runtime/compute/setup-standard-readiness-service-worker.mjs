// Verified pinned API rendering only: no service writes, launchctl or SQLite.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {managedServiceEnvironmentFile} from './setup-managed-service.mjs';
try{
 const {packageRoot,env,config,node,openclaw,port,wrapperPath,authority}=JSON.parse(fs.readFileSync(0,'utf8'));process.argv=[node,openclaw];
 const load=file=>import(pathToFileURL(path.join(packageRoot,'dist',file)));
 const {t:build}=await load('daemon-install-helpers-BQ0CTd58.mjs'),{d:shell,f:plist}=await load('launchd-system-CluF7Uz3.mjs'),{f:description}=await load('constants-CJCmIHb-.mjs'),{o:logs}=await load('restart-logs-DcfskF2f.mjs');
 const warnings=[],plan=await build({env,config,authStore:{version:1,profiles:{}},runtime:'node',platform:'darwin',devMode:false,port,wrapperPath,warn:m=>warnings.push(m)});
 plan.environment.OPENCLAW_WRAPPER=env.OPENCLAW_WRAPPER;
 if(warnings.length||createHash('sha256').update(managedServiceEnvironmentFile(plan.environment)).digest('hex')!==authority.environmentSHA256)throw Error('render mismatch');
 const {stdoutPath}=logs(env,{platform:'darwin'}),label=authority.label,dir=path.join(env.OPENCLAW_STATE_DIR,'service-env');
 process.stdout.write(plist({label,comment:description({env,description:plan.description}),programArguments:[shell,path.join(dir,label+'-env-wrapper.sh'),path.join(dir,label+'.env'),...plan.programArguments],workingDirectory:plan.workingDirectory,stdoutPath,stderrPath:stdoutPath}));
}catch{process.stderr.write('SETUP_MANAGED_SERVICE_RENDER_FAILED\n');process.exitCode=1;}
