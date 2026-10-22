// SPDX-License-Identifier: Apache-2.0
// Installed local finite reviewer. Requests never select executable paths or code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseModuleSources, ownedTarget, createModuleBoundary} from './module-closure.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VERSION = '0.1.0-discovery-preview.1';
const sha = value => createHash('sha256').update(value).digest('hex');
const plainPath = value => typeof value === 'string' && value.length > 0 && !value.includes('\\')
    && !path.posix.isAbsolute(value) && path.posix.normalize(value) === value
    && !value.split('/').some(item => item === '..' || item === '.' || item === '');
const bounded = filename => {
    assert.ok(Number.isInteger(fs.constants.O_NOFOLLOW) && Number.isInteger(fs.constants.O_NONBLOCK));
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const before = fs.fstatSync(descriptor, {bigint: true});
        assert.ok(before.isFile() && before.size <= 2_000_000n, 'Contained bounded regular bytes required');
        const buffer = Buffer.alloc(2_000_001); let count = 0;
        while (count < buffer.length) {
            const read = fs.readSync(descriptor, buffer, count, buffer.length - count, count);
            if (!read) break; count += read;
        }
        assert.ok(count <= 2_000_000 && BigInt(count) === before.size, 'Source changed beyond its captured size or input bound');
        const after = fs.fstatSync(descriptor, {bigint: true});
        assert.ok(['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]),
            'Source changed during its owned capture');
        return Buffer.from(buffer.subarray(0, count));
    } finally { fs.closeSync(descriptor); }
};

export function outputDestination(output, root = ROOT) {
    assert.ok(typeof output === 'string' && path.isAbsolute(output), 'Use an explicit absolute output');
    assert.ok(typeof root === 'string' && path.isAbsolute(root), 'Use an absolute installed root');
    output = path.resolve(output);
    output = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
    root = fs.realpathSync(root);
    assert.ok(!fs.existsSync(output) && output !== root && !output.startsWith(root + path.sep),
        'Use absent output outside installed source');
    return output;
}

/** Capture all declared bytes before importing any application code. */
export function captureInstalled(root = ROOT) {
    assert.ok(typeof root === 'string' && path.isAbsolute(root), 'Use an absolute installed root');
    root = fs.realpathSync(root);
    const manifestBytes = bounded(path.join(root, 'discovery-installed-manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.schema, 'agi-fleet/discovery-installed-package/v1');
    assert.equal(manifest.version, VERSION);
    assert.equal(manifest.authority, 'none');
    assert.equal(manifest.remoteExecution, 'unprovisioned');
    assert.equal(manifest.productionQualified, false);
    assert.equal(manifest.source.repository, 'MontrealAI/AGI-Fleet-Linux');
    assert.ok(/^[a-f0-9]{40}$/.test(manifest.source.commit) && /^[a-f0-9]{40}$/.test(manifest.source.tree));
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 256);
    const files = new Map(); let total = 0;
    for (const item of manifest.files) {
        assert.ok(plainPath(item.path) && !files.has(item.path), 'Duplicate or unsafe installed member');
        assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0 && [0o644, 0o755].includes(item.mode));
        const filename = path.join(root, item.path);
        assert.ok(fs.realpathSync(filename).startsWith(root + path.sep), 'Installed path escapes root');
        const data = bounded(filename); total += data.length;
        assert.ok(total <= 16_000_000, 'Installed source exceeds total bound');
        assert.equal(data.length, item.bytes); assert.equal(sha(data), item.sha256);
        assert.equal(fs.lstatSync(filename).mode & 0o777, item.mode);
        files.set(item.path, data);
    }
    const profileBytes = files.get('discovery-lab/release/profile.json');
    assert.ok(profileBytes); assert.equal(sha(profileBytes), manifest.profileSha256);
    const profile = JSON.parse(profileBytes);
    assert.equal(profile.schema, 'agi-fleet/discovery-installed-profile/v1');
    assert.equal(profile.version, VERSION); assert.equal(profile.qualification, 'FROZEN_SOURCE_PROFILE');
    assert.equal(profile.authority, 'none'); assert.equal(profile.productionQualified, false);
    assert.ok(profile.alpha && /^[a-f0-9]{40}$/.test(profile.alpha.commit) && /^[a-f0-9]{40}$/.test(profile.alpha.tree));
    for (const [name, binding] of Object.entries(profile.alpha.files)) {
        assert.ok(plainPath(name)); assert.equal(sha(files.get('alpha/' + name)), binding.sha256);
        assert.ok(['100644', '100755'].includes(binding.mode));
        assert.equal(manifest.files.find(item => item.path === 'alpha/' + name)?.mode,
            binding.mode === '100755' ? 0o755 : 0o644);
    }
    const catalog = JSON.parse(files.get('alpha/docs/successor/capabilities/sources.json'));
    const encodedSources = JSON.stringify(Object.fromEntries(Object.entries(catalog.sources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
    assert.equal(sha(encodedSources), profile.alpha.sourceHash); assert.equal(catalog.sourceHash, profile.alpha.sourceHash);
    for (const [name, digest] of Object.entries(catalog.sources)) assert.equal(sha(files.get('alpha/' + name)), digest);
    assert.equal(sha(files.get('discovery-lab/contract.mjs')), profile.alpha.sharedContractSha256);
    // Node parses every static form. The runtime hook separately bounds all dynamic requests.
    const parsed = parseModuleSources([...files].filter(([name]) => name.startsWith('alpha/') && name.endsWith('.mjs')
        || ['discovery-lab/receiver.mjs', 'discovery-lab/contract.mjs'].includes(name))
        .map(([name, bytes]) => ({name, source: bytes.toString()})), files.get('discovery-lab/release/module-closure.mjs').toString());
    const imports = new Map(parsed.map(item => [item.name, item.requests]));
    const builtins = {'discovery-lab/receiver.mjs': ['node:crypto', 'node:perf_hooks']};
    const seen = new Set(), names = new Set(files.keys());
    const visit = relative => {
        if (seen.has(relative)) return; seen.add(relative);
        assert.ok(imports.has(relative), 'Missing installed parsed module: ' + relative);
        for (const specifier of imports.get(relative)) {
            const next = ownedTarget(specifier, relative, names, builtins);
            if (next.startsWith('node:')) continue;
            assert.ok(!relative.startsWith('alpha/') || next.startsWith('alpha/'), 'Alpha import escapes its source root');
            visit(next);
        }
    };
    visit('discovery-lab/receiver.mjs');
    visit('alpha/examples/successor-capability/workspace.mjs');
    visit('alpha/examples/successor-capability/discovery-lab-history.mjs');
    visit('alpha/examples/successor-capability/discovery-lab-inspector.mjs');
    return {manifest, profile, files, manifestSha256: sha(manifestBytes), importClosure: [...seen].sort(), builtins};
}

function inputFrame(input) {
    assert.ok(input && typeof input === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(input)),
        'Installed review requires an inert options object');
    const keys = Reflect.ownKeys(input), required = ['workspaceRaw', 'requestRaw', 'attempt', 'route'];
    assert.ok(keys.length >= 4 && keys.length <= 5 && required.every(key => keys.includes(key))
        && keys.every(key => required.includes(key) || key === 'runtimeProfile'), 'Unsupported installed review fields');
    const frame = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        assert.ok(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'Inert own data fields required');
        frame[key] = descriptor.value;
    }
    return frame;
}

/** The operator separately selects a saved mission, accepted attempt and route. */
export async function reviewInstalled(input, root = ROOT) {
    const {workspaceRaw, requestRaw, attempt, route, runtimeProfile = 'fleet-linux-x64'} = inputFrame(input);
    assert.ok(typeof workspaceRaw === 'string' && workspaceRaw.length <= 2_000_000 && Buffer.byteLength(workspaceRaw) <= 2_000_000);
    assert.ok(typeof requestRaw === 'string' && requestRaw.length <= 2_000_000 && Buffer.byteLength(requestRaw) <= 2_000_000);
    assert.ok(typeof attempt === 'string' && attempt.length > 0 && attempt.length <= 128);
    assert.ok(typeof runtimeProfile === 'string' && runtimeProfile.length > 0 && runtimeProfile.length <= 128);
    assert.ok(['manager-usdc', 'jobs-agialpha'].includes(route));
    const captured = captureInstalled(root), {manifest, profile, files} = captured;
    const runtime = profile.runtimeProfiles[runtimeProfile]; assert.ok(runtime);
    assert.equal(process.version, runtime.version); assert.equal(process.platform, runtime.platform); assert.equal(process.arch, runtime.arch);
    assert.equal(sha(fs.readFileSync(process.execPath)), runtime.binarySha256, 'Pinned runtime executable required');
    // Load the fixed modules from one private capture, rather than reread mutable source paths.
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-discovery-review-'));
    fs.chmodSync(temporary, 0o700);
    const entries = ['alpha/examples/successor-capability/workspace.mjs',
        'alpha/examples/successor-capability/discovery-lab-history.mjs',
        'alpha/examples/successor-capability/discovery-lab-inspector.mjs',
        'discovery-lab/receiver.mjs', 'discovery-lab/contract.mjs'];
    let boundary;
    try {
        boundary = createModuleBoundary(temporary,
            new Map(captured.importClosure.map(name => [name, files.get(name)])), entries, captured.builtins);
        const load = relative => boundary.importModule(relative);
        const workspaceModule = await load('alpha/examples/successor-capability/workspace.mjs');
        const history = await load('alpha/examples/successor-capability/discovery-lab-history.mjs');
        const {createInspector} = await load('alpha/examples/successor-capability/discovery-lab-inspector.mjs');
        const {reviewDiscoveryRequest} = await load('discovery-lab/receiver.mjs');
        const contract = await load('discovery-lab/contract.mjs');
        const workspace = await workspaceModule.parseWorkspace(workspaceRaw);
        const inspection = await workspaceModule.inspectWorkspace(workspace);
        const candidates = inspection.discovery.campaigns.filter(item => item.attempt === attempt && item.state === 'accepted' && item.lineageQualified !== false);
        assert.equal(candidates.length, 1, 'Operator selection needs one freshly replayed accepted campaign');
        const selected = candidates[0], alpha = profile.alpha;
        const sources = {modelDigest: alpha.files['examples/successor-capability/discovery-lab.mjs'].sha256,
            evaluatorDigest: alpha.files['examples/successor-capability/discovery-lab-checker.mjs'].sha256, sourceDigest: alpha.sourceHash};
        for (const [key, value] of Object.entries(sources)) assert.equal(selected.bindings[key], value, 'Saved mission belongs to another source');
        const chain = []; for (let item = selected; item; item = item.parent) { assert.ok(chain.length < 9); chain.push(item.charter); }
        const capacity = {acquisitions: 0, checking: 20_000, elapsedMs: 120_000, installations: 0,
            memoryBytes: 10_000_000, search: 0, storageBytes: 4_000_000, workerCapacity: 4};
        for (const charter of chain) for (const key of ['acquisitions', 'search', 'checking', 'installations']) capacity[key] += charter.budget[key];
        contract.validateResources(capacity);
        const currency = route === 'manager-usdc' ? 'USDC' : 'AGIALPHA';
        const expectedRequest = await history.workRequest(selected, currency, capacity);
        assert.equal(contract.canonical(await contract.parseWorkRequest(requestRaw)), contract.canonical(expectedRequest),
            'Raw request differs from the independently reconstructed operator-selected mission');
        const runtimeDigest = await contract.payloadDigest({profile: runtimeProfile, runtime, manifestSha256: captured.manifestSha256,
            alphaCommit: alpha.commit, alphaTree: alpha.tree, alphaSourceHash: alpha.sourceHash});
        const installed = {executorId: 'installed-discovery-local-review-v1', runtimeDigest, currentRuntimeDigest: runtimeDigest,
            expected: Object.fromEntries(contract.BINDING_KEYS.map(key => [key, selected.bindings[key]])),
            expectedCommission: {id: selected.attempt, branch: selected.attempt + '-' + currency.toLowerCase(), route},
            stages: contract.STAGES, resourceCapacity: capacity, inspectCampaign: createInspector(sources)};
        const receipt = await reviewDiscoveryRequest(requestRaw, installed), receiptRaw = JSON.stringify(receipt);
        assert.equal(receipt.authority, 'none'); assert.equal(receipt.remoteExecution, 'unprovisioned');
        const result = {raw: JSON.stringify({schema: 'agi-fleet/discovery-review-return/v1', original: requestRaw, receiptRaw}),
            source: {...manifest.source, adapterSha256: sha(files.get('discovery-lab/receiver.mjs')),
                contractSha256: sha(files.get('discovery-lab/contract.mjs'))}};
        const observation = {schema: 'agi-fleet/discovery-installed-observation/v1', packageVersion: VERSION,
            manifestSha256: captured.manifestSha256, alpha: {commit: alpha.commit, tree: alpha.tree, sourceHash: alpha.sourceHash},
            runtimeProfile, runtime, runtimeDigest, workspaceSha256: sha(workspaceRaw), requestSha256: sha(requestRaw),
            receiptSha256: sha(receiptRaw), selectedAttempt: attempt, route, importClosure: captured.importClosure,
            state: receipt.state, resourceUsed: receipt.resourceUsed, resourceAccounting: receipt.resourceAccounting,
            totalComplete: false, resourceScope: 'receiver-and-inspector-only',
            unmeasuredCosts: ['package-verification', 'source-capture', 'workspace-replay', 'coordination',
                'module-parser-startup', 'organizational-review', 'energy', 'monetary-cost'],
            scope: 'actual-installed-local-finite-review; not-remote-or-institutional-execution',
            provenance: 'retained-local-observation-not-attested', authority: 'none', remoteExecution: 'unprovisioned'};
        return {result, observation};
    } finally { boundary?.close(); fs.rmSync(temporary, {recursive: true, force: true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index += 2) {
        assert.ok(['--workspace', '--request', '--attempt', '--route', '--profile', '--output'].includes(args[index])
            && args[index + 1] && !Object.hasOwn(options, args[index]), 'Use explicit workspace/request/attempt/route/output arguments');
        options[args[index]] = args[index + 1];
    }
    const output = outputDestination(options['--output']);
    const {result, observation} = await reviewInstalled({workspaceRaw: bounded(options['--workspace']).toString(),
        requestRaw: bounded(options['--request']).toString(), attempt: options['--attempt'], route: options['--route'],
        runtimeProfile: options['--profile'] ?? 'fleet-linux-x64'});
    fs.mkdirSync(output, {mode: 0o700});
    fs.writeFileSync(path.join(output, 'fleet-return.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    fs.writeFileSync(path.join(output, 'installed-observation.json'), JSON.stringify(observation, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({state: observation.state, authority: 'none', remoteExecution: 'unprovisioned', output}));
}
