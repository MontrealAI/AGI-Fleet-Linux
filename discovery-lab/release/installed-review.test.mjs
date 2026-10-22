// SPDX-License-Identifier: Apache-2.0
// Saved-byte/capture tests use explicitly inert modules, never native acceptance claims.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as nodeModule from 'node:module';
import {captureInstalled, outputDestination, reviewInstalled} from './installed-review.mjs';
import {parseModuleSources, checkDependencyRecords, ownedTarget, createModuleBoundary} from './module-closure.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-installed-fixture-'));
    const entries = new Map();
    const add = (name, source) => { const data = Buffer.from(source); entries.set(name, data);
        const target = path.join(root, name); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, data, {mode: 0o644}); };
    const sourceNames = ['workspace.mjs', 'discovery-lab-history.mjs', 'discovery-lab-inspector.mjs'];
    for (const name of sourceNames) add('alpha/examples/successor-capability/' + name, '// Inert capture fixture.\n');
    add('discovery-lab/contract.mjs', '// Inert transport fixture.\n');
    add('discovery-lab/receiver.mjs', "import * as contract from './contract.mjs';\n");
    add('discovery-lab/release/module-closure.mjs', fs.readFileSync(new URL('./module-closure.mjs', import.meta.url)));
    const sources = Object.fromEntries(sourceNames.map(name => ['examples/successor-capability/' + name,
        sha(entries.get('alpha/examples/successor-capability/' + name))]));
    const sourceHash = sha(JSON.stringify(Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
    add('alpha/docs/successor/capabilities/sources.json', JSON.stringify({sourceHash, sources}));
    const alphaFiles = Object.fromEntries([...entries].filter(([name]) => name.startsWith('alpha/'))
        .map(([name, bytes]) => [name.slice(6), {sha256: sha(bytes), gitBlob: '1'.repeat(40), mode: '100644'}]));
    const profile = {schema: 'agi-fleet/discovery-installed-profile/v1', version: '0.1.0-discovery-preview.1',
        qualification: 'FROZEN_SOURCE_PROFILE', authority: 'none', productionQualified: false,
        alpha: {commit: '1'.repeat(40), tree: '2'.repeat(40), sourceHash, files: alphaFiles,
            sharedContractSha256: sha(entries.get('discovery-lab/contract.mjs'))}, runtimeProfiles: {}};
    add('discovery-lab/release/profile.json', JSON.stringify(profile));
    const manifest = {schema: 'agi-fleet/discovery-installed-package/v1', version: profile.version,
        source: {repository: 'MontrealAI/AGI-Fleet-Linux', commit: '3'.repeat(40), tree: '4'.repeat(40)},
        profileSha256: sha(entries.get('discovery-lab/release/profile.json')),
        authority: 'none', remoteExecution: 'unprovisioned', productionQualified: false,
        files: [...entries].map(([name, bytes]) => ({path: name, bytes: bytes.length, sha256: sha(bytes), mode: 0o644}))};
    const writeManifest = () => fs.writeFileSync(path.join(root, 'discovery-installed-manifest.json'), JSON.stringify(manifest));
    writeManifest();
    return {root, manifest, writeManifest, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
};

test('fixed import capture includes actual declared bytes and no undeclared module', t => {
    const f = fixture(); t.after(f.cleanup);
    const result = captureInstalled(f.root);
    assert.equal(result.importClosure.length, 5);
    assert.equal(result.files.size, f.manifest.files.length);
});

test('tampered application refuses before any module can execute', async t => {
    const f = fixture(); t.after(f.cleanup);
    fs.appendFileSync(path.join(f.root, 'discovery-lab/receiver.mjs'), '// Inert changed source bytes.\n');
    await assert.rejects(reviewInstalled({workspaceRaw: '{}', requestRaw: '{}', attempt: 'selected', route: 'manager-usdc'}, f.root));
});

test('symlinked captured source and duplicate member maps refuse', t => {
    const f = fixture(); t.after(f.cleanup);
    const filename = path.join(f.root, 'discovery-lab/contract.mjs'); fs.unlinkSync(filename);
    fs.symlinkSync(path.join(f.root, 'discovery-lab/receiver.mjs'), filename);
    assert.throws(() => captureInstalled(f.root), /regular|ELOOP/);
    fs.unlinkSync(filename); fs.writeFileSync(filename, '// Inert transport fixture.\n');
    f.manifest.files.push(f.manifest.files[0]); f.writeManifest();
    assert.throws(() => captureInstalled(f.root), /Duplicate/);
});

test('unsafe member traversal and changed declared modes refuse', t => {
    const f = fixture(); t.after(f.cleanup);
    f.manifest.files[0].path = '../outside'; f.writeManifest();
    assert.throws(() => captureInstalled(f.root), /unsafe/);
    f.manifest.files[0].path = 'alpha/examples/successor-capability/workspace.mjs';
    f.manifest.files[0].mode = 0o777; f.writeManifest();
    assert.throws(() => captureInstalled(f.root));
});

test('inert captured source cannot claim operational or spending authority', t => {
    const f = fixture(); t.after(f.cleanup);
    f.manifest.authority = 'execute-and-pay'; f.writeManifest();
    assert.throws(() => captureInstalled(f.root));
});

test('output refuses existing data and a parent symlink into the installation', t => {
    const f = fixture(); t.after(f.cleanup);
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-output-fixture-'));
    t.after(() => fs.rmSync(sibling, {recursive: true, force: true}));
    const link = path.join(sibling, 'installed-link'); fs.symlinkSync(f.root, link);
    assert.throws(() => outputDestination(path.join(link, 'new-evidence'), f.root), /outside/);
    assert.throws(() => outputDestination(f.root, f.root), /absent/);
    assert.equal(outputDestination(path.join(sibling, 'new-evidence'), f.root), path.join(sibling, 'new-evidence'));
});

test('direct options reject accessors, inherited fields and unknown fields without reading getters', async t => {
    const f = fixture(); t.after(f.cleanup); let reads = 0;
    const input = {requestRaw: '{}', attempt: 'selected', route: 'manager-usdc'};
    Object.defineProperty(input, 'workspaceRaw', {enumerable: true, get() { reads++; return '{}'; }});
    await assert.rejects(reviewInstalled(input, f.root), /own data/); assert.equal(reads, 0);
    await assert.rejects(reviewInstalled(Object.create({workspaceRaw: '{}'}), f.root), /inert/);
    await assert.rejects(reviewInstalled({workspaceRaw: '{}', requestRaw: '{}', attempt: 'selected', route: 'manager-usdc',
        importedModule: 'untrusted.mjs'}, f.root), /Unsupported/);
});

test('installed root requires an explicit absolute string', () => {
    assert.throws(() => captureInstalled('.'), /absolute/);
    assert.throws(() => captureInstalled({toString() { throw Error('must not coerce'); }}), /absolute/);
});

test('oversized direct text refuses before UTF-8 scanning or installed source access', async () => {
    const byteLength = Buffer.byteLength; let oversizedScans = 0, boundedScans = 0;
    Buffer.byteLength = value => {
        if (value.length > 2_000_000) { oversizedScans++; throw Error('must not scan an already oversized string'); }
        boundedScans++; return byteLength(value);
    };
    try {
        await assert.rejects(reviewInstalled({workspaceRaw: 'x'.repeat(2_000_001), requestRaw: '{}',
            attempt: 'selected', route: 'manager-usdc'}, '/absent-installed-fixture'));
        await assert.rejects(reviewInstalled({workspaceRaw: '{}', requestRaw: 'x'.repeat(2_000_001),
            attempt: 'selected', route: 'manager-usdc'}, '/absent-installed-fixture'));
        assert.equal(oversizedScans, 0); assert.equal(boundedScans, 1);
    } finally { Buffer.byteLength = byteLength; }
});

test('parse-only records cover side-effect, compact imports and reexports', () => {
    const records = parseModuleSources([{name: 'a.mjs', source: "import './b.mjs';export*from './c.mjs';import{x}from './d.mjs';"},
        {name: 'b.mjs', source: 'export const b=1;'}, {name: 'c.mjs', source: 'export const c=1;'},
        {name: 'd.mjs', source: 'export const x=1;'}]);
    assert.deepEqual(records[0].requests, ['./b.mjs', './c.mjs', './d.mjs']);
    checkDependencyRecords(records, new Set(records.map(item => item.name)));
});

test('inert dependency records refuse absolute, package, data and unapproved builtin targets', () => {
    // These are parser inputs only. No test links, evaluates or imports any rejected target.
    const names = new Set(['a.mjs']);
    for (const specifier of ['file:///outside-not-loaded.mjs', '/outside-not-loaded.mjs', 'unavailable-package',
        'data:text/javascript,export default 1', 'node:fs']) {
        const records = parseModuleSources([{name: 'a.mjs', source: 'import ' + JSON.stringify(specifier) + ';'}]);
        assert.deepEqual(records[0].requests, [specifier]);
        assert.throws(() => checkDependencyRecords(records, names), /owned relative|URL alias/);
    }
    const approved = parseModuleSources([{name: 'receiver.mjs', source: "import{createHash}from'node:crypto';"}]);
    checkDependencyRecords(approved, new Set(['receiver.mjs']), {'receiver.mjs': ['node:crypto']});
});

test('literal and computed dynamic targets use the same owned resolver decisions', () => {
    const parsed = parseModuleSources([{name: 'a.mjs', source: "export const later=()=>import('./b.mjs');"}]);
    assert.deepEqual(parsed[0].requests, []); // Static records do not claim to cover dynamic import().
    const names = new Set(['a.mjs', 'b.mjs']);
    assert.equal(ownedTarget('./b.mjs', 'a.mjs', names), 'b.mjs');
    for (const target of ['file:///outside-not-loaded.mjs', 'node:fs', './missing.mjs', '../outside.mjs'])
        assert.throws(() => ownedTarget(target, 'a.mjs', names));
});

test('ordinary owned constant module loads captured bytes; closed entry remains denied', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-owned-positive-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const bytes = Buffer.from('export const value=7;');
    const files = new Map([['constant.mjs', bytes]]);
    if (typeof nodeModule.registerHooks !== 'function') {
        assert.throws(() => createModuleBoundary(directory, files, ['constant.mjs']), /does not support/);
        return;
    }
    const boundary = createModuleBoundary(directory, files, ['constant.mjs']);
    bytes.fill(32); files.clear(); // The boundary owns its byte snapshot.
    try { assert.equal((await boundary.importModule('constant.mjs')).value, 7); }
    finally { boundary.close(); }
    await assert.rejects(boundary.importModule('constant.mjs'), /closed/);
    assert.throws(() => createModuleBoundary(directory + '-unsafe', new Map([['../outside.mjs', Buffer.from('')]]), ['../outside.mjs']));
});

test('inert names refuse URL aliases and policy accessors without reading them', () => {
    const names = new Set(['a.mjs', 'b.mjs']);
    for (const target of ['./b.mjs?query', './b.mjs#fragment', './b%2emjs', './b\tmjs'])
        assert.throws(() => ownedTarget(target, 'a.mjs', names), /URL alias/);
    if (typeof nodeModule.registerHooks !== 'function') return;
    for (const name of ['a.mjs?query', 'a.mjs#fragment', 'a%2emjs', 'a\tmjs'])
        assert.throws(() => createModuleBoundary('/inert-not-created-' + names.size,
            new Map([[name, Buffer.from('// Inert source.\n')]]), [name]));
    let reads = 0;
    const policy = {};
    Object.defineProperty(policy, 'a.mjs', {get() { reads++; return ['node:crypto']; }});
    assert.throws(() => createModuleBoundary('/inert-policy-not-created',
        new Map([['a.mjs', Buffer.from('// Inert source.\n')]]), ['a.mjs'], policy));
    assert.equal(reads, 0);
});

test('oversized inert manifest refuses before any descriptor read', t => {
    const f = fixture(); t.after(f.cleanup);
    fs.writeFileSync(path.join(f.root, 'discovery-installed-manifest.json'), Buffer.alloc(2_000_001, 32));
    const original = fs.readSync; let reads = 0;
    fs.readSync = (...args) => { reads++; return original(...args); };
    try { assert.throws(() => captureInstalled(f.root), /bounded regular/); assert.equal(reads, 0); }
    finally { fs.readSync = original; }
});

test('changed inert file metadata refuses the owned descriptor capture', t => {
    const f = fixture(); t.after(f.cleanup);
    const original = fs.fstatSync; let observations = 0;
    fs.fstatSync = (...args) => {
        const value = original(...args); observations++;
        return observations === 2 ? {...value, ctimeNs: value.ctimeNs + 1n} : value;
    };
    try { assert.throws(() => captureInstalled(f.root), /changed during/); }
    finally { fs.fstatSync = original; }
});
