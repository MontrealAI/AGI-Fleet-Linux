import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';

test('support report contains aggregate observations without private state or backend text', async () => {
  const marker = 'PRIVATE_SUPPORT_TEST_MARKER';
  const f = fixture();
  try {
    const actor = f.runtime.addActor({role: 'agent', name: marker}, f.operator);
    const scoped = f.runtime.issueClient(actor.id);
    f.runtime.store.event('private-event', {task: marker, token: scoped.token});
    f.backend.inspect = () => ({supported: false, code: marker, help: marker,
      identity: marker, bootId: marker, sourceSha256: marker, productionQualified: true});
    const report = await f.runtime.dispatch('diagnostics', {}, f.operator);
    assert.equal(report.schema, 'agi-fleet/local-diagnostics/v1');
    assert.equal(report.actorsByRole.agent, 1);
    assert.equal(report.readiness.code, 'HOST_CHECK_BLOCKED');
    assert.equal(report.readiness.operationalProbe, 'BLOCKED');
    assert.equal(report.productionQualified, false);
    assert.equal(report.economicAuthority, false);
    const encoded = JSON.stringify(report);
    for (const privateValue of [marker, scoped.token, scoped.principal.hash,
      actor.id, actor.controller, f.directory, f.runtime.store.meta('host')]) {
      assert.equal(encoded.includes(privateValue), false, 'private value leaked');
    }
    await assert.rejects(f.runtime.dispatch('diagnostics', {}, scoped.principal), /CLIENT_SCOPE_DENIED/);
    await assert.rejects(f.runtime.dispatch('diagnostics', {includeSecrets: true}, f.operator), /FIELDS_INVALID/);
  } finally { f.close(); }
});

test('support report retains STOP and pending obligations without treating a probe as qualification', async () => {
  const f = fixture();
  try {
    const actor = f.create(), grant = f.prepare(actor);
    f.authorize(grant);
    f.runtime.pause({paused: true}, f.operator);
    let report = await f.runtime.dispatch('diagnostics', {}, f.operator);
    assert.equal(report.grants.authorized, 1);
    assert.equal(report.controls.paused, true);
    assert.equal(report.readiness.operationalProbe, 'PASS');
    assert.equal(report.readiness.physicalQualification, 'NOT_RUN');
    f.runtime.stop({actor: null}, f.operator);
    report = await f.runtime.dispatch('diagnostics', {}, f.operator);
    assert.equal(report.controls.stopped, true);
    assert.equal(report.grants.revoked, 1);
    assert.equal(report.grants.authorized, 0);
    assert.equal(report.runs.complete, 0);
    assert.equal(f.runtime.store.meta('stopped'), true);
  } finally { f.close(); }
});
