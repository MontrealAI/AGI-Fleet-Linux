import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomic, Journal } from '../engine/core.mjs';
import { signAuthority, checkAuthority, checkNativePermission, verifySigned } from '../engine/authority.mjs';
import { NativeSession } from '../engine/native.mjs';
import { seal, open } from '../engine/envelope.mjs';
import { runNative, grantBody, signGrant } from '../engine/runner.mjs';
import specCore from '../engine/core/computer-work.cjs';
import { fixture } from './fixture.mjs';

const now = 1900000000;
function authorityFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-linux-authority-'));
  const key = crypto.generateKeyPairSync('ed25519');
  const config = {nodeId:'linux-task-account', role:'agent', revocationFile:path.join(dir, 'authority.json'), operatorPublicKey:key.publicKey.export({format:'pem', type:'spki'})};
  const grant = {nonce:crypto.randomUUID()};
  const body = {schema:'agi-native-authority/v1', nodeId:config.nodeId, role:config.role, sequence:1, issuedAt:now-1, expiresAt:now+3600, disabled:false, revokedGrantNonces:[]};
  atomic(config.revocationFile, signAuthority(body, key.privateKey));
  const journal = new Journal(path.join(dir, 'journal'));
  t.after(() => {journal.close(); fs.rmSync(dir, {recursive:true, force:true});});
  return {dir, key, config, grant, body, journal};
}
function permissions(enforcement = 'whole-account') {
  return {profile:'computer-work/v3', permissions:{agent:{enforcement, allowedActions:['screenshot','type'], expiresAt:now+60}}};
}
function sessionFixture(t, invoke) {
  const f = authorityFixture(t);
  f.journal.start('run', 'a'.repeat(64), 'b'.repeat(64), 'agent', 'pilot', 20, '1', '10');
  let generation = 'generation-one';
  const gateway = {
    node:async () => ({computerUse:{provider:{generation}, actions:['screenshot','type','left_click']}}),
    invoke:async (command, args) => command === 'screen.snapshot'
      ? {displayFrameId:crypto.randomUUID(), screenIndex:0, width:100, height:80, format:'png', base64:Buffer.from('synthetic-screen').toString('base64')}
      : invoke(command, args),
  };
  const session = new NativeSession(gateway, f.journal, 'run', {maxActions:8}, {
    now:() => now*1000,
    beforeDispatch:() => checkAuthority(f.config, f.grant, f.journal, {now, required:true}),
  });
  return {...f, session, restart:() => {generation='generation-two';}};
}

test('signed authority binds the exact Linux node and role and detects modified bytes', t => {
  const f = authorityFixture(t);
  checkAuthority(f.config, f.grant, f.journal, {now, required:true});
  const altered = signAuthority(f.body, f.key.privateKey);
  altered.body.role = 'reviewer';
  assert.throws(() => verifySigned(altered, f.config.operatorPublicKey), /SIGNED_RECORD/);
  assert.throws(() => checkAuthority({...f.config, role:'reviewer'}, f.grant, f.journal, {now, required:true}), /AUTHORITY_RECORD/);
  assert.throws(() => checkAuthority({...f.config, nodeId:'other-linux-account'}, f.grant, f.journal, {now, required:true}), /AUTHORITY_RECORD/);
});

test('revoked grant cannot be restored by a later record omitting its nonce', t => {
  const f = authorityFixture(t);
  atomic(f.config.revocationFile, signAuthority({...f.body, sequence:2, revokedGrantNonces:[f.grant.nonce]}, f.key.privateKey));
  assert.throws(() => checkAuthority(f.config, f.grant, f.journal, {now, required:true}), /AUTHORITY_REVOKED/);
  atomic(f.config.revocationFile, signAuthority({...f.body, sequence:3}, f.key.privateKey));
  assert.throws(() => checkAuthority(f.config, f.grant, f.journal, {now, required:true}), /AUTHORITY_REVOKED/);
});

test('expired, disabled, missing, or rolled-back authority blocks execution', t => {
  const f = authorityFixture(t);
  checkAuthority(f.config, f.grant, f.journal, {now, required:true});
  assert.throws(() => checkAuthority(f.config, f.grant, f.journal, {now:f.body.expiresAt, required:true}), /AUTHORITY_RECORD/);
  assert.throws(() => checkAuthority({...f.config, revocationFile:null}, f.grant, f.journal, {now, required:true}), /REVOCATION_REQUIRED/);
  atomic(f.config.revocationFile, signAuthority({...f.body, sequence:2, disabled:true}, f.key.privateKey));
  assert.throws(() => checkAuthority(f.config, f.grant, f.journal, {now, required:true}), /AUTHORITY_REVOKED/);
  atomic(f.config.revocationFile, signAuthority(f.body, f.key.privateKey));
  assert.throws(() => checkAuthority(f.config, f.grant, f.journal, {now, required:true}), /ROLLBACK/);
});

test('production authority owned by the compute user is never accepted', t => {
  const f = authorityFixture(t);
  assert.throws(() => checkAuthority(f.config, f.grant, f.journal, {now, required:true, requireExternalOwner:true}), /AUTHORITY_WRITABLE_BY_COMPUTE/);
});

test('job action authority expires and cannot imply unavailable fine-grained enforcement', () => {
  const spec = permissions();
  checkNativePermission(spec, 'agent', 'type', now);
  assert.throws(() => checkNativePermission(spec, 'agent', 'type', now+60), /ACTION_AUTHORITY/);
  assert.throws(() => checkNativePermission(spec, 'agent', 'left_click', now), /ACTION_AUTHORITY/);
  assert.throws(() => checkNativePermission(permissions('broker-scoped'), 'agent', 'type', now), /SCOPED_BROKER_ADAPTER_REQUIRED/);
  assert.throws(() => checkNativePermission(permissions('observe-only'), 'agent', 'type', now), /READ_ONLY/);
});

test('revocation after a screenshot blocks mutation before transport or budget reservation', async t => {
  let mutations = 0;
  const f = sessionFixture(t, async () => {mutations++; return {ok:true};});
  await f.session.act('screenshot');
  const before = f.journal.row('run').actions;
  atomic(f.config.revocationFile, signAuthority({...f.body, sequence:2, disabled:true}, f.key.privateKey));
  await assert.rejects(f.session.act('type', {text:'must not be sent'}), /AUTHORITY_REVOKED/);
  assert.equal(mutations, 0);
  assert.equal(f.journal.row('run').actions, before);
});

test('ambiguous Linux desktop mutation consumes the frame and cannot be replayed or resumed', async t => {
  let mutations = 0;
  const f = sessionFixture(t, async () => {mutations++; throw Error('WORKFORCE_GATEWAY_TIMEOUT_UNCERTAIN');});
  await f.session.act('screenshot');
  await assert.rejects(f.session.act('type', {text:'authorized task text'}), /TIMEOUT_UNCERTAIN/);
  assert.equal(f.session.frame, null);
  await assert.rejects(f.session.act('type', {text:'authorized task text'}), /FRESH_SCREEN_REQUIRED/);
  assert.equal(mutations, 1);
  f.journal.checkpoint('run', 'c'.repeat(64));
  f.journal.finish('run', 'interrupted');
  assert.throws(() => f.journal.resume('run', 'a'.repeat(64), 'b'.repeat(64), 'agent', 2), /UNRECONCILED_INPUT/);
  assert.equal(f.journal.row('run').actions, 2);
});

test('provider restart and out-of-frame coordinates fail before any desktop input', async t => {
  let mutations = 0;
  const f = sessionFixture(t, async () => {mutations++; return {ok:true};});
  await f.session.act('screenshot');
  await assert.rejects(f.session.act('left_click', {x:100,y:10}), /COORDINATES/);
  f.restart();
  await assert.rejects(f.session.act('type', {text:'blocked'}), /PROVIDER_RESTARTED/);
  assert.equal(mutations, 0);
});

test('private delivery and checkpoint encryption bind recipient, job, purpose and expiry', () => {
  const recipient = crypto.generateKeyPairSync('x25519');
  const stranger = crypto.generateKeyPairSync('x25519');
  const privateBytes = Buffer.from('confidential-demo-only-never-a-public-result');
  for (const purpose of ['delivery','checkpoint']) {
    const context = {specSha256:'a'.repeat(64), purpose, expiresAt:now+60};
    const envelope = seal(privateBytes, [recipient.publicKey], context);
    assert(!JSON.stringify(envelope).includes(privateBytes.toString()));
    assert.deepEqual(open(envelope, recipient.privateKey, context, {now}), privateBytes);
    assert.throws(() => open(envelope, stranger.privateKey, context, {now}), /RECIPIENT_NOT_AUTHORIZED/);
    assert.throws(() => open(envelope, recipient.privateKey, {...context, specSha256:'b'.repeat(64)}, {now}), /ENVELOPE_CONTEXT/);
    assert.throws(() => open(envelope, recipient.privateKey, {...context, purpose:'job'}, {now}), /ENVELOPE_CONTEXT/);
    assert.throws(() => open(envelope, recipient.privateKey, context, {now:now+60}), /ENVELOPE_CONTEXT/);
    const changed = structuredClone(envelope);
    const bytes = Buffer.from(changed.data.ciphertext, 'base64'); bytes[0] ^= 1;
    changed.data.ciphertext = bytes.toString('base64');
    assert.throws(() => open(changed, recipient.privateKey, context, {now}));
  }
});

test('public commitment contains only digests and excludes incidental confidential fields', () => {
  const scope = Object.fromEntries(['specSha256','runtimeSha256','encryptedSha256','receiptSha256','recipientPolicySha256'].map((name, i) => [name,String(i+1).repeat(64)]));
  const commitment = specCore.privateCommitment({...scope, content:'must never escape'});
  assert.deepEqual(commitment, {schema:'agi-private-commitment/v1', ...scope, disclosure:'commitments-only'});
  assert(!JSON.stringify(commitment).includes('must never escape'));
  assert.throws(() => specCore.privateCommitment({...scope, specSha256:'private task text'}), /COMMITMENT/);
});

test('default Linux execution refuses an unsuitable desktop before contacting any provider', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-linux-real-gate-'));
  const f = fixture(dir), prior = process.env.XDG_SESSION_TYPE;
  t.after(() => {if(prior === undefined)delete process.env.XDG_SESSION_TYPE;else process.env.XDG_SESSION_TYPE=prior;fs.rmSync(dir,{recursive:true,force:true});});
  process.env.XDG_SESSION_TYPE = '';
  await assert.rejects(runNative(f.c, f.packet, {
    gatewayFactory:() => assert.fail('An unsuitable desktop must not contact a provider'),
  }), /DEDICATED_NONROOT_ACCOUNT_REQUIRED|UNPRIVILEGED_ACCOUNT_REQUIRED|X11_SESSION_REQUIRED/);
});

test('synthetic platform option cannot promote a signed production grant without qualification', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-linux-production-gate-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const f = fixture(dir);
  f.packet.grant = signGrant(grantBody(f.c, f.spec, {mode:'production'}), f.operator.privateKey);
  await assert.rejects(runNative(f.c, f.packet, {
    allowTestPlatform:true,
    gatewayFactory:() => assert.fail('Production cannot bypass qualification through test options'),
  }), /QUALIFICATION_REQUIRED|LINUX_PRODUCTION_QUALIFICATION_UNAVAILABLE/);
});
