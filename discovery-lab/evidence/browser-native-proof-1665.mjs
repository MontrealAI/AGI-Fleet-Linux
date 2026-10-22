// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const [fleetRoot,alphaRoot,inputRoot,output,profile]=process.argv.slice(2);
const load=filename=>import(pathToFileURL(filename).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const {verifyAlphaSource,evidenceDestination}=await load(path.join(fleetRoot,'discovery-lab/qualify.mjs'));
const {reviewDiscoveryRequest}=await load(path.join(fleetRoot,'discovery-lab/receiver.mjs'));
const {canonical,BINDING_KEYS,STAGES,payloadDigest}=await load(path.join(fleetRoot,'discovery-lab/contract.mjs'));
const pin=JSON.parse(fs.readFileSync(path.join(fleetRoot,'discovery-lab/alpha-source-pin.json')));
const runtime=pin.runtimeProfiles[profile];assert.equal(process.version,runtime.version);
assert.equal(process.platform,runtime.platform);assert.equal(process.arch,runtime.arch);
assert.equal(sha(fs.readFileSync(process.execPath)),runtime.binarySha256);
const destination=evidenceDestination(output,[fleetRoot,alphaRoot]);
const source=verifyAlphaSource(alphaRoot);
assert.equal(source.commit,'1665cb83f09bde3962f80942e2f1e54b789d9708');
const modulePath=name=>path.join(alphaRoot,'examples/successor-capability',name);
const workspaceModule=await load(modulePath('workspace.mjs'));
const history=await load(modulePath('discovery-lab-history.mjs'));
const {createInspector}=await load(modulePath('discovery-lab-inspector.mjs'));
// Every workspace/inspector import is already in the exact trusted source catalog.
const closure=new Set();
function visit(relative) {
  if(closure.has(relative))return;closure.add(relative);assert.ok(pin.files[relative],relative+' is unpinned');
  const text=fs.readFileSync(path.join(alphaRoot,relative),'utf8');
  for(const match of text.matchAll(/^import\s+[^;]*?\s+from\s+['"]([^'"]+)['"];/gm)) {
    assert.ok(match[1].startsWith('.'),'Only pinned local source may be imported');
    visit(path.relative(alphaRoot,path.resolve(alphaRoot,path.dirname(relative),match[1])));
  }
}
visit('examples/successor-capability/workspace.mjs');
visit('examples/successor-capability/discovery-lab-inspector.mjs');
const workspaceBytes=fs.readFileSync(path.join(inputRoot,'browser-workspace.json'));
assert.equal(sha(workspaceBytes),'cf79913210fc2bdfbdf216e119f577c20ae427cb32764e981c60c7c81fcd40d8');
const workspace=await workspaceModule.parseWorkspace(workspaceBytes.toString());
assert.equal(workspace.missionId,'capability-5dd87a6d-135b-49e3-8108-54e4f986b770');
const inspection=await workspaceModule.inspectWorkspace(workspace);
assert.deepEqual(inspection.discovery.campaigns.map(row=>row.state),['inconclusive','accepted','rejected','accepted']);
// Deliberate local selection from freshly verified history, not request selfclaims.
const candidates=inspection.discovery.campaigns.filter(row=>row.state==='accepted'&&row.charter.controls===4);
assert.equal(candidates.length,1);const selected=candidates[0];
const sources={modelDigest:pin.nativeClosure['examples/successor-capability/discovery-lab.mjs'],
  sourceDigest:pin.generatedSourcesHash,evaluatorDigest:pin.nativeClosure['examples/successor-capability/discovery-lab-checker.mjs']};
for(const [key,value] of Object.entries(sources))assert.equal(selected.bindings[key],value);
const capacity={acquisitions:4000,checking:2010000,elapsedMs:120000,installations:40,
  memoryBytes:10000000,search:2000000,storageBytes:4000000,workerCapacity:4};
const runtimeDigest=await payloadDigest({profile,...runtime,nativeClosure:pin.nativeClosure});
const inspector=createInspector(sources),cases=[];
for(const [name,route] of [['manager-review-draft.json','USDC'],['jobs-review-draft.json','AGIALPHA']]) {
  const bytes=fs.readFileSync(path.join(inputRoot,name)),raw=bytes.toString();
  const expectedRawSha256={'manager-review-draft.json':'71464cea7f801e5d98f6bd247e55e785220f616d44fa6d98c4d7907bb20a73e3','jobs-review-draft.json':'2147a037db360a33f0d127831174bab6f9e78ddd4dd72514d3d7b7f8fa56f469'};
  assert.equal(sha(bytes),expectedRawSha256[name],'Use exact independently captured browser draft bytes');
  const expected=await history.workRequest(selected,route,capacity);
  assert.equal(canonical(JSON.parse(raw)),canonical(expected),'Raw UI draft must equal locally reconstructed source-bound draft');
  const context={executorId:'verified-browser-draft-local-review',runtimeDigest,currentRuntimeDigest:runtimeDigest,
    expected:Object.fromEntries(BINDING_KEYS.map(key=>[key,selected.bindings[key]])),
    expectedCommission:{id:selected.attempt,branch:selected.attempt+'-'+route.toLowerCase(),route:route==='USDC'?'manager-usdc':'jobs-agialpha'},
    stages:STAGES,resourceCapacity:capacity,inspectCampaign:inspector};
  const receipt=await reviewDiscoveryRequest(raw,context);
  assert.equal(receipt.state,'accepted-local-review');assert.equal(receipt.remoteExecution,'unprovisioned');
  assert.equal(receipt.authority,'none');
  const unprovisioned=await reviewDiscoveryRequest(raw);assert.equal(unprovisioned.state,'unprovisioned');
  cases.push({name,rawBytes:bytes.length,rawSha256:sha(bytes),canonicalRequestDigest:sha(canonical(expected)),receipt,unprovisioned});
}
verifyAlphaSource(alphaRoot);
const report={schema:'agi-fleet/browser-draft-local-review-evidence/v1',source,profile,runtime:process.version,runtimeDigest,
  receiverSources:Object.fromEntries(['receiver.mjs','contract.mjs','qualify.mjs','alpha-source-pin.json'].map(name=>[name,sha(fs.readFileSync(path.join(fleetRoot,'discovery-lab',name)))])),
  workspaceSha256:sha(workspaceBytes),missionId:workspace.missionId,workspaceRevision:workspace.revision,
  retainedOutcomes:inspection.discovery.campaigns.map(row=>({state:row.state,controls:row.charter.controls,campaignDigest:row.campaignDigest})),
  selectedCampaignDigest:selected.campaignDigest,selectedAttempt:selected.attempt,selectedBindings:selected.bindings,
  checkedWorkspaceAndInspectorClosure:Object.fromEntries([...closure].map(relative=>[relative,pin.files[relative]])),
  passed:cases.length,total:2,cases,scope:'Direct local finite review of exact browser-downloaded bytes after fresh source/history validation. Local context is explicitly installed by this harness. Imported history does not grant authority.',
  remoteExecution:'unprovisioned',installedFleetService:false,operatorPackage:false,qualifiedRelease:false,organizationalIndependence:false};
fs.mkdirSync(destination);fs.writeFileSync(path.join(destination,'browser-native-receipts.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({profile,total:report.total,passed:report.passed,source:source.commit,workspaceSha256:report.workspaceSha256,output:destination}));
