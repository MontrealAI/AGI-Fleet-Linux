import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {realCleanInitializationFixture} from './clean-initialization-real-fixture.mjs';
import {gatewayWrapperPlan} from '../compute/gateway-wrapper.mjs';
import {deriveManagedGatewayAuthority,validateManagedGatewayAuthority,prepareManagedGatewayService,safeManagedServiceDiagnostic} from '../compute/setup-managed-service.mjs';
import {writePinnedService} from './managed-service-fixture.mjs';
import {inspectExecutable} from '../compute/runtime-env.mjs';import {sha256} from '../src/util.mjs';
const role=new URL('..',import.meta.url).pathname.includes('AGI_Node')?'node':'agent';
test(role+' exact pinned service-install render admits only reviewed managed authority', {skip:!process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT,timeout:120000},async t=>{
 const f=realCleanInitializationFixture({role});t.after(()=>f.close());const root=process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT,docker=path.join(f.root,'docker');fs.writeFileSync(docker,'\x23!/bin/sh\nexit 0\n',{mode:0o700});
 fs.renameSync(f.candidate,f.profileDir);const c={role,home:f.root,profileDir:f.profileDir,gatewayConfig:path.join(f.profileDir,'openclaw.json'),node:process.execPath,openclaw:path.join(root,'openclaw.mjs'),docker,gatewayPort:role==='agent'?18896:18900,gatewayHeapMiB:4096};c.executableIdentity={schema:1,...Object.fromEntries(['node','openclaw','docker'].map(k=>[k,inspectExecutable(c[k],k)]))};
 const wrapper=gatewayWrapperPlan(c);c.gatewayWrapper=wrapper.path;c.gatewayWrapperSha256=sha256(wrapper.content);fs.writeFileSync(c.gatewayWrapper,wrapper.content,{mode:0o700});
 const a=deriveManagedGatewayAuthority(c);c.managedGatewayServiceAuthority=a;
 assert.equal(fs.existsSync(path.join(f.profileDir,'service-env')),false);assert.equal(validateManagedGatewayAuthority(c,f.profileDir,a,{optional:true}).present,false);
 // Actual inventory-pinned plan AND LaunchAgent file writer, not a mock render.
 prepareManagedGatewayService(c);assert.equal(validateManagedGatewayAuthority(c).present,true);assert.equal(a.profile,role==='agent'?'agi-compute':'agi-node-compute');
 const env=path.join(f.profileDir,a.paths[2]),shell=path.join(f.profileDir,a.paths[1]),original=fs.readFileSync(env),wrapperBytes=fs.readFileSync(shell);
 for(const [name,change] of [
 ['wrong config path',value=>value.replace(c.gatewayConfig,'/tmp/unapproved/openclaw.json')],
 ['wrong state path',value=>value.replace(c.profileDir,'/tmp/unapproved-state')],
 ['wrong managed wrapper',value=>value.replace(c.gatewayWrapper,'/tmp/unapproved-wrapper')],
 ['unexpected key',value=>value+"export NODE_TLS_REJECT_UNAUTHORIZED='0'\n"],
 ['proxy authority',value=>value+"export OPENCLAW_PROXY_URL='https://unapproved.invalid'\n"],
 ['heap flags',value=>value.replace("export NODE_OPTIONS=''","export NODE_OPTIONS='--require=/tmp/inject.mjs'")],
 ['wrong profile',value=>value.replace(a.profile,'unapproved-profile')]]){
  await t.test(name,()=>{const changed=change(original.toString());assert.notEqual(changed,original.toString());fs.writeFileSync(env,changed);assert.throws(()=>validateManagedGatewayAuthority(c),e=>{assert.equal(e.message,'SETUP_MANAGED_SERVICE_AUTHORITY_CHANGED');const d=safeManagedServiceDiagnostic(e.managedServiceDiagnostic);assert.equal(d.predicate,'derived-content');assert.ok(d.expectedSha256&&d.observedSha256);assert.equal(JSON.stringify(d).includes('export'),false);return true;});fs.writeFileSync(env,original);});
 }
 await t.test('changed shell wrapper',()=>{fs.appendFileSync(shell,'\nexec /tmp/inject');assert.throws(()=>validateManagedGatewayAuthority(c));fs.writeFileSync(shell,wrapperBytes);});
 await t.test('extra member',()=>{const p=path.join(f.profileDir,'service-env/unexpected');fs.writeFileSync(p,'x',{mode:0o600});assert.throws(()=>validateManagedGatewayAuthority(c));const previousEnv=fs.readFileSync(env),previousWrapper=fs.readFileSync(shell);assert.throws(()=>prepareManagedGatewayService(c));assert.deepEqual(fs.readFileSync(env),previousEnv);assert.deepEqual(fs.readFileSync(shell),previousWrapper);fs.unlinkSync(p);});
 for(const [name,file,mode] of [['world writable directory',path.join(f.profileDir,'service-env'),0o777],['world writable env',env,0o666],['group readable env',env,0o640],['executable env',env,0o700]])await t.test(name,()=>{const old=fs.statSync(file).mode&0o777;fs.chmodSync(file,mode);assert.throws(()=>validateManagedGatewayAuthority(c));fs.chmodSync(file,old);});
 await t.test('symlink member',()=>{fs.renameSync(env,env+'.original');fs.symlinkSync(env+'.original',env);assert.throws(()=>validateManagedGatewayAuthority(c));fs.unlinkSync(env);fs.renameSync(env+'.original',env);});
 await t.test('hard-link alias',()=>{const link=path.join(f.root,'alias');fs.linkSync(env,link);assert.throws(()=>validateManagedGatewayAuthority(c));fs.unlinkSync(link);});
 await t.test('redirected directory',()=>{const dir=path.join(f.profileDir,'service-env');fs.renameSync(dir,dir+'.original');fs.symlinkSync(dir+'.original',dir);assert.throws(()=>validateManagedGatewayAuthority(c));fs.unlinkSync(dir);fs.renameSync(dir+'.original',dir);});
 await t.test('approved executable identity substitution',()=>{const edited=structuredClone(c);edited.executableIdentity.node.sha256='0'.repeat(64);assert.throws(()=>deriveManagedGatewayAuthority(edited),/COMPUTE_RUNTIME_EXECUTABLE_CHANGED/);});
 assert.equal(validateManagedGatewayAuthority(c).present,true);
});
