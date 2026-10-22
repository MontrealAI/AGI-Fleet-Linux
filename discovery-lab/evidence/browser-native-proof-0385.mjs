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
assert.equal(source.commit,'0385df4c9728db19c396e039cd04678eebfddb9e');
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
assert.equal(sha(workspaceBytes),'fb255c1bf33db82b240c452bcdd1334260d7934d5d2eed984f261109f34bd340');
const workspace=await workspaceModule.parseWorkspace(workspaceBytes.toString());
assert.equal(workspace.missionId,'capability-14e2314c-f9c3-4e54-a1fc-4e1d8cc28540');
const inspection=await workspaceModule.inspectWorkspace(workspace);
assert.deepEqual(inspection.discovery.campaigns.map(row=>row.state),['inconclusive','accepted','rejected','accepted']);
// Deliberate local selection from freshly verified history, not request selfclaims.
const candidates=inspection.discovery.campaigns.filter(row=>row.state==='accepted'&&row.charter.controls===4);
assert.equal(candidates.length,1);const selected=candidates[0];
const sources={modelDigest:pin.nativeClosure['examples/successor-capability/discovery-lab.mjs'],
  sourceDigest:pin.generatedSourcesHash,evaluatorDigest:pin.nativeClosure['examples/successor-capability/discovery-lab-checker.mjs']};
for(const [key,value] of Object.entries(sources))assert.equal(selected.bindings[key],value);
const {DISCOVERY_LAB_INSPECTION_CHECKS}=await load(modulePath('discovery-lab-contract.mjs'));
assert.equal(DISCOVERY_LAB_INSPECTION_CHECKS,10000);
// Independently reconstruct the exact verified bridge's local policy from current history.
// No imported work-request capacity is used to install this context.
const chain=[];
for(let item=selected;item;item=item.parent)chain.push(item.charter);
const capacity={acquisitions:0,checking:10000+DISCOVERY_LAB_INSPECTION_CHECKS,elapsedMs:120000,installations:0,
  memoryBytes:10000000,search:0,storageBytes:4000000,workerCapacity:4};
for(const charter of chain)for(const key of ['acquisitions','search','checking','installations'])
  capacity[key]+=charter.budget[key];
const runtimeDigest=await payloadDigest({profile,...runtime,nativeClosure:pin.nativeClosure});
const inspector=createInspector(sources),cases=[];
for(const [name,route] of [['manager-review-draft.json','USDC'],['jobs-review-draft.json','AGIALPHA']]) {
  const bytes=fs.readFileSync(path.join(inputRoot,name)),raw=bytes.toString();
  const expectedRawSha256={'manager-review-draft.json':'a054a86a58a9aa38eee25c831cc7e5948847504d6e0da4d03fcadf2d499661e4','jobs-review-draft.json':'6911d09b818643feae3a6edd0c150a3124ccd5bae933b9c8282254ee00c5fb16'};
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
  trustedCapacity:capacity,capacityDerivation:{routeAdmissionAllowance:10000,declaredInspectionChecks:DISCOVERY_LAB_INSPECTION_CHECKS,
    replayCharters:chain,source:'Verified pinned UI bridge and contract; freshly reconstructed current/ancestor history.'},
  retainedOutcomes:inspection.discovery.campaigns.map(row=>({state:row.state,controls:row.charter.controls,campaignDigest:row.campaignDigest})),
  selectedCampaignDigest:selected.campaignDigest,selectedAttempt:selected.attempt,selectedBindings:selected.bindings,
  checkedWorkspaceAndInspectorClosure:Object.fromEntries([...closure].map(relative=>[relative,pin.files[relative]])),
  passed:cases.length,total:2,cases,scope:'Direct local finite review of exact browser-downloaded bytes after fresh source/history validation. Local context is explicitly installed by this harness. Imported history does not grant authority.',
  remoteExecution:'unprovisioned',installedFleetService:false,operatorPackage:false,qualifiedRelease:false,organizationalIndependence:false};
fs.mkdirSync(destination);fs.writeFileSync(path.join(destination,'browser-native-receipts.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({profile,total:report.total,passed:report.passed,source:source.commit,workspaceSha256:report.workspaceSha256,output:destination}));
