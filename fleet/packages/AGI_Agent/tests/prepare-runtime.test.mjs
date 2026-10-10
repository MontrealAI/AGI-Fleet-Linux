import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareRuntime as prepareRuntimeActual,privateRuntimePath,lockedRuntimePackage} from '../compute/prepare-runtime.mjs';

const prepareRuntime=options=>prepareRuntimeActual({...options,run:(exe,args,opts)=>args.includes('--probe')?{status:0,stdout:JSON.stringify({status:'ready'})}:args[0]?.endsWith('postinstall-bundled-plugins.mjs')?{status:0}:options.run(exe,args,opts)});

function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-private-runtime-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const bin=path.join(home,'bin');fs.mkdirSync(bin,{mode:0o700});
 const node=path.join(bin,'node'),npm=path.join(bin,'npm-cli.js');fs.writeFileSync(node,'\x23!/bin/sh\nexit 0\n',{mode:0o700});fs.writeFileSync(npm,'\x23!/usr/bin/env node\n',{mode:0o700});fs.symlinkSync(npm,path.join(bin,'npm'));
 const profile=path.join(home,'.openclaw-agi-compute');fs.mkdirSync(profile,{mode:0o700});fs.writeFileSync(path.join(profile,'oauth-sentinel'),'existing credentials stay local',{mode:0o600});
 const global=path.join(bin,'old-openclaw');fs.writeFileSync(global,'old runtime 2026.9.5',{mode:0o700});
 const before=()=>[fs.readFileSync(global,'utf8'),fs.readFileSync(path.join(profile,'oauth-sentinel'),'utf8')];
 const verifyArtifact=()=>({packageTarballSha256:'a'.repeat(64),packageInventorySha256:'b'.repeat(64)});
 return {home,node,before,options:{home,node,verifyArtifact,progress:()=>{}}};
}
test('consumer lock pins every registry artifact without a bundled integrity exception',()=>{
 const {lockBytes,packageBytes,lockSHA256}=lockedRuntimePackage(),lock=JSON.parse(lockBytes),pkg=JSON.parse(packageBytes);
 assert.equal(crypto.createHash('sha256').update(lockBytes).digest('hex'),lockSHA256);assert.match(pkg.dependencies.openclaw,/openclaw-2026\.9\.5\.tgz$/);
 for(const [name,value]of Object.entries(lock.packages)){if(!name)continue;assert.equal(value.inBundle,undefined);assert.match(value.resolved,/^https:\/\/registry\.npmjs\.org\//);assert.match(value.integrity,/^sha512-/);}
});
test('private preparation uses npm ci without lifecycle scripts and never touches existing runtime/profile',t=>{
 const f=fixture(t),before=f.before();let calls=0;
 const result=prepareRuntime({...f.options,run:(exe,args,opts)=>{
  calls++;assert.equal(exe,f.node);assert.equal(args[0],'--use-system-ca');assert.equal(args[2],'ci');for(const arg of ['--ignore-scripts','--omit=dev','--no-audit','--no-fund'])assert.ok(args.includes(arg));
  assert.equal(opts.shell,false);assert.ok(opts.cwd.startsWith(path.join(f.home,'.agi-genesis-runtime/.preparing-')));assert.equal(opts.env.NODE_OPTIONS,undefined);assert.equal(opts.env.npm_config_registry,undefined);return {status:0,stdout:'installed',stderr:''};
 }});
 assert.equal(result.path,privateRuntimePath(f.home));assert.equal(result.reused,false);assert.equal(calls,1);assert.deepEqual(f.before(),before);
 const receipt=JSON.parse(fs.readFileSync(path.join(result.path,'agi-runtime-receipt.json')));assert.equal(receipt.profileAccessed,false);assert.equal(receipt.globalInstallChanged,false);assert.equal(receipt.npmLifecycleScriptsRun,false);assert.equal(receipt.approvedPackageLifecycleCompletion,true);assert.equal(receipt.nativeRepairDownloadsAllowed,false);
 assert.equal(fs.statSync(result.path).mode&0o777,0o700);assert.equal(fs.statSync(path.join(result.path,'agi-runtime-receipt.json')).mode&0o777,0o600);
 const again=prepareRuntime({...f.options,run:()=>{throw Error('must not reinstall');}});assert.equal(again.reused,true);
});
test('failed download retains staging evidence and preserves old runtime and profile',t=>{
 const f=fixture(t),before=f.before();assert.throws(()=>prepareRuntime({...f.options,run:()=>({status:1,stderr:'download failed'})}),/RUNTIME_INSTALL_DOWNLOAD_FAILED/);
 assert.equal(fs.existsSync(privateRuntimePath(f.home)),false);assert.deepEqual(f.before(),before);
 const parent=path.dirname(privateRuntimePath(f.home)),stage=fs.readdirSync(parent).find(n=>n.startsWith('.preparing-'));assert.ok(stage);assert.equal(JSON.parse(fs.readFileSync(path.join(parent,stage,'agi-runtime-failure.json'))).code,'RUNTIME_INSTALL_DOWNLOAD_FAILED');
});
test('post-install lock mutation and altered package bytes cannot be published',t=>{
 const f=fixture(t);assert.throws(()=>prepareRuntime({...f.options,run:(_exe,_args,opts)=>{fs.appendFileSync(path.join(opts.cwd,'package-lock.json'),' ');return {status:0};}}),/RUNTIME_INSTALL_LOCK_MISMATCH/);assert.equal(fs.existsSync(privateRuntimePath(f.home)),false);
 assert.throws(()=>prepareRuntime({...f.options,run:()=>({status:0}),verifyArtifact:()=>{throw Error('OPENCLAW_ARTIFACT_MISMATCH');}}),/OPENCLAW_ARTIFACT_MISMATCH/);assert.equal(fs.existsSync(privateRuntimePath(f.home)),false);
});
test('a symlinked runtime parent is refused without launching npm',t=>{
 const f=fixture(t),elsewhere=path.join(f.home,'elsewhere');fs.mkdirSync(elsewhere,{mode:0o700});fs.symlinkSync(elsewhere,path.dirname(privateRuntimePath(f.home)));
 assert.throws(()=>prepareRuntime({...f.options,run:()=>{throw Error('must not execute');}}),/RUNTIME_INSTALL_STATE_INVALID/);
});
test('a concurrent destination is preserved rather than overwritten',t=>{
 const f=fixture(t),target=privateRuntimePath(f.home);
 assert.throws(()=>prepareRuntime({...f.options,run:()=>{fs.mkdirSync(target,{mode:0o700});fs.writeFileSync(path.join(target,'existing'),'preserve');return {status:0};}}),/RUNTIME_INSTALL_TARGET_EXISTS/);assert.equal(fs.readFileSync(path.join(target,'existing'),'utf8'),'preserve');
});
test('reuse rejects a changed install receipt or lock',t=>{
 const f=fixture(t);prepareRuntime({...f.options,run:()=>({status:0})});const target=privateRuntimePath(f.home);fs.appendFileSync(path.join(target,'package-lock.json'),' ');
 assert.throws(()=>prepareRuntime({...f.options,run:()=>{throw Error('must not reinstall');}}),/RUNTIME_INSTALL_LOCK_MISMATCH/);
});


test('missing native artifact refuses publication without triggering automatic downloads',t=>{
 const f=fixture(t);let lifecycleCalls=0;
 assert.throws(()=>prepareRuntimeActual({...f.options,run:(_exe,args)=>{if(args.includes('--probe'))return {status:0,stdout:JSON.stringify({status:'missing'})};if(args[0]?.endsWith('postinstall-bundled-plugins.mjs'))lifecycleCalls++;return {status:0};}}),/RUNTIME_INSTALL_NATIVE_REQUIRED/);
 assert.equal(lifecycleCalls,0);assert.equal(fs.existsSync(privateRuntimePath(f.home)),false);
});
test('only supported download-disabled lifecycle completion runs between two ready probes',t=>{
 const f=fixture(t);let probes=0,completed=false;
 prepareRuntimeActual({...f.options,run:(_exe,args,opts)=>{
  if(args.includes('--probe')){probes++;return {status:0,stdout:JSON.stringify({status:'ready'})};}
  if(args[0]?.endsWith('postinstall-bundled-plugins.mjs')){assert.equal(probes,1);assert.equal(opts.env.OPENCLAW_DISABLE_BUNDLED_PLUGIN_POSTINSTALL,'1');completed=true;return {status:0};}
  assert.ok(args.includes('--ignore-scripts'));return {status:0};
 }});
 assert.equal(probes,2);assert.equal(completed,true);
});


test('reuse refuses a reappeared lifecycle marker or missing native binding without repair',t=>{
 const f=fixture(t);prepareRuntime({...f.options,run:()=>({status:0})});const target=privateRuntimePath(f.home),pkg=path.join(target,'node_modules/openclaw');fs.mkdirSync(pkg,{recursive:true,mode:0o700});const marker=path.join(pkg,'.openclaw-lifecycle-pending');fs.writeFileSync(marker,'pending');
 assert.throws(()=>prepareRuntimeActual({...f.options,run:()=>{throw Error('must not run while pending');}}),/RUNTIME_INSTALL_LIFECYCLE_INCOMPLETE/);assert.equal(fs.readFileSync(marker,'utf8'),'pending');fs.unlinkSync(marker);
 assert.throws(()=>prepareRuntimeActual({...f.options,run:(_exe,args)=>{assert.ok(args.includes('--probe'));return {status:0,stdout:JSON.stringify({status:'missing'})};}}),/RUNTIME_INSTALL_NATIVE_REQUIRED/);assert.equal(fs.existsSync(target),true);
});
