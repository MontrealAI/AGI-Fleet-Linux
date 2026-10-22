// SPDX-License-Identifier: Apache-2.0
// Actual saved-package computation/return gate. Not a browser or remote-execution claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [installedRoot, output, profile = 'fleet-linux-x64', ...flags] = process.argv.slice(2);
const options = {};
for (let index = 0; index < flags.length; index += 2) {
    assert.ok(['--workspace', '--usdc-request', '--agialpha-request'].includes(flags[index])
        && flags[index + 1] && !Object.hasOwn(options, flags[index]), 'Use all three explicit saved input paths');
    options[flags[index]] = flags[index + 1];
}
assert.ok(Object.keys(options).length === 0 || Object.keys(options).length === 3);

assert.ok(path.isAbsolute(installedRoot) && path.isAbsolute(output));
assert.ok(!fs.existsSync(output));
const load = filename => import(pathToFileURL(filename).href);
const runtime = await load(path.join(installedRoot, 'discovery-lab/release/installed-review.mjs'));
const captured = runtime.captureInstalled(installedRoot);
const {parseModuleSources, checkDependencyRecords, createModuleBoundary} =
    await load(path.join(installedRoot, 'discovery-lab/release/module-closure.mjs'));
const destination = runtime.outputDestination(output, installedRoot);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-installed-acceptance-'));
const fixedNames = ['workspace.mjs', 'discovery-lab-contract.mjs',
    'discovery-lab-receipts.mjs', 'discovery-lab-evidence-history.mjs', 'discovery-lab-docket.mjs'];
const entries = fixedNames.map(name => 'alpha/examples/successor-capability/' + name);
const files = new Map([...captured.files].filter(([name]) => name.startsWith('alpha/') && name.endsWith('.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let boundary;
try {
    checkDependencyRecords(parseModuleSources([...files].map(([name, bytes]) => ({name, source: bytes.toString()})),
        captured.files.get('discovery-lab/release/module-closure.mjs').toString()), new Set(files.keys()));
    boundary = createModuleBoundary(temporary, files, entries);
    // Load only the saved package's already captured source bytes.
    const alphaModule = name => boundary.importModule('alpha/examples/successor-capability/' + name);
    const workspace = await alphaModule('workspace.mjs');
    const contract = await alphaModule('discovery-lab-contract.mjs');
    const receipts = await alphaModule('discovery-lab-receipts.mjs');
    const evidence = await alphaModule('discovery-lab-evidence-history.mjs');
    const docket = await alphaModule('discovery-lab-docket.mjs');
    const alpha = captured.profile.alpha;
    const trustedSource = {...captured.manifest.source,
        adapterSha256: sha(captured.files.get('discovery-lab/receiver.mjs')),
        contractSha256: sha(captured.files.get('discovery-lab/contract.mjs'))};
    const sources = {modelDigest: alpha.files['examples/successor-capability/discovery-lab.mjs'].sha256,
        evaluatorDigest: alpha.files['examples/successor-capability/discovery-lab-checker.mjs'].sha256,
        sourceDigest: alpha.sourceHash};
    const inputName = name => 'mission-input/discovery-continuation/' + name;
    const custodyRaw = captured.files.get('mission-input/CUSTODY.json');
    const custody = JSON.parse(custodyRaw);
    const inputProfile = JSON.parse(captured.files.get('discovery-lab/release/mission-input.json'));
    assert.equal(inputProfile.qualification, 'FROZEN_AUTHENTICATED_INPUT');
    assert.equal(sha(custodyRaw), inputProfile.transport.custodySha256);
    assert.equal(custodyRaw.length, inputProfile.transport.custodyBytes);
    assert.equal(custody.schema, 'successor/discovery-browser-artifact-custody/v1');
    assert.equal(custody.producer.event, 'push'); assert.equal(custody.producer.headBranch, 'main');
    assert.equal(custody.producer.headCommit, alpha.commit);
    assert.equal(custody.producer.checkoutCommit, alpha.commit);
    assert.equal(custody.producer.checkoutTree, alpha.tree);
    for (const [name, row] of Object.entries(custody.members)) {
        const raw = captured.files.get('mission-input/' + name);
        assert.equal(raw.length, row.bytes); assert.equal(sha(raw), row.sha256);
    }
    const journal = JSON.parse(captured.files.get(inputName('browser-native-requests.json')));
    const originalRaw = captured.files.get(inputName('fleet-browser-workspace.json'));
    assert.deepEqual(originalRaw, captured.files.get(inputName('jobs-browser-workspace.json')));
    const original = JSON.parse(originalRaw);
    const requests = new Map([['USDC', captured.files.get(inputName('fleet-browser-request.json'))],
        ['AGIALPHA', captured.files.get(inputName('jobs-browser-request.json'))]]);
    // Optional operator paths must be the same authenticated original bytes, never replacements.
    if (Object.keys(options).length) {
        for (const [flag, expected] of [['--workspace', originalRaw], ['--usdc-request', requests.get('USDC')],
            ['--agialpha-request', requests.get('AGIALPHA')]]) {
            assert.ok(path.isAbsolute(options[flag]), 'Use absolute saved input paths');
            const descriptor = fs.openSync(options[flag], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
            try { const info = fs.fstatSync(descriptor); assert.ok(info.isFile() && info.size === expected.length);
                const raw = Buffer.alloc(expected.length + 1); const count = fs.readSync(descriptor, raw, 0, raw.length, 0);
                assert.equal(count, expected.length); assert.deepEqual(raw.subarray(0, count), expected);
            } finally { fs.closeSync(descriptor); }
        }
    }
    assert.equal(journal.schema, 'actual-browser-native-request-exports/v1');
    assert.equal(journal.missionId, original.missionId);
    assert.equal(journal.workspace.sha256, sha(originalRaw));
    assert.deepEqual(journal.workspace.eventPrefix, original.events.map(event => event.digest));
    let value = await workspace.parseWorkspace(originalRaw.toString());
    const accepted = (await workspace.inspectWorkspace(value)).discovery.campaigns.filter(item => item.campaignDigest === journal.campaignDigest);
    assert.equal(accepted.length, 1);
    let campaign = accepted[0]; assert.equal(campaign.state, 'accepted');
    for (const [key, expected] of Object.entries(sources)) assert.equal(campaign.bindings[key], expected);
    const records = [], ids = [];
    fs.mkdirSync(destination, {mode: 0o700});
    fs.writeFileSync(path.join(destination, 'initial-workspace.json'), originalRaw);
    for (const [currency, route] of [['USDC', 'manager-usdc'], ['AGIALPHA', 'jobs-agialpha']]) {
        const requestRaw = requests.get(currency).toString();
        assert.equal(sha(requestRaw), journal.requests[route].sha256);
        const native = await runtime.reviewInstalled({workspaceRaw: originalRaw.toString(), requestRaw,
            attempt: campaign.attempt, route, runtimeProfile: profile}, installedRoot);
        const wrapper = native.result, envelope = JSON.parse(wrapper.raw), rawReceipt = JSON.parse(envelope.receiptRaw);
        assert.equal(rawReceipt.state, 'accepted-local-review');
        assert.equal(rawReceipt.authority, 'none');
        assert.equal(rawReceipt.remoteExecution, 'unprovisioned');
        assert.equal(rawReceipt.organizationalIndependence, false);
        assert.equal(native.observation.totalComplete, false);
        assert.equal(envelope.original, requestRaw);
        assert.deepEqual(wrapper.source, trustedSource);
        assert.deepEqual(await receipts.receiptRequestBindings(wrapper),
            Object.fromEntries(contract.BINDING_KEYS.map(key => [key, campaign.bindings[key]])));
        const admission = await receipts.inspectReceiverReceipt(wrapper, receipts.makeReceiverContext(campaign),
            {expectedReceiverSources: [trustedSource]});
        assert.equal(admission.inspectionKind, 'fleet-local-review');
        ids.push(admission.receiptId);
        campaign = (await workspace.inspectWorkspace(value)).discovery.campaigns.find(item => item.campaignDigest === journal.campaignDigest);
        const attachment = await evidence.evidencePayload(campaign.campaignDigest, 'receiver-receipt', wrapper);
        value = await workspace.recordDiscoveryEvent(value, 'lab-evidence-attached', attachment);
        await assert.rejects(workspace.recordDiscoveryEvent(value, 'lab-evidence-attached', attachment), /duplicate/i);
        const prefix = currency.toLowerCase();
        fs.writeFileSync(path.join(destination, prefix + '-request.json'), requestRaw);
        fs.writeFileSync(path.join(destination, prefix + '-return.json'), JSON.stringify(wrapper, null, 2) + '\n');
        fs.writeFileSync(path.join(destination, prefix + '-installed-observation.json'), JSON.stringify(native.observation, null, 2) + '\n');
        records.push({route, currency, requestSha256: sha(requestRaw), returnSha256: sha(JSON.stringify(wrapper)),
            receiptSha256: sha(envelope.receiptRaw), state: rawReceipt.state, receiptId: admission.receiptId,
            resourceUsed: rawReceipt.resourceUsed});
    }
    assert.equal(new Set(ids).size, 2);
    assert.equal(value.missionId, original.missionId);
    assert.equal(value.revision, original.revision + 2);
    assert.deepEqual(value.events.slice(0, original.events.length), original.events);
    assert.equal(value.events[original.events.length].previous, original.events.at(-1).digest);
    assert.deepEqual(value.events.slice(original.events.length).map(event => event.kind), ['lab-evidence-attached', 'lab-evidence-attached']);
    const text = await docket.exportDiscoveryDocket(value);
    assert.equal(Object.keys(JSON.parse(text).files).length, 13);
    await docket.verifyDiscoveryDocket(text, {expectedReceiverSources: [trustedSource]});
    const reopened = await workspace.parseWorkspace(contract.canonical(value));
    assert.equal(await docket.exportDiscoveryDocket(reopened), text);
    fs.writeFileSync(path.join(destination, 'workspace.json'), contract.canonical(value));
    fs.writeFileSync(path.join(destination, 'docket.json'), text);
    const report = {schema: 'agi-fleet/discovery-installed-acceptance/v1', profile,
        fleetSource: captured.manifest.source, alpha: {commit: alpha.commit, tree: alpha.tree, sourceHash: alpha.sourceHash},
        manifestSha256: captured.manifestSha256,
        inputKind: 'authenticated-alpha-ui-artifact', inputCustodySha256: sha(custodyRaw),
        inputWorkspaceSha256: sha(originalRaw), inputEventPrefix: journal.workspace.eventPrefix,
        inputHistoryHead: journal.workspace.head, inputRevision: journal.workspace.revision,
        missionId: value.missionId, historyHead: value.events.at(-1).digest,
        cases: records, passed: 2, total: 2, sameHistory: true, duplicateRefused: true,
        reopenedDocketByteIdentical: true, docketSha256: sha(text), totalComplete: false,
        scope: 'actual-saved-extracted-local-native-module-and-history-acceptance; browser-not-run',
        remoteExecution: 'unprovisioned', settlement: 'not-connected', organizationalIndependence: false, authority: 'none'};
    fs.writeFileSync(path.join(destination, 'qualification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({passed: 2, total: 2, sameHistory: true, docketSha256: report.docketSha256}));
} finally { boundary?.close(); fs.rmSync(temporary, {recursive: true, force: true}); }
