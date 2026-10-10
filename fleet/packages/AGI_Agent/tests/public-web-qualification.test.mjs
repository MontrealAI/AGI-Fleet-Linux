import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalGrant} from '../compute/public-web-policy.mjs';
import {verifyPublicWebQualification, signPublicWebQualification, publicWebQualificationDigest} from '../compute/public-web-qualification.mjs';
import {qualificationFixture} from './helpers/public-web-qualification-fixture.mjs';
import {collectPublicWebQualification} from '../compute/public-web-qualification-collector.mjs';
import {reviewPublicWebQualificationCLI} from '../scripts/review-public-web-qualification.mjs';
const signed = (payload, key) => ({schema: 'agi-public-web-qualification-receipt/v1', payload, signature: crypto.sign(null, Buffer.from(canonicalGrant(payload)), key).toString('base64')});
const probe = (payload, id) => payload.observations.observations.find(item => item.id === id);
async function fixture(t) { const f = await qualificationFixture(); t.after(f.close); return f; }

test('independently signed receipt qualifies only its exact narrow technical scope and remains frozen', async t => {
  const f = await fixture(t), result = verifyPublicWebQualification(f.receipt, f.options);
  assert.equal(result.status, 'PASS'); assert.equal(result.productionQualified, false); assert.equal(result.paidSettlementQualified, false);
  assert(result.residuals.every(item => item.status === 'NOT_TESTED')); assert.equal(result.completedToolCalls, 2);
  assert.equal(result.receiptSha256, publicWebQualificationDigest(f.receipt));
  assert.throws(() => result.payload.observations.observations.pop(), TypeError);
});
test('only exact canonical separately pinned reviewer key works, never grant issuer or concatenated/private PEM', async t => {
  const f = await fixture(t);
  for (const reviewerPublicKey of [f.options.operatorPublicKey, f.reviewerPrivateKey, f.options.reviewerPublicKey + f.options.reviewerPublicKey, ' ' + f.options.reviewerPublicKey]) assert.throws(() => verifyPublicWebQualification(f.receipt, {...f.options, reviewerPublicKey}), /QUALIFICATION/);
  assert.throws(() => signPublicWebQualification(f.payload, f.h.keys.privateKey.export({type: 'pkcs8', format: 'pem'}), f.options), /REVIEWER_KEY/);
  const tampered = structuredClone(f.receipt); tampered.payload.observations.platform.uid = 900; assert.throws(() => verifyPublicWebQualification(tampered, f.options), /SIGNATURE/);
});
test('fresh image, policy, machine fingerprint, source hashes and independent review pin are required', async t => {
  const f = await fixture(t);
  for (const options of [{executionFingerprint: '1'.repeat(64)}, {candidatePolicyHash: '2'.repeat(64)}, {sourceHashes: {'public-web-policy.mjs': '0'.repeat(64)}}, {browserImageID: 'sha256:' + '8'.repeat(64)}, {now: f.payload.expiresAt}]) assert.throws(() => verifyPublicWebQualification(f.receipt, {...f.options, ...options}), /QUALIFICATION/);
});
test('reviewer signature cannot turn missing, mocked, stale, cross-session or paid observations into qualification', async t => {
  const f = await fixture(t);
  for (const mutate of [p => p.observations.synthetic = true, p => p.observations.platform.platform = 'linux', p => p.observations.platform.uid = p.observations.platform.signerUID, p => p.observations.sessionID = crypto.randomUUID(), p => p.observations.grantHash = 'f'.repeat(64), p => p.observations.containerIDs.proxy = 'f'.repeat(64), p => p.observations.observations.pop(), p => p.observations.observations[0].startedAt = p.browserEvidence.startedAt - 1, p => p.observations.collectedAt = p.browserEvidence.grant.payload.expiresAt, p => p.observations.observations[0].exitCode = 1, p => p.observations.observations[0].stdout = {status: 'PASS'}, p => p.productionQualified = true, p => p.paidSettlementQualified = true, p => p.residuals.pop(), p => p.observations.requiredExternalMeasurements = []]) {
    const changed = structuredClone(f.payload); mutate(changed); assert.throws(() => verifyPublicWebQualification(signed(changed, f.reviewerPrivateKey), f.options), /QUALIFICATION/);
  }
});
test('raw positive and negative outcomes are recomputed including same public target and exact required controls', async t => {
  const f = await fixture(t);
  for (const mutate of [p => probe(p, 'egress-control').stdout.tcp.connected = false, p => probe(p, 'egress-control').stdout.udpDNS.peerAddress = '127.0.0.1', p => probe(p, 'browser-negative').stdout.publicIPv4 = '8.8.8.8', p => probe(p, 'browser-negative').stdout.directPublicTCP.connected = true, p => probe(p, 'browser-negative').stdout.directUDPDNS.receivedBytes = 12, p => probe(p, 'browser-negative').stdout.privateTCP.pop(), p => probe(p, 'browser-negative').stdout.proxyRequests[0].status = 200, p => probe(p, 'proxy-enforcement-control').stdout.tests[1].second.status = 200, p => probe(p, 'proxy-enforcement-control').stdout.tests[0].connects.push('10.0.0.1'), p => probe(p, 'protected-browser-positive').stdout.headings = []]) {
    const changed = structuredClone(f.payload); mutate(changed); assert.throws(() => verifyPublicWebQualification(signed(changed, f.reviewerPrivateKey), f.options), /QUALIFICATION/);
  }
});
test('private Docker alias resolution stays a disclosed residual and cannot substitute for forbidden public DNS success', async t => {
  const f = await fixture(t), changed = structuredClone(f.payload), names = probe(changed, 'browser-negative').stdout.hostnameResolution;
  names.find(item => item.hostname === 'host.docker.internal').addresses = ['192.168.65.254'];
  assert.equal(verifyPublicWebQualification(signed(changed, f.reviewerPrivateKey), f.options).status, 'PASS');
  names.find(item => item.hostname === 'example.com').addresses = ['1.1.1.1'];
  assert.throws(() => verifyPublicWebQualification(signed(changed, f.reviewerPrivateKey), f.options), /NEGATIVE_FAILED/);
});
test('fresh normal Gateway trace and actual browser correlation remain required under reviewer signature', async t => {
  const f = await fixture(t);
  for (const mutate of [p => p.browserEvidence.gatewayTrace.calls = [], p => p.browserEvidence.dependencyMode = 'test-double', p => p.browserEvidence.cleanup.status = 'BLOCKED', p => p.browserEvidence.events[1].fixtureObservationMatches = false]) {
    const changed = structuredClone(f.payload); mutate(changed); assert.throws(() => verifyPublicWebQualification(signed(changed, f.reviewerPrivateKey), f.options), /GATEWAY_EVIDENCE_REQUIRED/);
  }
});
test('actual collector output schema matches verifier, but injected measurements remain explicitly unqualified', async t => {
  const f = await fixture(t), prepared = f.h.worker.publicWeb.entries.get(f.request.id).prepared;
  f.h.c.signerUID = 501;
  const active = {...prepared, proxyContainerID: f.payload.observations.containerIDs.proxy, expiresAt: f.payload.browserEvidence.grant.payload.expiresAt};
  let clock = f.payload.browserEvidence.startedAt + 101;
  const values = f.payload.observations.observations;
  const captured = await collectPublicWebQualification({worker: f.h.worker, active, operatorPublicKey: f.options.operatorPublicKey, expectedGrantHash: f.payload.observations.grantHash, allowLocalRuntime: true, session: {execute: async () => ({url: 'https://example.com/', title: 'Example Domain', headings: [{level: 'h1', text: 'Example Domain'}], text: 'Example Domain', grantHash: f.payload.observations.grantHash, untrusted: true})}, dependencies: {platform: 'darwin', now: () => clock++, verify: async () => ({}), identity: () => f.options, run: async (_executable, args) => {
    const id = args.includes('python3') ? 'browser-negative' : args.some(arg => arg.includes('agi-public-web-egress-probe/v1')) ? 'egress-control' : 'proxy-enforcement-control';
    return {status: 0, code: 'OK', stdout: JSON.stringify(values.find(item => item.id === id).stdout)};
  }}});
  assert.equal(captured.synthetic, true);
  const payload = {...f.payload, observations: captured};
  assert.throws(() => verifyPublicWebQualification(signed(payload, f.reviewerPrivateKey), f.options), /ACTUAL_OBSERVATIONS_REQUIRED/);
  // Schema compatibility only: this explicitly fabricated variant uses ephemeral
  // test keys and is never exported as real evidence. It cannot establish Mac behavior.
  const schemaOnly = structuredClone(payload); schemaOnly.observations.synthetic = false; schemaOnly.observations.platform = f.payload.observations.platform;
  assert.equal(verifyPublicWebQualification(signed(schemaOnly, f.reviewerPrivateKey), f.options).status, 'PASS');
});
test('reviewer CLI requires exact digest approval, private local files and no output overwrite', async t => {
  const f = await fixture(t), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-reviewer-cli-')); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = (name, value) => { const target = path.join(directory, name); fs.writeFileSync(target, value, {mode: 0o600}); return target; };
  const evidence = file('evidence.json', JSON.stringify({schema: 'agi-public-web-qualification-export/v1', payload: f.payload, verification: f.options})), key = file('reviewer.pem', f.reviewerPrivateKey), trusted = file('reviewer-public.pem', f.options.reviewerPublicKey), destination = path.join(directory, 'receipt.json');
  const argv = ['--evidence', evidence, '--reviewer-key', key, '--trusted-reviewer-public-key', trusted, '--output', destination];
  const invoke = async answer => { const input = new PassThrough(), output = new PassThrough(); let shown = ''; output.on('data', chunk => { shown += chunk; if (chunk.toString().includes('Type the complete evidence SHA-256')) queueMicrotask(() => input.write(answer + '\n')); }); try { return {result: await reviewPublicWebQualificationCLI({argv, input, output, now: () => f.options.now}), shown}; } finally { input.destroy(); output.destroy(); } };
  await assert.rejects(invoke('APPROVE'), /NOT_APPROVED/); assert.equal(fs.existsSync(destination), false);
  const completed = await invoke(publicWebQualificationDigest(f.payload)); assert.equal(completed.result.productionQualified, false); assert(!completed.shown.includes(f.reviewerPrivateKey)); assert.match(completed.shown, /remain unqualified/);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600); assert.equal(verifyPublicWebQualification(JSON.parse(fs.readFileSync(destination)), f.options).status, 'PASS');
  await assert.rejects(invoke(publicWebQualificationDigest(f.payload)), /OUTPUT_EXISTS/);
  fs.chmodSync(key, 0o644); await assert.rejects(invoke(publicWebQualificationDigest(f.payload)), /FILE_UNSAFE/);
});
test('actual coordinator export passes the reviewer CLI subprocess without removing its schema', async t => {
  // Component-contract fixture only: synthetic observations and ephemeral keys
  // exercise the exported bytes, CLI entry point, approval and receipt verification.
  const f = await qualificationFixture({now: Date.now() - 1000}); t.after(f.close);
  const coordinator = f.h.worker.publicWeb, entry = coordinator.entries.get(f.request.id), {now, ...identity} = f.options;
  coordinator.dependencyMode = 'installed-runtime'; // Explicitly fabricated test provenance; never release evidence.
  Object.assign(entry, {identity, observations: f.payload.observations, startedAt: f.payload.browserEvidence.startedAt, events: f.payload.browserEvidence.events, approval: f.payload.browserEvidence.grant, gateway: {finish: async () => f.payload.browserEvidence.gatewayTrace}, active: {proxyContainerID: f.payload.browserEvidence.proxyContainerID, close: async () => ({status: 'PASS'})}});
  f.h.setClock(f.payload.issuedAt); await coordinator.persistEvidence(entry, {status: 'PASS', closedAt: f.h.clock()});
  const evidenceFile = path.join(entry.prepared.plan.spec.sessionDirectory, 'qualification-export.json'), evidence = JSON.parse(fs.readFileSync(evidenceFile));
  assert.equal(evidence.schema, 'agi-public-web-qualification-export/v1');
  const keyFile = path.join(f.h.dir, 'reviewer-private.pem'), publicFile = path.join(f.h.dir, 'reviewer-public.pem'), outputFile = path.join(f.h.dir, 'reviewed-receipt.json');
  fs.writeFileSync(keyFile, f.reviewerPrivateKey, {mode: 0o600}); fs.writeFileSync(publicFile, identity.reviewerPublicKey, {mode: 0o600});
  const script = fileURLToPath(new URL('../scripts/review-public-web-qualification.mjs', import.meta.url));
  const invoke = file => spawnSync(process.execPath, [script, '--evidence', file, '--reviewer-key', keyFile, '--trusted-reviewer-public-key', publicFile, '--output', outputFile], {input: publicWebQualificationDigest(evidence.payload) + '\n', encoding: 'utf8', timeout: 10000});
  const child = invoke(evidenceFile); assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /Signed technical receipt saved:/); assert(!child.stdout.includes(f.reviewerPrivateKey));
  assert.equal(verifyPublicWebQualification(JSON.parse(fs.readFileSync(outputFile)), {...identity, now: Date.now()}).status, 'PASS'); assert.equal(fs.statSync(outputFile).mode & 0o777, 0o600);
  for (const invalid of [{payload: evidence.payload, verification: evidence.verification}, {...evidence, schema: 'unrecognized'}, {...evidence, extra: true}]) {
    const invalidFile = path.join(f.h.dir, 'invalid-export.json'); fs.writeFileSync(invalidFile, JSON.stringify(invalid), {mode: 0o600});
    const result = invoke(invalidFile); assert.equal(result.status, 1); assert.match(result.stderr, /PUBLIC_WEB_REVIEW_EVIDENCE_INVALID/);
  }
});
