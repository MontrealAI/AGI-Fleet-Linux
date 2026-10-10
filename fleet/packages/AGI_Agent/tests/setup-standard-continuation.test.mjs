import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {releaseIdentity} from '../compute/desktop-evidence.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {pinnedStandardFixture,pinnedPackage} from './setup-standard-lifecycle-fixture.mjs';
import {setupCapable} from '../compute/setup.mjs';import {readSetupArguments} from '../compute/setup-ledger.mjs';
import {inspectStandardOAuthResume,archiveStandardOAuthAttempt,assertStandardContinuationStopped} from '../compute/setup-standard-oauth-resume.mjs';
import {publicBrowserRuntimeSocketPath,ensurePublicBrowserRuntimeDirectory} from '../compute/public-browser-runtime.mjs';
import {freshOAuthEvidenceTree} from '../compute/setup-fresh-oauth-resume.mjs';
const appRole=JSON.parse(fs.readFileSync(new URL('../config/companion-releases.json',import.meta.url))).role;
const skip=!(pinnedPackage&&process.env.AGI_TEST_STANDARD_SOURCE_AGENT&&process.env.AGI_TEST_STANDARD_SOURCE_NODE);
async function historical(t,role){
 const f=pinnedStandardFixture(t,role),source=process.env[role==='agent'?'AGI_TEST_STANDARD_SOURCE_AGENT':'AGI_TEST_STANDARD_SOURCE_NODE'],old=await import(pathToFileURL(path.join(source,'compute/setup.mjs')).href);
 const desktop=f.dependencies.desktopCheck;f.dependencies.desktopCheck=(run,docker,imageID)=>({...desktop(run,docker,imageID),runID:crypto.randomUUID(),imageID,...releaseIdentity(source)});
 await assert.rejects(old.setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'standard',dependencies:f.dependencies}),e=>{assert.equal(e.message,'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');assert.equal(e.supportReport.stages.oauth,'failed');assert.equal(e.supportReport.securityReviewDigest,null);assert.equal(e.supportReport.serviceReadiness,null);assert.equal(e.supportReport.transaction.state,'prepared');return true;});
 f.dependencies.desktopCheck=(run,docker,imageID)=>({...desktop(run,docker,imageID),runID:crypto.randomUUID(),imageID,...releaseIdentity(fileURLToPath(new URL('../',import.meta.url)))});
 const support=path.join(f.home,'.agi-genesis-setup-'+role);const options={home:f.home,role,uid:504,signerUID:503,fileUID:process.getuid(),kit:f.kit,assuranceMode:'standard',platform:'darwin',runtimePlatform:process.platform,spawn:f.dependencies.spawnSync,listen:f.dependencies.listen};
 return {f,support,options,before:freshOAuthEvidenceTree(path.join(support,'transaction'),process.getuid()),report:fs.readFileSync(path.join(support,'setup-diagnostics.json'))};
}
for(const role of [appRole])test('shipped 1.18.9 '+role+' failure continues in Standard with pinned role reuse, fresh approval and completed authenticated health',{skip,timeout:360000},async t=>{
 const {f,support,options,before,report}=await historical(t,role),logins=f.loginExchanges;const admitted=inspectStandardOAuthResume(options);assert.equal(admitted.state.state,'prepared');assert.deepEqual(freshOAuthEvidenceTree(path.join(support,'transaction'),process.getuid()),before);
 // Independent new execution images may differ; historical IDs stay untouched.
 f.imageAttempt=1;f.imagePlan=({tag})=>'sha256:'+(tag.includes('browser')?'e':'b').repeat(64);
 const ask=f.rl.question;let reviewed=false;f.rl.question=async prompt=>{if(prompt.includes('Type APPROVE')){reviewed=true;assert.equal(f.loginExchanges,logins);const state=JSON.parse(fs.readFileSync(path.join(support,'transaction/transaction.json'))),review=JSON.parse(fs.readFileSync(path.join(support,'security-review.json')));assert.equal(state.assuranceMode,'standard');assert.equal(state.approval,null);assert.equal(review.assuranceMode,'standard');assert.notEqual(state.id,admitted.state.id);assert.equal(fs.existsSync(f.profileDir),false);}return ask(prompt);};
 const result=await setupCapable(f.kit,f.rl,{...readSetupArguments(['--continue-standard-install']),dependencies:f.dependencies}),receipt=result.supportReport.freshOAuthResume,archive=path.join(support,receipt.archive);
 assert.equal(reviewed,true);assert.equal(f.loginExchanges,logins);assert.equal(result.supportReport.assuranceMode,'standard');assert.equal(result.supportReport.transaction.state,'complete');assert.equal(result.supportReport.cleanInitialization,null);assert.equal(receipt.assuranceMode,'standard');assert.equal(receipt.roleStoresPreserved,role==='agent'?3:2);assert.equal(receipt.committedWALIncluded,true);assert.deepEqual(fs.readFileSync(path.join(archive,'setup-diagnostics.json')),report);assert.deepEqual(freshOAuthEvidenceTree(path.join(archive,'transaction'),process.getuid()),before);assert.equal(result.supportReport.images.work,'sha256:'+'b'.repeat(64));assert.equal(result.supportReport.serviceReadiness.gateway.state,'passed');assert.equal(result.supportReport.serviceReadiness.health.state,'passed');assert.equal(result.supportReport.serviceReadiness.finalPolicy.state,'passed');
});
for(const role of [appRole])test('Standard '+role+' continuation rejects cross-mode, altered association, approval, services, missing auth and authority changes before archive',{skip,timeout:360000},async t=>{
 const {f,support,options,before}=await historical(t,role),reportFile=path.join(support,'setup-diagnostics.json'),tx=path.join(support,'transaction/transaction.json'),candidate=path.join(support,'transaction/candidate');
 const rejectJSON=(file,mutate)=>{const saved=fs.readFileSync(file),value=JSON.parse(saved);mutate(value);fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});assert.throws(()=>inspectStandardOAuthResume(options));assert.equal(fs.existsSync(path.join(support,'standard-oauth-attempts')),false);fs.writeFileSync(file,saved);};
 rejectJSON(reportFile,v=>v.assuranceMode='verified');rejectJSON(reportFile,v=>v.packageManifestSHA256='a'.repeat(64));rejectJSON(reportFile,v=>v.images.work='sha256:'+'f'.repeat(64));rejectJSON(reportFile,v=>v.securityReviewDigest='a'.repeat(64));rejectJSON(reportFile,v=>v.stages.services='passed');rejectJSON(reportFile,v=>v.walletAccessed=true);
 rejectJSON(tx,v=>v.state='approved');rejectJSON(tx,v=>v.approval='a'.repeat(64));rejectJSON(tx,v=>v.primaryFailureCode='OTHER_FAILURE');
 rejectJSON(path.join(candidate,'openclaw.json'),v=>v.tools.exec.security='full');rejectJSON(path.join(candidate,'compute-settings.json'),v=>v.signerUID=504);
 assert.throws(()=>inspectStandardOAuthResume({...options,kit:{...f.kit,token:'c'.repeat(64)}}));
 const rolePath=path.join(candidate,'agents/agi-checker/agent/openclaw-agent.sqlite'),saved=fs.readFileSync(rolePath);fs.renameSync(rolePath,rolePath+'.retained');assert.throws(()=>inspectStandardOAuthResume(options));fs.renameSync(rolePath+'.retained',rolePath);
 f.active.add(f.kit.port);await assert.rejects(assertStandardContinuationStopped(options),/STANDARD_INSTALL_OAUTH_RESUME_UNAVAILABLE/);f.active.clear();
 const socketOptions={profileDir:f.profileDir,uid:process.getuid(),platform:process.platform},socket=publicBrowserRuntimeSocketPath(f.profileDir,socketOptions);ensurePublicBrowserRuntimeDirectory(socketOptions);fs.writeFileSync(socket,'unexpected runtime object',{mode:0o600});await assert.rejects(assertStandardContinuationStopped(options));assert.equal(fs.readFileSync(socket,'utf8'),'unexpected runtime object');fs.unlinkSync(socket);fs.rmdirSync(path.dirname(socket));
 const spawn=options.spawn;await assert.rejects(assertStandardContinuationStopped({...options,spawn:()=>({status:0,stdout:'loaded'})}),/STANDARD_INSTALL_OAUTH_RESUME_UNAVAILABLE/);
 await assert.rejects(setupCapable(f.kit,f.rl,{...readSetupArguments(['--retry-standard-install']),dependencies:f.dependencies}),/CLEAN_INSTALL_RETRY_UNAVAILABLE/);
 assert.deepEqual(freshOAuthEvidenceTree(path.join(support,'transaction'),process.getuid()),before);assert.equal(fs.existsSync(path.join(support,'standard-oauth-attempts')),false);assert.equal(f.active.size,0);
});
test('Standard archive resumes a bound interrupted atomic rename without changing failed evidence',{skip,timeout:360000},async t=>{
 const {support,options,before}=await historical(t,appRole);for(const checkpoint of ['archive-bound','report-copied','transaction-archived'])await assert.rejects(archiveStandardOAuthAttempt(options,{hook:stage=>{if(stage===checkpoint)throw Error('SIMULATED_INTERRUPTION');}}),/SIMULATED_INTERRUPTION/);
 const continuation=await archiveStandardOAuthAttempt(options);assert.deepEqual(freshOAuthEvidenceTree(path.join(continuation.archive,'transaction'),process.getuid()),before);assert.equal(fs.existsSync(path.join(support,'transaction')),false);
 fs.appendFileSync(path.join(continuation.archive,'setup-result.html'),'changed');assert.throws(()=>inspectStandardOAuthResume(options),/STANDARD_INSTALL_OAUTH_RESUME_UNAVAILABLE/);
});
test('Standard continuation CLI never admits Verified/recovery/retry flag combinations',()=>{
 assert.equal(readSetupArguments(['--continue-standard-install']).assuranceMode,'standard');
 for(const flag of ['--verified-install','--experimental-legacy','--resume-fresh-oauth','--resume-fresh-readiness','--retry-clean-install','--retry-standard-install','--retry-verified-install','--selftest-only','--non-interactive','--refresh-stopped-profile','--recover-interrupted-lock'])assert.throws(()=>readSetupArguments(['--continue-standard-install',flag]),/CLEAN_INSTALL_ARGUMENT_CONFLICT/);
});
