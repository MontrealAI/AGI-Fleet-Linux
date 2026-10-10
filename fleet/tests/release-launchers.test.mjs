import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { temp } from './helpers.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname);
for(const [name,cwd,entry,record,args] of [
  ['Agent',path.join(root,'packages/AGI_Agent'),'src/launch.mjs','launch.json',[]],
  ['Node',path.join(root,'packages/AGI_Node'),'src/launch.mjs','launch.json',[]],
  ['Fleet',root,'ops/launch.mjs','panel.json',['--role','evidence']],
]) test(`${name} release entry point opens a real loopback panel and shuts down cleanly`,async()=>{
  const home=temp(),child=spawn(process.execPath,[entry,'--home',home,'--port','0','--no-open',...args],{cwd,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4096);});child.stdout.resume();
  const exited=once(child,'exit');
  try {
    const file=path.join(home,record),until=Date.now()+12000;
    while(!fs.existsSync(file) && child.exitCode===null && Date.now()<until) await new Promise(r=>setTimeout(r,30));
    assert.equal(fs.existsSync(file),true,`Launcher did not create its panel: ${stderr}`);
    const saved=JSON.parse(fs.readFileSync(file)),origin=saved.url?new URL(saved.url).origin:`http://127.0.0.1:${saved.port}`;
    const r=await fetch(origin+'/');assert.equal(r.status,200);assert.match(await r.text(),/<!doctype html>/i);
    child.kill('SIGTERM');const [code]=await exited;assert.equal(code,0,stderr);
  } finally {if(child.exitCode===null) {child.kill('SIGKILL');await exited;}fs.rmSync(home,{recursive:true,force:true});}
});
