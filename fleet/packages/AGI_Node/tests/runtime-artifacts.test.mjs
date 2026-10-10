import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifyRuntimeArtifact,runtimeArtifactLock} from '../compute/runtime-artifacts.mjs';
import {collectPreflight,sanitizeDiagnostics} from '../src/control/system-preflight.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-artifact-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const files={'package.json':JSON.stringify({name:'openclaw',version:'2026.9.5'}),'openclaw.mjs':'export {};\n','dist/plugin-sdk/provider-auth.js':'export const auth=true;\n','node_modules/bundled/index.js':'export {};\n','.openclaw-lifecycle-pending':'pending\n'};
  const records={};
  for(const [name,data] of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,data,{mode:0o600});records[name]={sha256:crypto.createHash('sha256').update(data).digest('hex'),bytes:Buffer.byteLength(data)};}
  const inventory={schema:'agi-package-file-inventory/v1',package:'openclaw',version:'2026.9.5',files:records,optionalAbsent:['.openclaw-lifecycle-pending'],extraRootAllowed:['node_modules']};
  const artifactLock={openclaw:{version:'2026.9.5',inventorySHA256:'a'.repeat(64),tarballSHA256:'b'.repeat(64),providerAuthSDK:{path:'dist/plugin-sdk/provider-auth.js',sha256:records['dist/plugin-sdk/provider-auth.js'].sha256}}};
  return {root,entry:path.join(root,'openclaw.mjs'),options:{inventory,artifactLock}};
}
test('official lock retains Node24 contract and current digest-pinned qualification targets',()=>{
  assert.equal(runtimeArtifactLock.node.supportedRange,'>=24.19.0 <25');assert.equal(runtimeArtifactLock.node.preferredVersion,'24.21.0');
  assert.equal(runtimeArtifactLock.openclaw.version,'2026.9.5');assert.match(runtimeArtifactLock.openclaw.integrity,/^sha512-/);
  assert.equal(runtimeArtifactLock.dockerDesktop.qualificationTarget,'4.93.0');assert.match(runtimeArtifactLock.dockerDesktop.sha256,/^[a-f0-9]{64}$/);
  for(const base of runtimeArtifactLock.dockerBases)assert.match(base.image,/@sha256:[a-f0-9]{64}$/);
});
test('package verification binds all packaged files and explicitly excludes external dependency attestation',t=>{
  const f=fixture(t),receipt=verifyRuntimeArtifact(f.entry,f.options);
  assert.equal(receipt.verifiedFiles,5);assert.equal(receipt.version,'2026.9.5');assert.equal(receipt.packageRoot,f.root);assert.equal(receipt.externalDependencyClosureVerified,false);
  assert.equal(receipt.providerAuthSDK.path,path.join(f.root,'dist/plugin-sdk/provider-auth.js'));
});
test('postinstall may remove only the recorded package lifecycle marker',t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.root,'.openclaw-lifecycle-pending'));assert.equal(verifyRuntimeArtifact(f.entry,f.options).verifiedFiles,4);
  fs.unlinkSync(path.join(f.root,'dist/plugin-sdk/provider-auth.js'));assert.throws(()=>verifyRuntimeArtifact(f.entry,f.options),/OPENCLAW_ARTIFACT_MISMATCH/);
});
test('same-size SDK tampering is rejected',t=>{
  const f=fixture(t),sdk=path.join(f.root,'dist/plugin-sdk/provider-auth.js');fs.writeFileSync(sdk,fs.readFileSync(sdk,'utf8').replace('true','null'));
  assert.throws(()=>verifyRuntimeArtifact(f.entry,f.options),/OPENCLAW_ARTIFACT_MISMATCH/);
});
test('unlisted runtime files and symlink substitutions are rejected',t=>{
  const f=fixture(t),extra=path.join(f.root,'dist/injected.js');fs.writeFileSync(extra,'export {};');assert.throws(()=>verifyRuntimeArtifact(f.entry,f.options),/OPENCLAW_ARTIFACT_MISMATCH/);fs.unlinkSync(extra);
  const sdk=path.join(f.root,'dist/plugin-sdk/provider-auth.js'),copy=path.join(f.root,'saved.js');fs.renameSync(sdk,copy);fs.symlinkSync(copy,sdk);assert.throws(()=>verifyRuntimeArtifact(f.entry,f.options),/OPENCLAW_ARTIFACT_MISMATCH/);
});
test('package-owned bundled dependency changes are rejected while external closure is declared',t=>{
  const f=fixture(t),external=path.join(f.root,'node_modules/external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'index.js'),'external');assert.equal(verifyRuntimeArtifact(f.entry,f.options).externalDependencyClosureVerified,false);
  fs.writeFileSync(path.join(f.root,'node_modules/bundled/index.js'),'changed');assert.throws(()=>verifyRuntimeArtifact(f.entry,f.options),/OPENCLAW_ARTIFACT_MISMATCH/);
});
test('writeable package files and parent directory substitutions are rejected',t=>{
  const f=fixture(t);fs.chmodSync(f.entry,0o666);assert.throws(()=>verifyRuntimeArtifact(f.entry,f.options),/OPENCLAW_ARTIFACT_MISMATCH/);fs.chmodSync(f.entry,0o600);
  const dir=path.join(f.root,'dist/plugin-sdk'),other=path.join(f.root,'sdk-copy');fs.renameSync(dir,other);fs.symlinkSync(other,dir);assert.throws(()=>verifyRuntimeArtifact(f.entry,f.options),/OPENCLAW_ARTIFACT_MISMATCH/);
});
test('metadata version and SDK export digest must match the admitted artifact',t=>{
  const f=fixture(t);assert.throws(()=>verifyRuntimeArtifact(f.entry,{...f.options,artifactLock:{openclaw:{...f.options.artifactLock.openclaw,version:'2026.9.6'}}}),/OPENCLAW_ARTIFACT_MISMATCH/);
  const options=structuredClone(f.options);options.artifactLock.openclaw.providerAuthSDK.sha256='c'.repeat(64);assert.throws(()=>verifyRuntimeArtifact(f.entry,options),/OPENCLAW_ARTIFACT_MISMATCH/);
});
test('preflight reports current targets without turning version matches into native qualification',()=>{
  const report=collectPreflight({run:(exe,args)=>({status:0,stdout:exe==='openclaw'?'OpenClaw 2026.9.5':exe==='docker'?JSON.stringify({MemTotal:4*1024**3,ServerVersion:'29.8.1'}):exe==='npm'?'11.5.0':''})});
  assert.equal(report.facts.openclawVersion,'2026.9.5');assert.equal(report.gates.find(g=>g.id==='openclaw').state,'measured');
  assert.equal(report.gates.find(g=>g.id===(process.platform==='linux'?'linux-commissioning':'mac-commissioning')).state,'unverified');assert.match(report.gates.find(g=>g.id==='runtime').detail,/24\.21\.0/);const baseline=report.gates.find(g=>g.id===(process.platform==='linux'?'docker-engine-baseline':'docker-desktop-baseline'));assert.match(baseline.detail,process.platform==='linux'?/29\.8\.2/:/4\.93\.0/);if(process.platform==='linux')assert.equal(baseline.state,'unverified');
  assert.equal(sanitizeDiagnostics({dockerDesktopVersion:'4.93.0 secret-token'}).facts.dockerDesktopVersion,'4.93.0');
});
