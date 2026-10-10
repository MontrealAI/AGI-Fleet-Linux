import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha256} from '../src/util.mjs';
import {qualificationFixture} from './helpers/public-web-qualification-fixture.mjs';
import {signPublicWebQualification,verifyPublicWebQualification} from '../compute/public-web-qualification.mjs';
import {readPublicWebQualification} from '../compute/public-web-qualified-runtime.mjs';
// A component-contract test using explicitly synthetic observations. This does
// not execute Docker, claim a physical Mac result, or mint a usable release receipt.
test('actual coordinator export assembly is accepted by the independent receipt verifier schema',async()=>{const f=await qualificationFixture();try{
 const coordinator=f.h.worker.publicWeb,entry=coordinator.entries.get(f.request.id),{now,...identity}=f.options;
 coordinator.dependencyMode='installed-runtime'; // Synthetic provenance for this verifier contract test only.
 Object.assign(entry,{identity,observations:f.payload.observations,startedAt:f.payload.browserEvidence.startedAt,events:f.payload.browserEvidence.events,approval:f.payload.browserEvidence.grant,gateway:{finish:async()=>f.payload.browserEvidence.gatewayTrace},active:{proxyContainerID:f.payload.browserEvidence.proxyContainerID,close:async()=>({status:'PASS'})}});
 f.h.setClock(f.payload.issuedAt);await coordinator.persistEvidence(entry,{status:'PASS',closedAt:f.h.clock()});
 const output=JSON.parse(fs.readFileSync(path.join(entry.prepared.plan.spec.sessionDirectory,'qualification-export.json')));
 assert.equal(output.schema,'agi-public-web-qualification-export/v1');assert.equal(output.payload.productionQualified,false);assert.equal(output.payload.paidSettlementQualified,false);assert.equal(sha256(canonical(output)),entry.record.publicWeb.qualificationExportSHA256);
 const receipt=signPublicWebQualification(output.payload,f.reviewerPrivateKey,{...output.verification,now:f.h.clock()});assert.equal(verifyPublicWebQualification(receipt,{...output.verification,now:f.h.clock()}).status,'PASS');
 const changed=structuredClone(output);changed.payload.observations.synthetic=true;assert.throws(()=>signPublicWebQualification(changed.payload,f.reviewerPrivateKey,{...output.verification,now:f.h.clock()}),/ACTUAL_OBSERVATIONS_REQUIRED/);
 }finally{await f.close();}});
test('qualified runtime reads exact private receipt and rejects stale bindings, changed bytes and unsafe permissions',async()=>{const f=await qualificationFixture();try{
 const c=f.h.c,directory=path.join(c.profileDir,'public-web-qualification'),file=path.join(directory,'receipt.json');fs.mkdirSync(directory,{mode:0o700});fs.writeFileSync(file,JSON.stringify(f.receipt),{mode:0o600});const digest=sha256(canonical(f.receipt));Object.assign(c.publicWebPolicy,{mode:'qualified',qualificationReceiptFile:file,qualificationReceiptSha256:digest,qualificationEvidenceSha256:digest});
 const options={now:f.options.now,identity:()=>f.options};assert.equal(readPublicWebQualification(c,options).summary.status,'PASS');
 assert.throws(()=>readPublicWebQualification(c,{...options,identity:()=>({...f.options,executionFingerprint:'0'.repeat(64)})}),/BINDING/);
 assert.throws(()=>readPublicWebQualification(c,{...options,now:f.payload.expiresAt}),/STALE/);
 fs.chmodSync(file,0o644);assert.throws(()=>readPublicWebQualification(c,options),/PRIVATE_FILE/);fs.chmodSync(file,0o600);
 fs.writeFileSync(file,JSON.stringify({...f.receipt,signature:'a'.repeat(88)}));assert.throws(()=>readPublicWebQualification(c,options),/RECEIPT_CHANGED/);
 }finally{await f.close();}});
