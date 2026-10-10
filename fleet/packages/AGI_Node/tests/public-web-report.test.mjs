// Contract fixtures only: no Mac, live provider, reviewer or payment executes.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {qualificationFixture} from './helpers/public-web-qualification-fixture.mjs';
import {verifyPublicWebCommissioningEvidence} from '../compute/public-web-evidence.mjs';
import {validatePublicWebExport} from '../src/control/public-web-export.mjs';
import {projectQualificationStatus, createPublicWebReport, validatePublicWebReport, publicWebReportView} from '../src/control/public-web-report.mjs';

async function fixture(t) {
  const f = await qualificationFixture({now: Date.now() - 1000}); t.after(f.close);
  const {now, ...verification} = f.options;
  const qualificationExport = {schema: 'agi-public-web-qualification-export/v1', payload: structuredClone(f.payload), verification};
  const input = {
    role: f.payload.executionAdmission.role,
    requestID: f.request.id,
    fixtureSha256: f.payload.executionAdmission.acceptedSpecSha256,
    runtimeSha256: f.payload.executionAdmission.runtimeSha256,
    policyHash: f.options.candidatePolicyHash,
    completedAt: now,
    browserEvidence: verifyPublicWebCommissioningEvidence(f.payload.browserEvidence, {requestID: f.request.id, executionAdmission: f.payload.executionAdmission, policyHash: f.options.candidatePolicyHash, operatorPublicKey: f.options.operatorPublicKey}),
    qualificationStatus: {status: 'EXPORTED', code: null},
    qualificationExport,
  };
  assert.equal(input.browserEvidence.status, 'PASS');
  return {...f, input, qualificationExport};
}
const marker = 'SYNTHETIC_PRIVATE_KEY_MARKER';
const probe = (value, id) => value.payload.observations.observations.find(item => item.id === id).stdout;
function rejectedExport(input) {
  try {
    const report = createPublicWebReport(input);
    assert.equal(report.status, 'BLOCKED'); assert.equal(report.qualificationExport, null);
  } catch (error) { assert.match(error.message, /^PUBLIC_WEB_[A-Z0-9_]+$/); }
}

test('qualification status preserves known causes and replaces arbitrary provider text with fixed reasons', () => {
  const known = projectQualificationStatus({status: 'BLOCKED', code: 'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED', reason: marker, secret: marker});
  assert.equal(known.status, 'BLOCKED'); assert.equal(known.code, 'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED'); assert.equal(typeof known.reason, 'string');
  for (const raw of [{status: 'BLOCKED', code: marker, reason: marker}, {status: 'BLOCKED', code: 'PUBLIC_WEB_' + marker}, {status: marker, code: marker}, null]) {
    const value = projectQualificationStatus(raw); assert.equal(value.status, 'BLOCKED'); assert(!JSON.stringify(value).includes(marker));
  }
  assert.deepEqual(Object.keys(known).sort(), ['code', 'reason', 'status']);
});

test('correlated browser PASS without qualification export remains BLOCKED', async t => {
  const f = await fixture(t), report = createPublicWebReport({...f.input, qualificationExport: null, qualificationStatus: {status: 'BLOCKED', code: 'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED'}});
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.browserEvidence.status, 'PASS'); assert.equal(report.qualificationExport, null);
  assert.equal(report.productionQualified, false); assert.equal(report.moneyMoved, false); assert.equal(report.published, false);
});

test('valid export is retained exactly for independent review and survives JSON reload', async t => {
  const f = await fixture(t), report = createPublicWebReport(f.input);
  assert.equal(report.status, 'READY_FOR_REVIEW'); assert.equal(report.qualificationStatus.status, 'EXPORTED');
  assert.deepEqual(report.qualificationExport, f.qualificationExport);
  const restored = validatePublicWebReport(JSON.parse(JSON.stringify(report)));
  assert.deepEqual(restored.qualificationExport, f.qualificationExport); assert.equal(restored.status, 'READY_FOR_REVIEW');
  assert.equal(restored.productionQualified, false); assert.equal(restored.paidSettlementQualified, false);
});

test('expiry blocks current readiness while preserving historical evidence download unchanged', async t => {
  const f = await fixture(t), report = createPublicWebReport(f.input), view = publicWebReportView(report, {now: f.payload.expiresAt + 1});
  assert.equal(view.stale, true); assert.equal(view.qualificationStatus.status, 'BLOCKED'); assert.equal(view.status, 'BLOCKED');
  assert.deepEqual(view.qualificationExport, f.qualificationExport); assert.deepEqual(report.qualificationExport, f.qualificationExport);
});

test('cross-request, specification, runtime and policy exports cannot enter a saved report', async t => {
  const f = await fixture(t);
  for (const patch of [{requestID: crypto.randomUUID()}, {fixtureSha256: '0'.repeat(64)}, {runtimeSha256: '0'.repeat(64)}, {policyHash: '0'.repeat(64)}, {role: 'reviewer'}]) rejectedExport({...f.input, ...patch});
  const invalid = structuredClone(f.input); invalid.qualificationExport.verification.candidatePolicyHash = '0'.repeat(64); rejectedExport(invalid);
});

test('strict public export rejects hidden keys throughout proof and freeform probe strings', async t => {
  const f = await fixture(t);
  const mutations = [
    value => { value.privateKey = marker; },
    value => { value.verification.privateKey = marker; },
    value => { value.payload.executionAdmission.privateKey = marker; },
    value => { value.payload.browserEvidence.privateKey = marker; },
    value => { value.payload.browserEvidence.gatewayTrace.privateKey = marker; },
    value => { value.payload.browserEvidence.gatewayTrace.calls[0].privateKey = marker; },
    value => { value.payload.browserEvidence.events[0].privateKey = marker; },
    value => { value.payload.browserEvidence.cleanup.privateKey = marker; },
    value => { probe(value, 'egress-control').privateKey = marker; },
    value => { probe(value, 'egress-control').dns[0].privateKey = marker; },
    value => { probe(value, 'browser-negative').directPublicTCP.error = marker; },
    value => { probe(value, 'browser-negative').resolvConf = marker; },
    value => { probe(value, 'browser-negative').proxyRequests[0].firstLine += ' ' + marker; },
    value => { probe(value, 'protected-browser-positive').headings.push({level: 'h2', text: marker}); },
    value => { probe(value, 'proxy-enforcement-control').tests[0].response.body = marker; },
    value => { value.verification.operatorPublicKey = f.reviewerPrivateKey; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(f.qualificationExport); mutate(value);
    assert.throws(() => validatePublicWebExport(value, f.input), /PUBLIC_WEB_QUALIFICATION_INVALID/);
    rejectedExport({...f.input, qualificationExport: value});
  }
});

test('actual collector response fields remain admissible without changing signed grant bytes', async t => {
  const f = await fixture(t), value = structuredClone(f.qualificationExport), tests = probe(value, 'proxy-enforcement-control').tests;
  value.payload.browserEvidence.purpose = 'commissioning';
  value.payload.browserEvidence.events.push({action:'scroll',status:'failed-or-uncertain',startedAt:f.payload.browserEvidence.startedAt,finishedAt:f.payload.browserEvidence.startedAt+1,commandSHA256:'a'.repeat(64)});
  tests.find(item => item.id === 'mixed-dns').response = {status: 403, location: null, body: '{"error":"PUBLIC_WEB_DNS_NOT_PUBLIC"}'};
  const rebind = tests.find(item => item.id === 'rebind-after-public'); rebind.first.location = null; rebind.second = {status: 403, location: null, body: '{"error":"PUBLIC_WEB_DNS_NOT_PUBLIC"}'};
  const redirect = tests.find(item => item.id === 'redirect-reauthorization'); redirect.first.body = ''; redirect.second = {status: 403, location: null, body: '{"error":"PUBLIC_WEB_HOST_NOT_APPROVED"}'};
  tests.find(item => item.id === 'literal-private').responses = ['127.0.0.1', '169.254.169.254', '168.63.129.16'].map(target => ({target, status: 403, location: null, body: '{"error":"PUBLIC_WEB_HOST_INVALID"}'}));
  const clean = validatePublicWebExport(value, f.input); assert.deepEqual(clean, value); assert.deepEqual(clean.payload.browserEvidence.grant, value.payload.browserEvidence.grant);
});

test('persisted report rejects forged promotion and unknown secret fields', async t => {
  const f = await fixture(t), report = createPublicWebReport(f.input);
  for (const patch of [{productionQualified: true}, {paidSettlementQualified: true}, {privateKey: marker}]) assert.throws(() => validatePublicWebReport({...report, ...patch}), /PUBLIC_WEB_/);
  const hidden = structuredClone(report); hidden.qualificationExport.payload.browserEvidence.cleanup.privateKey = marker;
  assert.throws(() => validatePublicWebReport(hidden), /PUBLIC_WEB_/);
});
