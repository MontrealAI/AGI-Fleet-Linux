// SPDX-License-Identifier: Apache-2.0
// Constructed native regression fixture only. Never original Alpha UI mission acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [installedRoot, output, profile = 'fleet-linux-x64'] = process.argv.slice(2);
assert.ok(path.isAbsolute(installedRoot) && path.isAbsolute(output));
assert.ok(!fs.existsSync(output));
const load = filename => import(pathToFileURL(filename).href);
const runtime = await load(path.join(installedRoot, 'discovery-lab/release/installed-review.mjs'));
const captured = runtime.captureInstalled(installedRoot);
const {parseModuleSources, checkDependencyRecords, createModuleBoundary} =
    await load(path.join(installedRoot, 'discovery-lab/release/module-closure.mjs'));
const destination = runtime.outputDestination(output, installedRoot);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-installed-acceptance-'));
const fixedNames = ['workspace.mjs', 'discovery-lab-history.mjs', 'discovery-lab.mjs', 'discovery-lab-contract.mjs',
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
    const history = await alphaModule('discovery-lab-history.mjs');
    const model = await alphaModule('discovery-lab.mjs');
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
    let value = await workspace.createWorkspace();
    const start = await history.startPayload(value, model.DEFAULT_CHARTER, sources);
    value = await workspace.recordDiscoveryEvent(value, 'lab-started', start);
    const began = performance.now();
    const result = model.runCampaign(model.DEFAULT_CHARTER);
    const checked = model.verifyCampaign(model.DEFAULT_CHARTER, result);
    value = await workspace.recordDiscoveryEvent(value, 'lab-completed',
        await history.completedPayload(start.attempt, result, Math.ceil(performance.now() - began), checked.verificationResources));
    let campaign = (await workspace.inspectWorkspace(value)).discovery.campaigns.at(-1);
    assert.equal(campaign.state, 'accepted');
    const limits = {acquisitions: 0, checking: 20_000, elapsedMs: 120_000, installations: 0,
        memoryBytes: 10_000_000, search: 0, storageBytes: 4_000_000, workerCapacity: 4};
    for (let item = campaign; item; item = item.parent) for (const key of ['acquisitions', 'search', 'checking', 'installations'])
        limits[key] += item.charter.budget[key];
    const records = [], ids = [];
    fs.mkdirSync(destination, {mode: 0o700});
    fs.writeFileSync(path.join(destination, 'initial-workspace.json'), contract.canonical(value));
    for (const [currency, route] of [['USDC', 'manager-usdc'], ['AGIALPHA', 'jobs-agialpha']]) {
        campaign = (await workspace.inspectWorkspace(value)).discovery.campaigns.at(-1);
        const requestRaw = contract.canonical(await history.workRequest(campaign, currency, limits));
        const native = await runtime.reviewInstalled({workspaceRaw: contract.canonical(value), requestRaw,
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
    const text = await docket.exportDiscoveryDocket(value);
    await docket.verifyDiscoveryDocket(text, {expectedReceiverSources: [trustedSource]});
    const reopened = await workspace.parseWorkspace(contract.canonical(value));
    assert.equal(await docket.exportDiscoveryDocket(reopened), text);
    fs.writeFileSync(path.join(destination, 'workspace.json'), contract.canonical(value));
    fs.writeFileSync(path.join(destination, 'docket.json'), text);
    const report = {schema: 'agi-fleet/discovery-installed-acceptance/v1', profile, inputKind: 'constructed-regression-fixture',
        fleetSource: captured.manifest.source, alpha: {commit: alpha.commit, tree: alpha.tree, sourceHash: alpha.sourceHash},
        manifestSha256: captured.manifestSha256, missionId: value.missionId, historyHead: value.events.at(-1).digest,
        cases: records, passed: 2, total: 2, sameHistory: true, duplicateRefused: true,
        reopenedDocketByteIdentical: true, docketSha256: sha(text), totalComplete: false,
        scope: 'constructed-regression-fixture-only; not-authenticated-alpha-ui-input',
        remoteExecution: 'unprovisioned', settlement: 'not-connected', organizationalIndependence: false, authority: 'none'};
    fs.writeFileSync(path.join(destination, 'qualification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({passed: 2, total: 2, sameHistory: true, docketSha256: report.docketSha256}));
} finally { boundary?.close(); fs.rmSync(temporary, {recursive: true, force: true}); }
