import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeSource, normalizeTree} from '../scripts/normalize-js-literals.mjs';

const marker = '#' + '!';

if (!process.execArgv.includes('--expose-internals')) {
  test('release literal AST regressions run with the Node 24 bundled parser', () => {
    const result = spawnSync(process.execPath, ['--expose-internals', '--test', fileURLToPath(import.meta.url)], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
} else {

test('string literal normalization preserves decoded binary-like data and shell scripts', () => {
  for (const value of [marker + '/bin/sh\nexit 0\n', 'e7693&)U*o&)Ry^)*)W))))#X^))))@@)#Wf)m%)' + marker + '))AG)&IIAQIIIBIIHJNAgBIILIDJGo)))HIQIIIIA(IGgJHH(BIIxX#)Ou', 'é' + marker + '\\raw\u0000']) {
    const source = '(' + JSON.stringify(value) + ')';
    const result = normalizeSource(source);
    assert.equal(result.source.indexOf(marker), -1);
    assert.equal(vm.runInNewContext(result.source), value);
    assert.equal(result.edits[0].kind, 'string');
    assert.ok(result.semanticAstSHA256);
  }
});

test('untagged templates preserve cooked bytes and interpolations', () => {
  const source = '`' + marker + '/bin/sh\n${1 + 2}\n`';
  const result = normalizeSource(source);
  assert.equal(vm.runInNewContext(result.source), vm.runInNewContext(source));
  assert.equal(result.edits[0].kind, 'untagged-template');
});

test('direct regex test escape has equivalent matching and keeps flags', () => {
  const source = '/^' + marker + '[^\\n]*\\bnode(?:\\s|$)/i.test(header)';
  const result = normalizeSource(source);
  for (const header of [marker + '/usr/bin/env node', marker + '/usr/bin/NODE\n', marker + '/bin/sh', 'prefix ' + marker + ' node', '\n' + marker + ' node', marker + ' nodejs', marker + ' node x'])
    assert.equal(vm.runInNewContext(result.source, {header}), vm.runInNewContext(source, {header}));
  assert.equal(result.edits[0].kind, 'regex-direct-test');
});

test('tagged templates, comments, observable regex objects and escaped hashes fail closed', () => {
  for (const source of ['String.raw`' + marker + '`', '//' + marker, '/^' + marker + '/.source', 'const r = /^' + marker + '/;', '"\\' + marker + '"'])
    assert.throws(() => normalizeSource(source), /unsupported|explicit source repair/);
});

test('misplaced actual hashbang remains a syntax failure, never a blind repair', () => {
  assert.throws(() => normalizeSource('import fs from "node:fs";\n' + marker + '/usr/bin/env node\n'), /Unexpected/);
});

test('leading hashbang retained at byte zero and normalization is idempotent', () => {
  const source = marker + '/usr/bin/env node\nconst shell = "' + marker + '/bin/sh";\n';
  const result = normalizeSource(source);
  assert.ok(result.source.startsWith(marker));
  assert.equal(result.source.indexOf(marker, 1), -1);
  assert.equal(normalizeSource(result.source).source, result.source);
  assert.deepEqual(normalizeSource(result.source).edits, []);
});

test('tree dry-run, atomic preflight, write and subsequent check', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-literals-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const first = path.join(root, 'first.mjs'), invalid = path.join(root, 'invalid.mjs');
  const source = 'const shell = "' + marker + '/bin/sh";\n';
  fs.writeFileSync(first, source);
  assert.equal(normalizeTree(root, {check: true}).status, 'FAIL');
  assert.equal(normalizeTree(root).filesChanged, 0);
  assert.equal(fs.readFileSync(first, 'utf8'), source);
  fs.writeFileSync(invalid, '//' + marker);
  assert.throws(() => normalizeTree(root, {write: true}), /unsupported/);
  assert.equal(fs.readFileSync(first, 'utf8'), source);
  fs.unlinkSync(invalid);
  assert.equal(normalizeTree(root, {write: true}).filesChanged, 1);
  assert.equal(normalizeTree(root, {check: true}).status, 'PASS');
});
}
