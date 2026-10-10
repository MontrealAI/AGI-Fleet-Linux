import {preparedSecurityReviewFixture as securityReview,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {publicBrowserRuntimeSocketPath,ensurePublicBrowserRuntimeDirectory} from '../compute/public-browser-runtime.mjs';
import {boundedCommand, startLogWindow, finishLogWindow, inventoryCompute, safeSupportReport, exportSupportReport, repairExisting, rollbackExisting, existingSetupKit, exitCodeFor} from '../compute/repair.mjs';
import {snapshotServiceFiles, restoreServiceFiles, serviceFilePaths} from '../compute/repair-backup.mjs';
import {inspectExecutable,discoverRuntime,runtimeEnvironment} from '../compute/runtime-env.mjs';
import {legacyPolicyHash, policyHash} from '../compute/policy.mjs';
import {WORKSTATION_SKILLS} from '../compute/profile.mjs';
import {beginSetupTransaction} from '../compute/setup-transaction.mjs';

function fixture(t, role = 'agent') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-repair-')); t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const profileDir = path.join(home, role === 'agent' ? '.openclaw-agi-compute' : '.openclaw-agi-node-compute'); fs.mkdirSync(profileDir, {mode: 0o700});
  const settings = {role, home, profileDir, gatewayConfig: path.join(profileDir, 'openclaw.json'), workspace: path.join(profileDir, 'workspace'), workstation: true, signerUID: 501, isolationAcknowledged: true, port: role === 'agent' ? 18894 : 18898, gatewayPort: role === 'agent' ? 18896 : 18900, token: 'a'.repeat(64), gatewayToken: 'b'.repeat(64), policyHash: 'd'.repeat(64), maxRuns24h: 17, maxImages24h: 3};
  for (const [name, value] of Object.entries({'compute-settings.json': settings, 'openclaw.json': {gateway: {auth: {token: settings.gatewayToken}}, agents: {defaults: {model: {primary: 'openai/gpt-6-astra'}}}, tools: {}, browser: {ssrfPolicy: {dangerouslyAllowPrivateNetwork: false}}}, 'agi-compute-profile.json': {version: '1.21.2', role}, 'compute-journal.json': {schema: 1, calls: [1234], requests: [{status: 'started'}]}})) fs.writeFileSync(path.join(profileDir, name), JSON.stringify(value), {mode: 0o600});
  return {home, role, profileDir, settings};
}
const observed = file => fs.readFileSync(file);
const fakeRun = async (file, args) => file.endsWith('/id') ? {status: 0, code: 'OK', stdout: 'staff everyone'} : file.endsWith('/launchctl') ? {status: 0, code: 'OK', stdout: 'state = running\npid = 4321'} : {status: 0, code: 'OK', stdout: 'Thu Oct  1 19:00:00 2026'};

test('inventory is repeatable and read-only; drift fails without changing budgets or journals', async t => {
  const f = fixture(t), files = fs.readdirSync(f.profileDir).map(name => path.join(f.profileDir, name)), before = files.map(observed);
  const options = {...f, platform: 'darwin', uid: 504, fileUID:process.getuid?.(), runtimePlatform:process.platform, stopTimeoutMs:200, stopPollIntervalMs:1, run: fakeRun, probePort: async () => true, dependencies: false, policyCheck: () => f.settings.policyHash};
  const first = await inventoryCompute(options), second = await inventoryCompute(options);
  assert.equal(first.checks.find(x => x.id === 'policy').status, 'PASS'); assert.equal(second.checks.find(x => x.id === 'policy').status, 'PASS');
  assert.notEqual(first.runID, second.runID); assert.equal(first.services.gateway.pid, 4321); assert.equal(first.services.gateway.processStartedAt, '2026-10-01T19:00:00.000Z');
  assert.equal(first.qualification.liveProviders, 'NOT TESTED'); assert.equal(first.qualification.toolExecution, 'NOT TESTED');
  const drift = await inventoryCompute({...options, policyCheck: () => 'unexpected'});
  assert.equal(drift.checks.find(x => x.id === 'policy').status, 'FAIL'); assert.equal(exitCodeFor(drift), 1);
  files.forEach((file, index) => assert.deepEqual(observed(file), before[index]));
  assert.deepEqual(fs.readdirSync(f.home), [path.basename(f.profileDir)]);
});

test('missing, stopped, wrong-profile and non-Mac states never become readiness passes', async t => {
  const f = fixture(t, 'node');
  const stopped = await inventoryCompute({...f, platform: 'linux', dependencies: false, probePort: async () => false, policyCheck: () => f.settings.policyHash});
  assert.equal(stopped.checks.find(x => x.id === 'platform').status, 'BLOCKED'); assert.equal(stopped.checks.find(x => x.id === 'gateway-service').status, 'BLOCKED'); assert.equal(stopped.exitCode, 2);
  const missing = await inventoryCompute({...f, role: 'agent', dependencies: false, probePort: async () => false});
  assert.equal(missing.checks.find(x => x.id === 'profile').code, 'EXISTING_COMPUTE_PROFILE_NOT_FOUND');
  f.settings.gatewayConfig = path.join(f.home, 'signer-wallet.json'); fs.writeFileSync(path.join(f.profileDir, 'compute-settings.json'), JSON.stringify(f.settings));
  const wrong = await inventoryCompute({...f, dependencies: false}); assert.equal(wrong.checks.find(x => x.id === 'profile').status, 'BLOCKED');
});

test('current-run log collection excludes the old tail, rejects rotation and exports no raw logs', t => {
  const f = fixture(t), file = path.join(f.profileDir, 'service-error.log');
  fs.writeFileSync(file, 'old COMPUTE_OLD_FAILURE token=old-secret\n'); const cursor = startLogWindow([file]);
  fs.appendFileSync(file, 'COMPUTE_POLICY_CHANGED Bearer fresh-private-token https://localhost/callback?code=secret\n');
  const result = finishLogWindow(cursor), serialized = JSON.stringify(result);
  assert.deepEqual(result.files[0].errorCodes, ['COMPUTE_POLICY_CHANGED']); assert(!serialized.includes('OLD_FAILURE')); assert(!serialized.includes('private-token')); assert(!serialized.includes('callback'));
  fs.renameSync(file, file + '.old'); fs.writeFileSync(file, 'COMPUTE_REPLAYED_OLD_ERROR');
  assert.equal(finishLogWindow(cursor).files[0].status, 'BLOCKED');
});

test('bounded commands distinguish timeout, cancellation, output overflow and successful exit', async () => {
  const timeout = await boundedCommand(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {timeoutMs: 30}); assert.equal(timeout.code, 'TIMEOUT');
  const control = new AbortController(); const cancel = boundedCommand(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {signal: control.signal}); control.abort(); assert.equal((await cancel).code, 'CANCELLED');
  const overflow = await boundedCommand(process.execPath, ['-e', 'process.stdout.write("a".repeat(10000))'], {maxBytes: 100}); assert.equal(overflow.code, 'OUTPUT_LIMIT'); assert.equal(overflow.stdout, '');
  const ok = await boundedCommand(process.execPath, ['-e', 'process.stdin.on("data",x=>process.stdout.write(x))'], {input: 'probe'}); assert.equal(ok.status, 0); assert.equal(ok.stdout, 'probe');
});

test('support exports use allowed fields, redact callback/account data, never overwrite and have private permissions', async t => {
  const f = fixture(t), report = await inventoryCompute({...f, platform: 'linux', dependencies: false, probePort: async () => false, policyCheck: () => f.settings.policyHash});
  report.checks.push({id: 'fake', status: 'PASS', code: 'FIXTURE', remediation: 'Owner alice@example.com callback https://localhost/callback?code=oauth-secret Bearer bearer-secret', facts: {token: f.settings.token, arbitrary: 'secret-arbitrary', stdout: 'secret-output', gatewayToken: f.settings.gatewayToken, installedVersion: '1.21.2'}});
  report.token = 'secret-top-level';
  const text = JSON.stringify(safeSupportReport(report));
  for (const secret of [f.settings.token, f.settings.gatewayToken, 'secret-arbitrary', 'secret-output', 'alice@example.com', 'oauth-secret', 'bearer-secret', 'secret-top-level']) assert(!text.includes(secret), secret);
  const file = path.join(f.home, 'support.json'); exportSupportReport(report, file); assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.throws(() => exportSupportReport(report, file));
});

test('commissioning report retains bounded DNS facts and version/seal evidence without raw service names or secrets',async t=>{
 const f=fixture(t),report=await inventoryCompute({...f,platform:'linux',dependencies:false,probePort:async()=>false,policyCheck:()=>f.settings.policyHash});
 const network=report.checks.find(x=>x.id==='network');network.facts={schema:'agi-network-preflight/v1',hostname:'example.com',status:'BLOCKED',administratorActionRequired:true,inventory:{service:{name:'Private household network',id:'private-service-id',interface:'en0'},configuredDNS:{mode:'automatic',servers:[]},effectiveDNS:['192.168.2.1','secret'],managementKnown:true,mdmEnrolled:false,splitDNS:false,password:'private-password'},checks:[{id:'default-resolver-query',status:'FAIL',resolver:'configured',dnsStatus:'NXDOMAIN',answers:[],stdout:'raw credential'}, {id:'current-node-lookup',status:'FAIL',addresses:[]},{id:'browser-container-dns',status:'NOT TESTED'}]};
 report.checks.push({id:'openclaw',status:'PASS',code:'OPENCLAW_2026_9_5',facts:{nodeVersion:'24.21.0',openclawVersion:'2026.9.5',dockerVersion:'29.8.0'}});
 const exported=safeSupportReport(report),facts=exported.checks.find(x=>x.id==='network').facts,text=JSON.stringify(exported);
 assert.deepEqual(facts.inventory.effectiveResolvers,['192.168.2.1']);assert.equal(facts.inventory.configuredDNSMode,'automatic');assert.equal(facts.checks[0].dnsStatus,'NXDOMAIN');assert.equal(facts.checks[2].status,'NOT TESTED');assert.equal(exported.checks.find(x=>x.id==='policy').facts.policyHash,f.settings.policyHash);assert.equal(exported.checks.find(x=>x.id==='openclaw').facts.nodeVersion,'24.21.0');for(const privateValue of ['Private household network','private-service-id','private-password','raw credential'])assert(!text.includes(privateValue));
});

test('service snapshot is private and recoverable, validates all blobs before stopping or writing', async t => {
  const f = fixture(t), files = serviceFilePaths(f.home, f.role), wrapper = files[1]; fs.mkdirSync(path.dirname(wrapper), {recursive: true, mode: 0o700}); fs.writeFileSync(wrapper, '\x23!/bin/sh\nexec original-gateway "$@"\n', {mode: 0o700});
  const snapshot = snapshotServiceFiles({...f}); assert.equal(fs.statSync(snapshot.directory).mode & 0o777, 0o700);
  fs.writeFileSync(wrapper, 'broken replacement'); let stopped = false;
  await assert.rejects(restoreServiceFiles(snapshot, {home: f.home, stop: async () => false}), /STOP_UNCONFIRMED/); assert.equal(fs.readFileSync(wrapper, 'utf8'), 'broken replacement');
  await restoreServiceFiles(snapshot, {home: f.home, stop: async () => { stopped = true; return true; }}); assert(stopped); assert.match(fs.readFileSync(wrapper, 'utf8'), /original-gateway/); assert.equal(fs.statSync(wrapper).mode & 0o777, 0o700);
  fs.writeFileSync(path.join(snapshot.directory, '1.bin'), 'corrupt'); stopped = false;
  await assert.rejects(restoreServiceFiles(snapshot, {home: f.home, stop: async () => { stopped = true; return true; }}), /BACKUP_CORRUPT/); assert.equal(stopped, false);
});

test('repair and resume delegate to reviewed transaction without replacing credentials or resetting limits', async t => {
  const f = fixture(t), settingsFile = path.join(f.profileDir, 'compute-settings.json'), original = observed(settingsFile), calls = [];
  const setup = async (kit, rl, options) => { calls.push({kit, options}); return {status: 'BLOCKED', code: 'FIXTURE_REVIEW_REQUIRED'}; };
  await repairExisting({...f, setup}); await repairExisting({...f, setup});
  assert.equal(calls.length, 2); assert.equal(calls[0].kit.token, f.settings.token); assert.equal(calls[0].kit.model, 'openai/gpt-6-astra'); assert.equal(calls[0].options.repair, true); assert.equal(calls[1].options.recoverLock, true); assert.deepEqual(observed(settingsFile), original);
  await assert.rejects(repairExisting({...f, setup: async () => { throw Error('SETUP_REVIEW_REJECTED'); }}), /SETUP_REVIEW_REJECTED/); assert.deepEqual(observed(settingsFile), original);
  assert.throws(() => existingSetupKit({...f.settings, model: 'openai/gpt-6-astra'}, 'node'), /ROLE_MISMATCH/);
});

test('inventory distinguishes matching legacy policy migration from unauthorized settings drift', async t => {
  const f = fixture(t), settingsFile = path.join(f.profileDir, 'compute-settings.json');
  fs.mkdirSync(f.settings.workspace, {recursive: true}); fs.writeFileSync(path.join(f.settings.workspace, 'AGENTS.md'), 'synthetic instructions');
  for (const skill of WORKSTATION_SKILLS) { const directory = path.join(f.settings.workspace, 'skills', skill); fs.mkdirSync(directory, {recursive: true}); fs.writeFileSync(path.join(directory, 'SKILL.md'), 'synthetic skill'); }
  f.settings.policyHash = legacyPolicyHash(f.settings); fs.writeFileSync(settingsFile, JSON.stringify(f.settings));
  const opts = {...f, platform: 'linux', dependencies: false, probePort: async () => false};
  const legacy = await inventoryCompute(opts); assert.equal(legacy.checks.find(x => x.id === 'policy').code, 'COMPUTE_POLICY_MIGRATION_REQUIRED');
  for(const kind of ['node','openclaw','docker']){f.settings[kind]=path.join(f.home,kind);fs.writeFileSync(f.settings[kind],'\x23!/bin/sh\nexit 0\n',{mode:0o700});}
  f.settings.executableIdentity={schema:1,...Object.fromEntries(['node','openclaw','docker'].map(kind=>[kind,inspectExecutable(f.settings[kind],kind,{home:f.home})]))};
  f.settings.policySealVersion = 2; f.settings.policyHash = policyHash(f.settings); fs.writeFileSync(settingsFile, JSON.stringify(f.settings));
  const current = await inventoryCompute(opts); assert.equal(current.checks.find(x => x.id === 'policy').status, 'PASS');
  f.settings.maxRuns24h++; fs.writeFileSync(settingsFile, JSON.stringify(f.settings));
  const drift = await inventoryCompute(opts); assert.equal(drift.checks.find(x => x.id === 'policy').status, 'FAIL'); assert.equal(JSON.parse(fs.readFileSync(settingsFile)).maxRuns24h, 18);
});

test('explicit rollback restores old configuration only while stopped and preserves post-repair journals and the complete previous archive', async t => {
  const evidence = root => Object.fromEntries(fs.readdirSync(root).sort().map(name => [name, observed(path.join(root, name)).toString('base64')]));
  for (const usedAfterRepair of [false, true]) {
    const f = fixture(t), original = evidence(f.profileDir), directory = path.join(f.home, '.agi-genesis-setup-agent/transaction'), snapshot = snapshotServiceFiles(f);
    const tx = await beginSetupTransaction({profileDir: f.profileDir, directory, stop: async () => true});
    tx.state.serviceBackup = snapshot.directory; tx.save();
    const marker = path.join(tx.candidate, 'agi-compute-profile.json'); fs.writeFileSync(marker, JSON.stringify({version: '1.22.0', role: 'agent'}));
    const review = securityReview({}, {}, f.settings, {...f.settings}); Object.assign(review,bindPreparedReviewFixture(tx,review));tx.approve(review);
    await tx.publish({review, seal: async () => {}, validate: async () => {}}); await tx.complete(async () => {});
    const journal = path.join(f.profileDir, 'compute-journal.json');
    if (usedAfterRepair) fs.writeFileSync(journal, JSON.stringify({schema: 1, calls: [1234, 5678], requests: [{status: 'started'}]}));
    const before = observed(journal), current = evidence(f.profileDir), receipt = observed(tx.file), stoppedJobs = new Set(), closedPorts = new Set(), options = {...f, platform: 'darwin', uid: 504, fileUID:process.getuid?.(), runtimePlatform:process.platform, stopTimeoutMs:200, stopPollIntervalMs:1, run: async (file,args)=>{if(file.endsWith('/launchctl')&&args[0]==='print'){const label=args[1].split('/').at(-1);stoppedJobs.add(label);return {status:113,stderr:'Bad request.\nCould not find service "'+label+'" in domain for user gui: 504\n'};}return fakeRun(file,args);}, probePort: async port => {closedPorts.add(port);return false;}};
    await assert.rejects(rollbackExisting({...options, stopTimeoutMs:20, run:fakeRun, probePort:async()=>true}), error=>{assert.ok(['COMPUTE_PROFILE_STILL_RUNNING','SETUP_SERVICE_STOP_UNCONFIRMED'].includes(error.message));assert.equal(error.serviceStopDiagnostics.servicesAbsent.compute,false);assert.equal(error.serviceStopDiagnostics.servicesAbsent.gateway,false);return true;});
    assert.deepEqual(evidence(f.profileDir),current);assert.deepEqual(observed(tx.file),receipt);assert.deepEqual(evidence(tx.previous),original);
    const result = await rollbackExisting(options); assert.equal(result.status, 'PASS');assert.equal(result.automaticRestart,false);assert(fs.existsSync(path.join(f.profileDir, 'COMPUTE_STOP')));assert.deepEqual([...stoppedJobs].sort(),['ai.montreal.agi-compute','ai.openclaw.agi-compute'].sort());assert.deepEqual([...closedPorts].sort(),[18894,18896]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.profileDir, 'agi-compute-profile.json'))).version, '1.21.2');
    for(const name of ['compute-settings.json','openclaw.json','agi-compute-profile.json'])assert.equal(observed(path.join(f.profileDir,name)).toString('base64'),original[name]);
    assert.deepEqual(observed(journal), before);assert.deepEqual(evidence(tx.previous),original);
    const saved=JSON.parse(observed(tx.file));assert.equal(saved.state,'rolled-back');assert.equal(saved.rollbackPlan.phase,'restored');assert.deepEqual(evidence(path.join(directory,saved.failedCandidate)),current);assert.deepEqual(evidence(path.join(directory,saved.rollbackPlan.currentSnapshot)),current);assert.deepEqual(observed(path.join(directory,'recovery-evidence/transaction-before-recovery.json')),receipt);
    assert(!fs.existsSync(path.join(f.home, '.agi-genesis-setup-agent/installer.lock')));
  }
});


test('report-only commissioning selects prepared target while retaining recorded installed runtime and all live files',async t=>{
 const f=fixture(t),old=path.join(f.home,'.local/bin/openclaw'),target=path.join(f.home,'.agi-genesis-runtime/openclaw-2026.9.5/node_modules/.bin/openclaw'),docker=path.join(f.home,'.docker/bin/docker');
 for(const file of [old,target,docker])fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(old,'\x23!/bin/sh\nprintf "OpenClaw 2026.9.5 old\\n"\n',{mode:0o700});
 fs.writeFileSync(target,'\x23!/bin/sh\nprintf "OpenClaw 2026.9.5 prepared\\n"\n',{mode:0o700});
 fs.writeFileSync(docker,'\x23!/bin/sh\nprintf "29.8.0\\n"\n',{mode:0o700});
 f.settings.openclaw=old;f.settings.docker=docker;f.settings.runtimeDependencies={node:'24.21.0',openclaw:'2026.9.5'};
 fs.writeFileSync(path.join(f.profileDir,'compute-settings.json'),JSON.stringify(f.settings));
 const files=fs.readdirSync(f.profileDir).map(name=>path.join(f.profileDir,name)),before=files.map(observed),oldBytes=observed(old);let selection;
 const node=path.join(f.home,'node');fs.writeFileSync(node,"\x23!/bin/sh\nexec '"+process.execPath.replaceAll("'","'\\''")+"' \"$@\"\n",{mode:0o700});
 const runtimeProbe={discoverRuntime:options=>{assert.equal(options.openclaw,undefined);selection=discoverRuntime({...options,node,verifyArtifact:file=>{assert.equal(file,target);return {version:'2026.9.5',scope:'fixture'};}});return selection;},runtimeEnvironment};
 const report=await inventoryCompute({...f,uid:process.getuid(),platform:'linux',policyCheck:()=>f.settings.policyHash,probePort:async()=>false,runtimeProbe,run:async(file,args)=>file===docker?{status:0,code:'OK',stdout:'29.8.0'}:fakeRun(file,args)});
 const check=safeSupportReport(report).checks.find(item=>item.id==='openclaw');assert.equal(check.status,'PASS');assert.equal(check.facts.openclawVersion,'2026.9.5');assert.equal(check.facts.recordedOpenclawVersion,'2026.9.5');assert.equal(check.facts.runtimeSelection,'candidate-target');assert.equal(selection.openclaw,target);
 files.forEach((file,i)=>assert.deepEqual(observed(file),before[i]));assert.deepEqual(observed(old),oldBytes);assert.equal(report.settingsChanged,false);
});

for (const role of ['agent', 'node']) test(`OpenClaw success code agrees with observed version in ${role} commissioning reports`, async t => {
  for (const observedVersion of ['2026.9.5', '2026.9.6', undefined]) {
    const f = fixture(t, role), files = fs.readdirSync(f.profileDir).map(name => path.join(f.profileDir, name)), before = files.map(observed);
    const runtimeProbe = {discoverRuntime: () => ({docker: '/synthetic/docker', versions: {node: '24.21.0', openclaw: observedVersion}}), runtimeEnvironment: () => ({})};
    const report = await inventoryCompute({...f, platform: 'darwin', uid: 504, runtimeProbe, policyCheck: () => f.settings.policyHash, probePort: async () => false, run: async (file, args) => file === '/synthetic/docker' ? {status: 0, code: 'OK', stdout: '29.8.0'} : fakeRun(file, args)});
    const exportedFile = path.join(f.home, 'version-support.json'); exportSupportReport(report, exportedFile);
    for (const result of [report, safeSupportReport(report), JSON.parse(fs.readFileSync(exportedFile, 'utf8'))]) {
      const check = result.checks.find(item => item.id === 'openclaw');
      assert.equal(check.facts.openclawVersion, observedVersion ?? null);
      if (observedVersion === '2026.9.5') {
        assert.equal(check.status, 'PASS'); assert.equal(check.code, 'OPENCLAW_2026_9_5');
        assert.equal(check.code, 'OPENCLAW_' + check.facts.openclawVersion.replaceAll('.', '_'));
      } else {
        assert.equal(check.status, 'BLOCKED'); assert.equal(check.code, 'OPENCLAW_VERSION_UNVERIFIED');
      }
      assert.equal(result.settingsChanged, false); assert.equal(result.budgetsChanged, false); assert.equal(result.walletAccessed, false);
    }
    files.forEach((file, index) => assert.deepEqual(observed(file), before[index]));
  }
});

test('explicit rollback waits for external and legacy sockets to disappear before invoking profile restoration',async t=>{
 for(const role of ['agent','node'])for(const external of [false,true]){
  const f=fixture(t,role),socketPath=external?publicBrowserRuntimeSocketPath(f.profileDir):path.join(f.profileDir,'web.sock'),server=net.createServer(socket=>socket.destroy());
  if(external){ensurePublicBrowserRuntimeDirectory({profileDir:f.profileDir,socketPath});t.after(()=>fs.rmSync(path.dirname(socketPath),{recursive:true,force:true}));}
  await new Promise((resolve,reject)=>server.once('error',reject).listen(socketPath,resolve));fs.chmodSync(socketPath,0o600);
  t.after(()=>new Promise(resolve=>server.close(()=>resolve())));let restored=0;
  const transactionAPI={transactionStatus:()=>({state:'safe-stop-required',profileDir:f.profileDir,previousExisted:true}),restoreSetupTransaction:async(directory,{stop})=>{assert.equal(fs.existsSync(socketPath),false);assert.equal(await stop(),true);restored++;}};
  const run=async(file,args)=>file.endsWith('/launchctl')&&args[0]==='print'?{status:113,stderr:'Could not find service "'+args[1].split('/').at(-1)+'" in domain for user gui: 504'}:fakeRun(file,args);
  setTimeout(()=>server.close(),30);const before=observed(path.join(f.profileDir,'compute-settings.json'));
  const result=await rollbackExisting({...f,platform:'darwin',uid:504,fileUID:process.getuid?.(),runtimePlatform:process.platform,run,probePort:async()=>false,transactionAPI,stopTimeoutMs:500,stopPollIntervalMs:1});
  assert.equal(result.status,'PASS');assert.equal(restored,1);assert.equal(fs.existsSync(socketPath),false);assert.deepEqual(observed(path.join(f.profileDir,'compute-settings.json')),before);
 }
});
test('explicit rollback preserves an unexpected legacy socket-path artifact and does not restore a profile',async t=>{
 const f=fixture(t),socketPath=path.join(f.profileDir,'web.sock');fs.writeFileSync(socketPath,'preserve',{mode:0o600});let restored=false;
 const transactionAPI={transactionStatus:()=>({state:'safe-stop-required',profileDir:f.profileDir,previousExisted:true}),restoreSetupTransaction:async()=>{restored=true;}};
 const run=async(file,args)=>file.endsWith('/launchctl')&&args[0]==='print'?{status:113,stderr:'Could not find service "'+args[1].split('/').at(-1)+'" in domain for user gui: 504'}:fakeRun(file,args);
 await assert.rejects(rollbackExisting({...f,platform:'darwin',uid:504,fileUID:process.getuid?.(),runtimePlatform:process.platform,run,probePort:async()=>false,transactionAPI,stopTimeoutMs:50,stopPollIntervalMs:1}));
 assert.equal(restored,false);assert.equal(fs.readFileSync(socketPath,'utf8'),'preserve');
});
