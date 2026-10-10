// The coordinator and signer paths are real; all browser/Mac observations are synthetic contract fixtures.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {qualificationFixture} from './helpers/public-web-qualification-fixture.mjs';
import {Controller} from '../src/control/controller.mjs';
import {Companion} from '../src/control/companion.mjs';
import {createPublicWebReport} from '../src/control/public-web-report.mjs';
import {verifyPublicWebCommissioningEvidence} from '../compute/public-web-evidence.mjs';
test('unmodified coordinator export survives Companion projection, signer persistence and reload',async()=>{
 const f=await qualificationFixture({now:Date.now()-1000}),home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-report-assembly-')),controller=new Controller(home);
 try{
  const coordinator=f.h.worker.publicWeb,entry=coordinator.entries.get(f.request.id),{now,...identity}=f.options;
  coordinator.dependencyMode='installed-runtime'; // Fixture label only; no physical execution claim.
  Object.assign(entry,{identity,observations:f.payload.observations,startedAt:f.payload.browserEvidence.startedAt,events:f.payload.browserEvidence.events,approval:f.payload.browserEvidence.grant,gateway:{finish:async()=>f.payload.browserEvidence.gatewayTrace},active:{proxyContainerID:f.payload.browserEvidence.proxyContainerID,close:async()=>({status:'PASS'})}});
  f.h.setClock(f.payload.issuedAt);await coordinator.persistEvidence(entry,{status:'PASS',closedAt:f.h.clock()});
  const output=JSON.parse(fs.readFileSync(path.join(entry.prepared.plan.spec.sessionDirectory,'qualification-export.json'))),observed=JSON.parse(fs.readFileSync(path.join(entry.prepared.plan.spec.sessionDirectory,'browser-observation.json')));
  await controller.createVault('PUBLIC ASSEMBLY FIXTURE PASSWORD');controller.companion.fetch=async()=>Response.json({publicWeb:observed,qualification:output,qualificationStatus:{status:'EXPORTED',code:null}});
  const projection=await controller.companion.readPublicWebEvidence(f.request.id,{includeQualification:true});assert.deepEqual(projection.qualification,output);
  const browserEvidence=verifyPublicWebCommissioningEvidence(projection.publicWeb,{requestID:f.request.id,executionAdmission:entry.executionAdmission,policyHash:f.options.candidatePolicyHash,operatorPublicKey:f.options.operatorPublicKey});assert.equal(browserEvidence.status,'PASS');
  const report=createPublicWebReport({role:entry.role,requestID:f.request.id,fixtureSha256:entry.executionAdmission.acceptedSpecSha256,runtimeSha256:entry.executionAdmission.runtimeSha256,policyHash:f.options.candidatePolicyHash,completedAt:f.h.clock(),browserEvidence,qualificationStatus:projection.qualificationStatus,qualificationExport:projection.qualification});assert.equal(report.status,'READY_FOR_REVIEW');assert.deepEqual(report.qualificationExport,output);
  controller.companion.savePublicWebReport(report);assert.deepEqual(controller.companionPublicWebReport().report.qualificationExport,output);const restarted=new Companion(home,()=>null);assert.equal(restarted.stateError,undefined);assert.deepEqual(restarted.state.lastPublicWebReport.qualificationExport,output);await restarted.close();
  assert.equal(controller.companion.state.calls.length,0);assert.equal(fs.statSync(controller.companion.stateFile).mode&0o777,0o600);await controller.lock();assert.throws(()=>controller.companionPublicWebReport(),/NODE_LOCKED/);
 }finally{await controller.close();await f.close();fs.rmSync(home,{recursive:true,force:true});}
});
