// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha256} from './bridge.mjs';
export function inspectDashboardEvidence(root){
  const bytes=name=>fs.readFileSync(path.join(root,name)),read=name=>JSON.parse(bytes(name)),native=read('accepted/computer-return.json'),service=read('service-observation.json'),proof=read('accepted/service-case.json'),browser=read('accepted/dashboard/dashboard-export-evidence.json');
  assert.equal(browser.schema,'agi-fleet/real-dashboard-export-observation/v1');assert.equal(browser.evidenceClass,'REAL_CHROMIUM_ACTUAL_SAVED_SERVICE_OUTPUT');assert.equal(browser.image,native.execution.image);assert.equal(browser.driverSha256,sha256(fs.readFileSync(new URL('./fleet-dashboard-export.py',import.meta.url))));assert.equal(browser.osNetworkIsolationClaim,false);assert.equal(browser.nativeWorkerNetwork,'none');assert.equal(browser.traceRecorded,false);assert.equal(browser.credentialRetainedInEvidence,false);assert.equal(browser.providerRequests,0);assert.equal(browser.realWallets,false);assert.deepEqual(browser.unexpectedExternalRequests,[]);assert.deepEqual(browser.pageErrors,[]);assert.equal(browser.cases.length,2);
  assert.deepEqual(proof.serviceReceipt.result.files,[],'Native service returns an artifact manifest, not invented inline files');
  const returnSha=sha256(bytes('accepted/computer-return.json'));assert.equal(service.dashboard.observationSha256,sha256(bytes('accepted/dashboard/dashboard-export-evidence.json')));assert.equal(service.dashboard.nativeReturnSha256,returnSha);assert.equal(service.dashboard.containerClosed,true);
  for(const language of ['en','fr']){
    const record=browser.cases.find(item=>item.language===language);assert(record);assert.equal(record.run,proof.run);assert.equal(record.actor,proof.actor);assert.equal(record.actualDashboardControls,true);assert.equal(record.credentialFieldMasked,true);assert.equal(record.credentialFieldCleared,true);
    const prefix='accepted/dashboard/'+language;assert.equal(record.return.file,'computer-return.json');assert.equal(bytes(prefix+'/computer-return.json').toString('utf8'),bytes('accepted/computer-return.json').toString('utf8'));assert.equal(record.return.sha256,returnSha);assert.equal(record.return.bytes,bytes('accepted/computer-return.json').length);
    assert.match(record.artifact.file,/^screen-\d{3}\.png$/);const observed=native.receipt.screenshots.find(item=>item.file===record.artifact.file);assert(observed);assert.equal(sha256(bytes(prefix+'/'+record.artifact.file)),observed.sha256);assert.equal(record.artifact.sha256,observed.sha256);assert.equal(record.artifact.bytes,bytes('accepted/native/'+record.artifact.file).length);assert.equal(service.dashboard.artifactSha256,observed.sha256);
    const screenshot=bytes(prefix+'/dashboard.png');assert(screenshot.length<8_000_000);assert(screenshot.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')));
  }
  return {actualDashboardExportSemanticallyReplayed:true,languages:['en','fr'],nativeReturnSha256:returnSha,downstreamInputFile:'accepted/dashboard/en/computer-return.json',ephemeralCredentialInEvidence:false,networkMode:browser.networkMode,nativeWorkerNetwork:'none'};
}
