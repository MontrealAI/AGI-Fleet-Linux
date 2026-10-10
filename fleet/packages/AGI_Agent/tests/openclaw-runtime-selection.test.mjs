import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {selectOpenClawRuntime,runSelectedOpenClaw,selectedOpenClawEnvironment,openClawShellCommand} from '../compute/openclaw-runtime-selection.mjs';

function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),"agi setup runtime ' "));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const bin=path.join(home,'.agi-genesis-runtime/openclaw-2026.9.5/node_modules/.bin'),entry=path.join(home,'.agi-genesis-runtime/openclaw-2026.9.5/node_modules/openclaw/openclaw.mjs'),old=path.join(home,'.local/bin/openclaw');
 for(const file of [entry,old,path.join(bin,'openclaw')])fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(entry,`\x23!/usr/bin/env node\nif(process.argv[2]==='--version')console.log('OpenClaw 2026.9.5 fixture');else console.log(JSON.stringify({args:process.argv.slice(2),node:process.execPath,path:process.env.PATH,home:process.env.HOME,foreignProfile:process.env.OPENCLAW_STATE_DIR??null,secret:process.env.OPENAI_API_KEY??null,nodeOptions:process.env.NODE_OPTIONS??null}));\n`,{mode:0o700});
 fs.symlinkSync(entry,path.join(bin,'openclaw'));fs.writeFileSync(old,'\x23!/bin/sh\nprintf "OpenClaw 2026.9.5 old\\n"\n',{mode:0o700});
 const node=path.join(home,'node');fs.writeFileSync(node,"\x23!/bin/sh\nexec '"+process.execPath.replaceAll("'","'\\''")+"' \"$@\"\n",{mode:0o700});
 return {home,entry,old,node,options:{home,node,pathValue:path.dirname(old),verifyArtifact:file=>{assert.equal(file,entry);return {version:'2026.9.5',scope:'test fixture only'};}}};
}

test('setup selects the private verified target without Docker or replacing the old global runtime',t=>{
 const f=fixture(t),before=fs.readFileSync(f.old),runtime=selectOpenClawRuntime(f.options);
 assert.equal(runtime.openclaw,path.join(path.dirname(f.entry),'../.bin/openclaw'));
 assert.equal(runtime.executableIdentity.openclaw.realPath,f.entry);assert.equal(runtime.docker,undefined);
 const response=runSelectedOpenClaw(runtime,['config','validate','literal argument'],{capture:true});assert.equal(response.status,0,response.stderr);
 const observed=JSON.parse(response.stdout);assert.deepEqual(observed.args,['config','validate','literal argument']);assert.equal(observed.node,process.execPath);assert.equal(observed.home,f.home);
 assert.deepEqual(fs.readFileSync(f.old),before);assert.equal(fs.existsSync(path.join(f.home,'.openclaw')),false);
});

test('selected setup environment excludes ambient credentials and foreign profile configuration',t=>{
 const f=fixture(t),runtime=selectOpenClawRuntime(f.options),env=selectedOpenClawEnvironment(runtime,{PATH:'/foreign/bin',HOME:'/foreign/home',OPENAI_API_KEY:'secret',OPENCLAW_STATE_DIR:'/foreign/state',NODE_OPTIONS:'--require=foreign',TERM:'xterm'});
 assert.equal(env.HOME,f.home);assert.equal(env.TERM,'xterm');for(const k of ['OPENAI_API_KEY','OPENCLAW_STATE_DIR','NODE_OPTIONS'])assert.equal(env[k],undefined);
 assert.equal(env.PATH.split(path.delimiter)[0],path.dirname(f.node));assert(!env.PATH.includes('/foreign/bin'));
});

test('direct follow-up commands quote selected absolute Node and CLI paths and literal arguments',t=>{
 const f=fixture(t),runtime=selectOpenClawRuntime(f.options),args=['--profile','example',"quote' and spaces",'$HOME; no command substitution'];
 const command=openClawShellCommand(runtime,args),result=spawnSync('/bin/sh',['-c',command],{encoding:'utf8',env:selectedOpenClawEnvironment(runtime),timeout:5000});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).args,args);assert(command.includes(f.node.replaceAll("'","'\\''")));assert(command.includes('openclaw.mjs'));
});

test('setup refuses unpinned artifacts and Node26 before invoking the selected OpenClaw',t=>{
 const f=fixture(t);let calls=0;
 assert.throws(()=>selectOpenClawRuntime({...f.options,verifyArtifact:()=>{throw Error('OPENCLAW_ARTIFACT_MISMATCH');},run:(_file,args)=>{calls++;assert.deepEqual(args,['--version']);return {status:0,stdout:'v24.21.0'};}}),/OPENCLAW_ARTIFACT_MISMATCH/);assert.equal(calls,1);
 calls=0;assert.throws(()=>selectOpenClawRuntime({...f.options,verifyArtifact:()=>{throw Error('must not verify');},run:()=>{calls++;return {status:0,stdout:'v26.0.0'};}}),/NODE_VERSION_UNSUPPORTED/);assert.equal(calls,1);
 assert.throws(()=>selectOpenClawRuntime({...f.options,verifyArtifact:()=>({version:'2026.9.6'})}),/OPENCLAW_ARTIFACT_MISMATCH/);
});

test('a writable private runtime or a changed admitted executable fails before command execution',t=>{
 const f=fixture(t);fs.chmodSync(f.entry,0o777);assert.throws(()=>selectOpenClawRuntime(f.options),/OPENCLAW_EXECUTABLE_UNTRUSTED/);fs.chmodSync(f.entry,0o700);
 const runtime=selectOpenClawRuntime(f.options);fs.appendFileSync(f.entry,'// drift\n');let invoked=false;
 assert.throws(()=>runSelectedOpenClaw(runtime,['config','validate'],{run:()=>{invoked=true;}}),/COMPUTE_RUNTIME_EXECUTABLE_CHANGED/);assert.equal(invoked,false);
});
