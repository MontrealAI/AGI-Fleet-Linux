import {pinnedTelemetry} from './pinned-telemetry-fixture.mjs';
import {validateManagedGatewayAuthority} from '../compute/setup-managed-service.mjs';
import {policyHash} from '../compute/policy.mjs';
import {deriveManagedGatewayAuthority,writePinnedService} from './managed-service-fixture.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {interrupted185,realRuntime} from './fresh-clean-interruption-fixture.mjs';import {edit} from './fresh-oauth-paused-fixture.mjs';
import {SetupTransaction} from '../compute/setup-transaction.mjs';import {captureRuntimeSecurityComponents} from '../compute/setup-runtime-identity.mjs';import {persistComponentEvidence} from '../compute/setup-component-evidence.mjs';import {preparePinnedControlUICache} from '../compute/setup-runtime-materialization.mjs';
import {setupCapable} from '../compute/setup.mjs';
const historical=JSON.parse(fs.readFileSync(new URL('../compute/fresh-readiness-1.18.6-source.json',import.meta.url)));
/** Reproduce the released old contract, with a real pinned cache/store write.
 * macOS service control, Docker and authentication status are adapters here;
 * actual Gateway/HTTP/compute execution is covered in materialization tests. */
export async function failed186(t,role='agent'){
 const f=await interrupted185(t,role),complete=SetupTransaction.prototype.complete;
 const fake=f.dependencies.discoverRuntime(),real=realRuntime(f),run=f.dependencies.spawnSync;f.dependencies.discoverRuntime=()=>({...fake,...real,executableIdentity:{...fake.executableIdentity,...real.executableIdentity,schema:1}});f.dependencies.prepareManagedGatewayService=c=>{writePinnedService(c);return validateManagedGatewayAuthority(c);};f.dependencies.deriveManagedGatewayAuthority=(c,root)=>{f.liveConfig=c;return deriveManagedGatewayAuthority(c,root);};f.dependencies.spawnSync=(exe,args,opts)=>{const result=run(exe===real.openclaw?fake.openclaw:exe,args,opts);if(args.includes('gateway')&&args.includes('install'))writePinnedService(JSON.parse(fs.readFileSync(path.join(opts.env.OPENCLAW_STATE_DIR,'compute-settings.json'))));return result;};
 const undo=t.mock.method(SetupTransaction.prototype,'complete',async function(verify,activate){
  delete f.liveConfig.managedGatewayServiceAuthority;f.liveConfig.policyHash=policyHash(f.liveConfig);fs.writeFileSync(path.join(this.state.profileDir,'compute-settings.json'),JSON.stringify(f.liveConfig),{mode:0o600});
  fs.rmSync(path.join(this.state.profileDir,'cache'),{recursive:true});fs.rmSync(path.join(this.state.profileDir,'service-env'),{recursive:true});
  // Recreate the released 1.18.6 contract: neither modern mutability policy existed.
  const contract={...this.state.runtimeSecurityRecord.contract};delete contract.runtimeMutabilityVersion;delete contract.pluginCatalogCacheVersion;
  const captured=captureRuntimeSecurityComponents(this.state.profileDir,contract,{completeDiagnostics:true});this.state.runtimeSecurityRecord=captured.identity;this.state.sealedSecurityIdentity=captured.identity.digest;this.state.componentEvidence.sealed=persistComponentEvidence(this.directory,{transactionId:this.state.id,phase:'sealed-before-readiness',captured});this.save();
  writePinnedService(JSON.parse(fs.readFileSync(path.join(this.state.profileDir,'compute-settings.json'))));
  return complete.call(this,async()=>{await verify();preparePinnedControlUICache(this.state.profileDir,process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT);const store=await import(path.join(process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT,'dist/remote-store-BAUNOE08.mjs'));const now=Date.now(),bundle={schemaVersion:1,generatedAt:now,sourceCommit:'readiness-fixture',providers:{openai:{models:[{id:'gpt-6-astra'}]}}};store.i({source_url:'https://catalog.openclaw.ai/models/v1/catalog.json',bundle_json:JSON.stringify(bundle),generated_at:now,min_version:null,checked_at:now,etag:null,last_modified:null},{path:path.join(this.state.profileDir,'state/openclaw.sqlite')});const state=await import(path.join(process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT,'dist/openclaw-state-db-BGE_KP3L.mjs'));await state.closeOpenClawStateDatabaseAsync();await pinnedTelemetry(this.state.profileDir);},activate);
 });
 try{await assert.rejects(f.resume(),e=>e.message==='SETUP_PROFILE_CHANGED'&&e.rollbackFailureCode==='SETUP_ROLLBACK_RUNTIME_CHANGED');}finally{undo.mock.restore();}
 assert.equal(f.active.size,0);const version=role==='agent'?'1.24.6':'2.25.6';edit(path.join(f.support,'clean-install-intent.json'),v=>v.releaseVersion=version);
 edit(path.join(f.support,'setup-diagnostics.json'),v=>{v.versions={fleet:'1.18.6',agent:'1.24.6',node:'2.25.6'};v.packageManifestSHA256=historical[role].packageManifestSHA256;v.sourceHashes=historical[role].sourceHashes;v.desktop.versions={...v.versions};v.desktop.packageManifestSHA256=v.packageManifestSHA256;v.desktop.sourceHashes=v.sourceHashes;});
 fs.writeFileSync(path.join(f.support,'desktop-diagnostics.json'),JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.support,'setup-diagnostics.json'))).desktop),{mode:0o600});
 
 f.readinessOptions={...f.options};f.resumeReadiness=()=>setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',cleanReadinessResume:true,dependencies:f.dependencies});return f;
}
