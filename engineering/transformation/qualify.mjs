// SPDX-License-Identifier: MIT
// Mandatory saved-source-preview -> actual existing Docker backend, no fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [application,sources,python,computerAlpha,image,output,installationBinding]=process.argv.slice(2);
for(const name of [application,sources,python,computerAlpha,output,installationBinding])assert.ok(path.isAbsolute(name??''));
assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.equal(fs.realpathSync(python),python);
process.umask(0o077);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const installation=JSON.parse(fs.readFileSync(installationBinding,'utf8'));
assert.equal(installation.schema,'agi-fleet/ti-normal-installation-binding/v1');
assert.equal(fs.realpathSync(application),application);assert.equal(installation.application,application);
assert.equal(fs.realpathSync(process.execPath),process.execPath);assert.equal(installation.nodeExecutable,process.execPath);
const nodeHash=createHash('sha256');for await(const chunk of fs.createReadStream(process.execPath))nodeHash.update(chunk);
assert.equal(nodeHash.digest('hex'),installation.nodeBinarySHA256);
assert.equal(hash(fs.readFileSync(path.join(application,'local-preview-manifest.json'))),installation.manifestSHA256);
assert.equal(process.getuid(),installation.uid);assert.notEqual(installation.uid,0);
assert.equal(installation.started,false);assert.equal(installation.authority,'none');
const installedManifest=JSON.parse(fs.readFileSync(path.join(application,'local-preview-manifest.json'),'utf8'));
assert.equal(installedManifest.commit,installation.sourceCommit);assert.equal(installedManifest.workingTreeDirty,false);
if(process.env.GITHUB_SHA!==undefined)assert.equal(installation.sourceCommit,process.env.GITHUB_SHA);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ti-saved-native-'));
const state=path.join(temporary,'project'),profile=path.join(temporary,'profile.json');
const cli=path.join(application,'local-runtime/transformation/cli.mjs');
const commands=[];
function command(args,{failure=null}={}) {
  const run=spawnSync(process.execPath,[cli,...args,'--state',state,'--sources',sources,'--python',python],
    {encoding:'utf8',timeout:210_000,maxBuffer:2_000_000});
  commands.push({argv:[process.execPath,cli,...args,'--state',state,'--sources',sources,'--python',python],
    status:run.status,signal:run.signal,stdout:run.stdout,stderr:run.stderr});
  if(failure){assert.equal(run.status,1,run.stderr);assert.match(run.stderr,failure);return;}
  assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
}
try {
  fs.mkdirSync(output,{mode:0o700});const demo=path.join(output,'demo');
  const first=command(['demo','--confirm-public-demo','--output',demo]);
  const handoffRaw=fs.readFileSync(path.join(demo,'computer-handoff.json'),'utf8');
  const {createComputerProfile}=await import(pathToFileURL(path.join(application,'local-runtime/computer/profile.mjs')));
  createComputerProfile({alphaRoot:computerAlpha,python,image,handoffRaw,actions:[{type:'screenshot'}],output:profile});
  const prepared=command(['browser-prepare','--project',first.projectId,'--profile',profile]);
  const grant=prepared.prepared;
  const execution=['browser-run','--project',first.projectId,'--profile',profile,'--grant',grant.grant,
    '--commitment',grant.commitment,'--confirm-native-browser'];
  command([...execution.map(value=>value===grant.commitment?'0'.repeat(64):value),'--output',path.join(output,'wrong-grant')],{failure:/TI_EXACT_BROWSER_GRANT_REQUIRED/});
  const completed=command([...execution,'--output',path.join(output,'completed')]);
  assert.equal(completed.nativeState,'complete');assert.equal(completed.authority,'none');
  command([...execution,'--output',path.join(output,'replay')],{failure:/GRANT_UNAVAILABLE/});
  const captured=command(['browser-capture','--project',first.projectId,'--output',path.join(output,'capture')]);
  assert.equal(captured.recovery,'retained-history-only-no-replay');
  const a=fs.readFileSync(path.join(output,'completed/project.json')),b=fs.readFileSync(path.join(output,'capture/project.json'));
  assert.deepEqual(a,b);
  const {LocalRuntime}=await import(pathToFileURL(path.join(application,'local-runtime/supervisor/runtime.mjs')));
  const runtime=new LocalRuntime(path.join(state,'browser-'+first.projectId));
  try {
    const session=runtime.store.meta('ti-browser-session'),principal=runtime.authenticate(fs.readFileSync(runtime.store.meta('ti-browser-credential'),'utf8'));
    const row=runtime.store.db.prepare('SELECT * FROM runs WHERE grant_id=?').get(session.grant);
    assert.equal(row.state,'complete');const receipt=JSON.parse(row.result);
    assert.equal(receipt.observation.backend,'native-alpha-computer-scripted/v1');
    assert.equal(receipt.observation.processGroupGone,true);assert.equal(receipt.observation.containerClosed,true);
    const native=path.join(output,'native-artifacts');fs.mkdirSync(native,{mode:0o700});
    for(const record of receipt.result.artifacts) {
      assert.match(record.name,/^(?:run\.json|receipt\.json|signed-receipt\.json|handoff\.json|computer-return\.json|visible-text\.txt|screen-\d{3}\.png)$/);
      const item=await runtime.dispatch('computer-artifact',{actor:session.actor,run:row.id,name:record.name},principal);
      const bytes=Buffer.from(item.contentBase64,'base64');assert.equal(hash(bytes),record.sha256);assert.equal(bytes.length,record.bytes);
      fs.writeFileSync(path.join(native,record.name),bytes,{flag:'wx',mode:0o600});
    }
    assert.match(fs.readFileSync(path.join(native,'visible-text.txt'),'utf8'),/Independent usefulness review pending/);
    const manifest=JSON.parse(fs.readFileSync(path.join(application,'local-preview-manifest.json'),'utf8'));
    assert.equal(manifest.workingTreeDirty,false);assert.equal(manifest.commit,installation.sourceCommit);
    const value={schema:'agi-fleet/ti-saved-native-qualification/v1',projectId:first.projectId,
      sourcePreviewVersion:'0.1.0-alpha.7',executionClass:'EXISTING_NATIVE_DOCKER_SCRIPTED_BROWSER',
      exactGrant:true,oneUse:true,replayRefused:true,retainedCaptureIdempotent:true,
      actualBrowser:true,containerClosed:true,processGroupGone:true,providerRequests:0,
      installationExecution:'NORMAL_INSTALLER_APPLICATION_AND_NODE',installation,
      image,computerAlpha,sourceIdentity:{fleetCommit:manifest.commit,manifestSha256:hash(fs.readFileSync(path.join(application,'local-preview-manifest.json'))),
        sourceConfigurationSha256:hash(fs.readFileSync(sources)),pins:JSON.parse(fs.readFileSync(path.join(application,'engineering/transformation/source-pins.json'),'utf8'))},
      executionContext:{githubRunId:process.env.GITHUB_RUN_ID??null,githubRunAttempt:process.env.GITHUB_RUN_ATTEMPT??null,
        githubSha:process.env.GITHUB_SHA??null,architecture:process.arch,node:process.version,
        application,nodeExecutable:process.execPath,uid:process.getuid(),
        pythonVersion:spawnSync(python,['--version'],{encoding:'utf8'}).stdout.trim()},
      independentReview:false,productionQualified:false,authority:'none'};
    fs.writeFileSync(path.join(output,'qualification.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(value));
  }finally{runtime.close();}
}finally{
  if(fs.existsSync(output))fs.writeFileSync(path.join(output,'commands.json'),JSON.stringify({commands,productionQualified:false},null,2)+'\n',{flag:'wx',mode:0o600});
  fs.rmSync(temporary,{recursive:true,force:true});
}
