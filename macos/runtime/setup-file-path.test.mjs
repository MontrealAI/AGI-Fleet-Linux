import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setupFilePath} from './setup-file-path.mjs';

test('Finder drop decoding preserves spaces, accents and escaped punctuation without a shell', () => {
  const expected = "/Users/élève/Mon dossier/Vincent's #1 (final) & $setup`!.json";
  const dropped = expected.replace(/[\\ '"#()&$`!]/g, c => '\\' + c);
  assert.equal(setupFilePath(dropped, {exists: () => false}), expected);
  assert.equal(setupFilePath("'/Users/a/Vincent'\\''s setup.json'"), "/Users/a/Vincent's setup.json");
  assert.equal(setupFilePath('"/Users/a/a\\$b\\`c\\"d.json"'), '/Users/a/a$b`c"d.json');
  assert.equal(setupFilePath('"/Users/a/a\\qb.json"'), '/Users/a/a\\qb.json');
});

test('existing literal paths and argv keep their exact filename bytes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-setup-path-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  for (const name of ["Vincent's setup.json", 'literal\\(1).json', '"quoted".json', 'a $b; c.json']) {
    const file = path.join(directory, name);
    fs.writeFileSync(file, '{}');
    assert.equal(setupFilePath(file), file);
    assert.equal(setupFilePath(file, {argument: true}), file);
  }
  assert.equal(setupFilePath(' /literal\\ name.json ', {argument: true}), ' /literal\\ name.json ');
});

test('malformed or multiple drops fail without echoing input or executing substitutions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-no-eval-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const marker = path.join(directory, 'executed');
  for (const text of ['', ' ', 'a\0b', 'a\nb', 'a\rb', "'unfinished", '"unfinished', 'unfinished\\', 'one.json two.json', 'a;touch b', 'a|cat', '$(touch ' + marker + ')', 'a'.repeat(32769)]) {
    assert.throws(() => setupFilePath(text), {message: 'OPENCLAW_SETUP_FILE'});
  }
  assert.equal(setupFilePath('"$(touch ' + marker + ')"'), '$(touch ' + marker + ')');
  assert.equal(fs.existsSync(marker), false);
});
