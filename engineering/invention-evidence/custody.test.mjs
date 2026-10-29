// SPDX-License-Identifier: MIT
// Uses the unchanged actual worker; requires existing locked Fleet dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectEvidence} from './inspect.mjs';
import {perform, validateTaskInput} from '../../local-runtime/worker.mjs';

test('actual unchanged evidence-inspect worker accepts the emitted custody task', async () => {
  const raw = fs.readFileSync(new URL('./fixtures/ca626861.json', import.meta.url), 'utf8');
  const {custodyTask} = inspectEvidence(raw);
  validateTaskInput('evidence', custodyTask);
  const result = await perform('evidence', custodyTask);
  assert.equal(result.authority, 'none');
  assert.equal(result.independentReview, false);
  const report = JSON.parse(result.files[0].content);
  assert.equal(report.inventory.length, 5);
  assert.ok(report.inventory.every(file => file.matches));
  assert.match(report.meaning, /Byte integrity only/);
});
