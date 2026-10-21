import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {canonical,payloadDigest,BINDING_KEYS,STAGES} from './contract.mjs';
import {reviewDiscoveryRequest} from './receiver.mjs';

const fleetRoot=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const here=fileURLToPath(new URL('.',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const bytes=filename=>fs.readFileSync(filename);
const pin=JSON.parse(bytes(path.join(here,'alpha-source-pin.json')));
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:4_000_000}).trim();

export function evidenceDestination(output,roots) {
  assert.ok(path.isAbsolute(output),'Use an absolute absent output directory.');
  output=path.resolve(output);
  output=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));
  for(const directory of roots) {
    const root=path.resolve(fs.realpathSync(directory));
    assert.ok(output!==root&&!output.startsWith(root+path.sep),'Write evidence outside both checkouts.');
  }
  assert.equal(fs.existsSync(output),false,'Evidence output must not overwrite retained data.');
  return output;
}

export function verifyAlphaSource(root) {
  assert.equal(git(root,'rev-parse','HEAD'),pin.commit,'Use the exact public Alpha commit.');
  assert.equal(git(root,'rev-parse','HEAD^{tree}'),pin.tree,'Alpha tree changed.');
  assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','Alpha tracked checkout must be unchanged.');
  for(const [relative,record] of Object.entries(pin.files)) {
    const filename=path.resolve(root,relative),actual=fs.realpathSync(filename);
    assert.ok(actual.startsWith(root+path.sep)&&fs.lstatSync(filename).isFile()&&!fs.lstatSync(filename).isSymbolicLink(),'Regular source file required.');
    assert.equal(sha(bytes(filename)),record.sha256,relative+' bytes changed.');
    assert.equal(git(root,'rev-parse','HEAD:'+relative),record.gitBlob,relative+' Git identity changed.');
  }
  const generated=JSON.parse(bytes(path.join(root,'docs/successor/capabilities/sources.json')));
  assert.equal(canonical(generated.sources),canonical(pin.generatedSources));
  assert.equal(sha(canonical(generated.sources)),pin.generatedSourcesHash);
  assert.equal(generated.sourceHash,pin.generatedSourcesHash);
  assert.equal(pin.files[pin.browserPagePath].sha256,pin.generatedPageSha256);
  const visited=new Map();
  function visit(relative) {
    if(visited.has(relative))return;
    const source=bytes(path.join(root,relative)).toString();visited.set(relative,sha(source));
    for(const match of source.matchAll(/^import\s+[^;]*?\s+from\s+['"]([^'"]+)['"];/gm)) {
      assert.ok(match[1].startsWith('.'),'Native finite checker may import only its fixed local closure.');
      const next=path.relative(root,path.resolve(root,path.dirname(relative),match[1]));
      assert.ok(!next.startsWith('..')&&!path.isAbsolute(next));visit(next);
    }
  }
  visit(pin.nativeEntry);assert.equal(canonical(Object.fromEntries(visited)),canonical(pin.nativeClosure));
  return {commit:pin.commit,tree:pin.tree,generatedSourcesHash:pin.generatedSourcesHash,
    generatedPageSha256:pin.generatedPageSha256,
    generatedFiles:Object.keys(pin.generatedSources).length,nativeClosureFiles:visited.size,allPinnedFiles:Object.keys(pin.files).length};
}

/** Development-only public finite seam; no Fleet service, private capture or authority. */
export async function qualify(alphaRoot,{profile='fleet-linux-x64',output=null}={}) {
  assert.ok(path.isAbsolute(alphaRoot),'An explicit absolute Alpha checkout is required.');
  alphaRoot=fs.realpathSync(alphaRoot);
  const runtime=pin.runtimeProfiles[profile];assert.ok(runtime,'Unknown runtime profile.');
  assert.equal(process.version,runtime.version);assert.equal(process.platform,runtime.platform);assert.equal(process.arch,runtime.arch);
  assert.equal(sha(bytes(process.execPath)),runtime.binarySha256,'Use the pinned Node bytes for this source-seam profile.');
  if(output)output=evidenceDestination(output,[alphaRoot,fleetRoot]);
  const sourceObservation=verifyAlphaSource(alphaRoot);
  const load=name=>import(pathToFileURL(path.join(alphaRoot,'examples/successor-capability',name)).href);
  const model=await load('discovery-lab.mjs'),{createInspector}=await load('discovery-lab-inspector.mjs');
  const {makeArtifacts}=await load('discovery-lab-artifacts.mjs');
  const sources={modelDigest:pin.nativeClosure['examples/successor-capability/discovery-lab.mjs'],
    sourceDigest:pin.generatedSourcesHash,evaluatorDigest:pin.nativeClosure['examples/successor-capability/discovery-lab-checker.mjs']};
  const runtimeDigest=await payloadDigest({profile,...runtime,nativeClosure:pin.nativeClosure});
  const inspector=createInspector(sources),cases=[],reports=new Map(),construction=[];
  function campaign(id,changes={},parent=null) {
    const charter={...structuredClone(model.DEFAULT_CHARTER),...changes},start=performance.now();
    const result=model.runCampaign(charter,{parent:parent?.result??null});
    const ancestors=parent?[...parent.ancestors,{charter:parent.charter,result:parent.result}]:[];
    const report={charter,result,ancestors};reports.set(id,report);
    construction.push({id,elapsedMs:Math.ceil(performance.now()-start),resourceUsed:result.resources});return report;
  }
  const base=campaign('default');
  async function requestFor(report,stage,route='manager-usdc') {
    const bindings={missionId:'capability-00000000-0000-4000-8000-000000000063',revision:report.ancestors.length,
      purposeDigest:await payloadDigest({purpose:report.charter.purpose}),charterDigest:await payloadDigest(report.charter),...sources};
    const artifacts=await makeArtifacts(bindings,report.result);
    const chain=[...report.ancestors,{charter:report.charter,result:report.result}];
    const limits={acquisitions:4096,search:4096,checking:4096,memoryBytes:1_000_000,storageBytes:1_000_000,
      workerCapacity:4,installations:4096,elapsedMs:120_000};
    for(const item of chain)for(const key of ['acquisitions','search','checking','installations'])limits[key]+=item.charter.budget[key];
    const payload={schema:'discovery-lab-review-payload/v1',charter:report.charter,result:report.result,ancestors:report.ancestors};
    return {schema:'successor-discovery-work-request/v1',...bindings,stage,
      inputArtifacts:artifacts.slice(0,STAGES.indexOf(stage)).map(artifact=>artifact.digest),resourceLimits:limits,
      executionMode:'synthetic-local',commission:{id:'native-finite-mission',branch:route==='manager-usdc'?'usdc-local-branch':'agialpha-local-branch',
        route,currency:route==='manager-usdc'?'USDC6':'AGIALPHA18',capBaseUnits:'0',status:'DRAFT_NOT_SUBMITTED'},
      payloadDigest:await payloadDigest(payload),payload};
  }
  function installed(request) {
    return {executorId:'pinned-public-finite-review',runtimeDigest,currentRuntimeDigest:runtimeDigest,
      expected:Object.fromEntries(BINDING_KEYS.map(key=>[key,request[key]])),
      expectedCommission:Object.fromEntries(['id','branch','route'].map(key=>[key,request.commission[key]])),
      stages:STAGES,resourceCapacity:{...request.resourceLimits},inspectCampaign:inspector};
  }
  async function run(id,report,stage,expected,{route='manager-usdc',edit=null,contextEdit=null,unprovisioned=false,requiredReasons=[]}={}) {
    let request=await requestFor(report,stage,route),context=installed(request);
    if(edit) { request=structuredClone(request);await edit(request);request.payloadDigest=await payloadDigest(request.payload); }
    if(contextEdit)contextEdit(context);
    const start=performance.now(),raw=canonical(request);
    const receipt=await reviewDiscoveryRequest(raw,unprovisioned?null:context);
    const observations={id,expected,actual:receipt.state,passed:receipt.state===expected&&requiredReasons.every(reason=>receipt.reasons.includes(reason)),
      elapsedMs:Math.ceil(performance.now()-start),requestDigest:sha(raw),payloadDigest:request.payloadDigest,
      route:request.commission.route,currency:request.commission.currency,capBaseUnits:request.commission.capBaseUnits,
      request,receipt};
    assert.equal(receipt.remoteExecution,'unprovisioned');assert.equal(receipt.authority,'none');
    cases.push(observations);
  }
  for(const stage of STAGES)for(const route of ['manager-usdc','jobs-agialpha'])
    await run(stage+'-'+route,base,stage,'accepted-local-review',{route});
  await run('invalid-calibration',campaign('invalid-calibration',{actualDrift:'quadratic'}),'learn','rejected-local-review');
  await run('non-updatable-memory',campaign('non-updatable-memory',{memory:6,operations:['flip-z','flip-x']}),'think','rejected-local-review');
  await run('wrong-location',campaign('wrong-location',{topology:'wrong'}),'strategise','rejected-local-review');
  await run('hidden-coupling',campaign('hidden-coupling',{hiddenCoupling:true}),'evolve','rejected-local-review');
  await run('search-exhausted',campaign('search-exhausted',{budget:{...model.DEFAULT_CHARTER.budget,search:5}}),'learn','inconclusive');
  await run('stale-runtime',base,'evolve','rejected',{contextEdit:context=>{context.currentRuntimeDigest='0'.repeat(64);}});
  await run('stale-revision',base,'evolve','rejected',{contextEdit:context=>{context.expected.revision++;}});
  await run('forged-response-table',base,'evolve','rejected-local-review',{edit:request=>{request.payload.result.stages[5].program.responseTable[0]++;}});
  await run('forged-input-artifacts',base,'evolve','rejected-local-review',{edit:request=>{request.inputArtifacts[0]='0'.repeat(64);}});
  await run('checking-exhausted',base,'evolve','inconclusive',{edit:request=>{request.resourceLimits.checking=1;}});
  await run('storage-not-reserved',base,'evolve','inconclusive',{edit:request=>{request.resourceLimits.storageBytes=1000;}});
  await run('remote-unprovisioned',base,'evolve','unprovisioned',{unprovisioned:true});
  await run('remote-mode-unsupported',base,'evolve','unsupported',{edit:request=>{request.executionMode='real-external';}});
  await run('commission-branch-clone',base,'evolve','rejected',{edit:request=>{request.commission.branch='cloned-branch';}});
  const stronger=campaign('stronger-four-controls',{controls:4,memory:16,operations:['flip-z','flip-w']},base);
  await run('stronger-successor',stronger,'evolve','accepted-local-review');
  const checkpoint=campaign('stronger-checkpoint',{checkpoints:['safety','sterile']},base);
  await run('stronger-checkpoint',checkpoint,'evolve','accepted-local-review');
  await run('omitted-checkpoint',checkpoint,'strategise','rejected-local-review',{edit:request=>{
    request.payload.result.stages[3].program.leaves[0].visits=request.payload.result.stages[3].program.leaves[0].visits.filter(value=>value!=='sterile');
  }});
  for(const resource of ['checking','memoryBytes','storageBytes','elapsedMs']) {
    const mismatches={runtime:context=>{context.currentRuntimeDigest='0'.repeat(64);},
      source:context=>{context.expected.sourceDigest='0'.repeat(64);},revision:context=>{context.expected.revision++;},
      commission:context=>{context.expectedCommission.branch='stale-branch';}};
    for(const [binding,contextEdit] of Object.entries(mismatches))
      await run('exhausted-'+resource+'-stale-'+binding,base,'evolve','inconclusive',{
        edit:request=>{request.resourceLimits[resource]=0;},contextEdit,requiredReasons:['DISCOVERY_REVIEW_BUDGET_EXHAUSTED']});
  }
  verifyAlphaSource(alphaRoot);
  const evidence={schema:'agi-fleet/discovery-semantic-seam-evidence/v1',profile,runtime:process.version,
    sourceObservation,runtimeDigest,receiverSources:Object.fromEntries(['receiver.mjs','contract.mjs','qualify.mjs','alpha-source-pin.json'].map(name=>[name,sha(bytes(path.join(here,name)))])),
    scope:'Actual direct local finite review against pinned public Alpha source. No Fleet service, operator installation, remote execution or organizational independence.',
    total:cases.length,passed:cases.filter(row=>row.passed).length,failed:cases.filter(row=>!row.passed).length,
    construction,cases,remoteExecution:'unprovisioned',installedFleetExecution:false,eligibleOwnerApproval:false};
  if(output) {
    fs.mkdirSync(output);fs.writeFileSync(path.join(output,'semantic-seam.json'),JSON.stringify(evidence,null,2)+'\n');
  }
  return evidence;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2) {
    assert.ok(['--alpha-root','--output','--profile'].includes(args[i])&&args[i+1]&&!Object.hasOwn(options,args[i]),'Use --alpha-root ABS [--output ABS] [--profile NAME].');
    options[args[i]]=args[i+1];
  }
  const result=await qualify(options['--alpha-root'],{output:options['--output']??null,profile:options['--profile']??'fleet-linux-x64'});
  console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,profile:result.profile,remoteExecution:result.remoteExecution}));
  process.exitCode=result.failed?1:0;
}
