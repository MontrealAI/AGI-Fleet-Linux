import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const helper=fs.readFileSync(path.join(root,'scripts/node-runtime.sh'),'utf8');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi launcher test '));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const script=path.join(dir,'node shim.mjs');
  fs.writeFileSync(script,`import fs from 'node:fs';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
if(process.argv[2]==='-e') { Object.defineProperty(process.versions,'node',{value:process.env.AGI_FIXTURE_VERSION}); const code=process.argv[3];process.argv=[process.execPath,...process.argv.slice(4)];eval(code); }
else fs.writeFileSync(process.env.AGI_LAUNCH_CAPTURE,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),path:process.env.PATH}));
`);
  const make=(version,name=version)=>{
    const executable=path.join(dir,name,'node');fs.mkdirSync(path.dirname(executable),{recursive:true});
    fs.writeFileSync(executable,`\x23!/bin/sh\nAGI_FIXTURE_VERSION=${quote(version)} exec ${quote(process.execPath)} ${quote(script)} "$@"\n`,{mode:0o755});
    return executable;
  };
  const helperPath=path.join(dir,'node-runtime.sh');fs.writeFileSync(helperPath,helper);
  return {dir,make,helperPath};
}

test('runtime selection enforces the application range and handles executable paths with spaces',t=>{
  const f=fixture(t);
  for(const version of ['22.21.0','24.18.9','24.19.0-rc.1','25.0.0','26.1.0','24.19.0','24.21.0']) {
    const executable=f.make(version,'runtime '+version);
    const result=spawnSync('/bin/sh',['-c','. "$1"; shift; agi_require_node_24 "$@" && printf "%s" "$AGI_RUNTIME_NODE"','selector',f.helperPath,executable],{encoding:'utf8'});
    const accepted=['24.19.0','24.21.0'].includes(version);
    assert.equal(result.status,accepted?0:1,version+': '+result.stderr);
    if(accepted) assert.equal(result.stdout,executable);
    else assert.match(result.stderr,/24\.19\.0 or later within 24\.x is required/);
  }
});

test('unsupported or missing installations do not mask a later compatible Node',t=>{
  const f=fixture(t),bad=f.make('26.1.0'),good=f.make('24.19.0','supported official install');
  const result=spawnSync('/bin/sh',['-c','. "$1"; shift; agi_require_node_24 "$@" && printf "%s" "$AGI_RUNTIME_NODE"','selector',f.helperPath,path.join(f.dir,'missing'),bad,good],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,good);
});

test('each standalone companion ships the identical runtime selector',()=>{
  for(const role of ['Agent','Node']) assert.equal(fs.readFileSync(path.join(root,`packages/AGI_${role}/scripts/node-runtime.sh`),'utf8'),helper);
});

test('shell launchers preserve role, profile, installer arguments and child PATH with a mixed installation',t=>{
  const f=fixture(t),bad=f.make('26.1.0'),good=f.make('24.21.0','Node 24 installed here');
  const stage=path.join(f.dir,'Release with spaces');fs.mkdirSync(stage);
  const controlled=helper.replace(/^    set -- .+$/m,`    set -- ${quote(bad)} ${quote(good)}`);
  assert.notEqual(controlled,helper);
  for(const app of ['', 'packages/AGI_Agent', 'packages/AGI_Node']) {
    const scripts=path.join(stage,app,'scripts');fs.mkdirSync(scripts,{recursive:true});fs.writeFileSync(path.join(scripts,'node-runtime.sh'),controlled);fs.copyFileSync(path.join(root,app,'package.json'),path.join(stage,app,'package.json'));
  }
  const cases=[];
  for(const role of ['Employer','Moderator','Recovery','Evidence']) for(const ext of ['command','sh']) cases.push([`Launch-${role}.${ext}`,[],['ops/launch.mjs','--role',role.toLowerCase()]]);
  for(const role of ['Employer','Moderator','Recovery']) cases.push([`Launch-${role}-Seed-Wallet.command`,[],['ops/launch.mjs','--role',role.toLowerCase(),'--seed-profile']]);
  cases.push(['Verify-Package.command',[],[path.join(stage,'scripts/verify.mjs')]],['Practice-Offline.command',[],['tests/demo.mjs']]);
  const setupArgs=['/private location/setup file.json','--selftest-only','--non-interactive'];
  cases.push(['Setup-OpenClaw.command',setupArgs,['scripts/setup-openclaw.mjs',...setupArgs],true]);
  for(const app of ['', 'packages/AGI_Agent', 'packages/AGI_Node']) for(const ext of ['command','sh']) cases.push([`${app?app+'/':''}Launch-Native-Workforce.${ext}`,[],['workforce/cli.mjs','menu']]);
  for(const role of ['Agent','Node']) {
    const app=`packages/AGI_${role}`,absolute=path.join(stage,app);
    for(const ext of ['command','sh']) cases.push([`${app}/Setup-OpenClaw.${ext}`,setupArgs,[path.join(absolute,'scripts/setup-openclaw.mjs'),...setupArgs],true]);
    cases.push([`${app}/Launch-AGI-${role}.sh`,[],['src/launch.mjs']]);
    cases.push([`${app}/AGI ${role}.app/Contents/MacOS/start`,['--seed-profile'],[path.join(absolute,'src/launch-helper.mjs'),'--seed-profile']]);
    for(const [name,entry,extra] of [['Launch-Fleet-Monitor','monitor.mjs',[]],['Open-Fleet-Monitor','open.mjs',[]],['Setup-Supervised-Monitor','supervised.mjs',[]],['Remove-Supervised-Monitor','supervised.mjs',['--remove']]]) cases.push([`${app}/fleet/${name}.command`,[],[path.join(absolute,'fleet',entry),...extra]]);
  }
  for(const ext of ['command','sh']) cases.push([`packages/AGI_Node/Launch-Demo.${ext}`,[],['src/cli.mjs','demo']]);
  for(const app of ['', 'packages/AGI_Agent', 'packages/AGI_Node']) cases.push([`${app?app+'/':''}Resume-Fresh-OAuth.command`,['/private original kit/setup.json'],[path.join(stage,app,'scripts/setup-openclaw.mjs'),'--resume-fresh-oauth','/private original kit/setup.json'],true]);
  for(const app of ['', 'packages/AGI_Agent', 'packages/AGI_Node'])for(const [name,flag] of [['Continue-Standard-Install','--continue-standard-install'],['Retry-Standard-Install','--retry-standard-install'],['Retry-Verified-Install','--retry-verified-install'],['Retry-Clean-Install','--retry-clean-install']])cases.push([`${app?app+'/':''}${name}.command`,['/private original kit/setup.json'],[app?path.join(stage,app,'scripts/setup-openclaw.mjs'):'scripts/setup-openclaw.mjs',flag,'/private original kit/setup.json'],true]);
  for(const [relative,args,expected,checkPath] of cases) {
    const target=path.join(stage,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target);
    const capture=path.join(f.dir,'capture.json');fs.rmSync(capture,{force:true});
    const result=spawnSync('/bin/bash',[target,...args],{cwd:f.dir,encoding:'utf8',input:'\n',env:{...process.env,AGI_LAUNCH_CAPTURE:capture},timeout:10000});
    assert.equal(result.status,0,relative+': '+result.stderr);
    assert.equal(fs.existsSync(capture),true,relative+' did not execute selected runtime');
    const observed=JSON.parse(fs.readFileSync(capture));assert.deepEqual(observed.args,expected,relative);
    if(checkPath) assert.equal(observed.path.split(path.delimiter)[0],path.dirname(good),relative+' must keep child OpenClaw/npm on the selected runtime');
  }
});
