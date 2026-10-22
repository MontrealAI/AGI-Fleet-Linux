// SPDX-License-Identifier: MIT
// Actual source-development integration; host-selected checkout is not an installed release or capture qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, isAbsolute, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {canonical} from '../discovery-lab/contract.mjs';
import {createEnterpriseReceiver, enterpriseReceiverCapabilities, RECEIVER_ADMISSION_UNITS} from './receiver.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(canonical(value));
const configured = process.env.ALPHA_ENTERPRISE_ROOT;
const evidenceRoot = process.env.FLEET_ENTERPRISE_EVIDENCE_ROOT;
if (evidenceRoot) { assert.ok(isAbsolute(evidenceRoot)); mkdirSync(evidenceRoot); }
function saveEvidence(name, frame, result) {
    if (!evidenceRoot) return;
    writeFileSync(resolve(evidenceRoot, name + '-transport.json'), frame.raw);
    writeFileSync(resolve(evidenceRoot, name + '-context.json'), canonical(frame.context) + '\n');
    writeFileSync(resolve(evidenceRoot, name + '-receipt.json'), canonical(result) + '\n');
}
const route = {id: 'fleet-check', kind: 'execution-review', currency: 'NONE', decimals: 0,
    chainId: null, tokenAddress: null, capBaseUnits: '0', status: 'INSPECTION_ONLY'};

test('Fleet advertises inspection-only zero-cap source development without an installed execution claim', () => {
    const value = enterpriseReceiverCapabilities();
    assert.deepEqual(value.route, route); assert.equal(value.currencyCapBaseUnits, '0');
    assert.equal(value.installedSourceCaptureQualified, false); assert.equal(value.operationalPilot, 'NOT_RUN');
    assert.deepEqual(value.authority, []); assert.equal(value.externalSubmission, 'NOT_SUBMITTED');
    assert.equal(value.settlement, 'NOT_RUN');
});

if (!configured) {
    test('actual independently provisioned Alpha checkout is required for native integration',
        {skip: 'Set ALPHA_ENTERPRISE_ROOT to the explicit reviewed source checkout; no fixture is substituted.'}, () => {});
} else {
    assert.ok(isAbsolute(configured));
    const root = resolve(configured);
    const load = relative => import(pathToFileURL(resolve(root, relative)).href);
    const manifest = JSON.parse(readFileSync(resolve(root, 'docs/successor/capabilities/sources.json'), 'utf8'));
    const members = [...new Set(Object.keys(manifest.sources).filter(path => path.endsWith('.mjs'))
        .concat(['examples/autonomous-enterprises/native-contract.mjs']))].sort();
    const observedSources = Object.fromEntries(members.map(relative => {
        const filename = resolve(root, relative); assert.ok(filename.startsWith(root + sep));
        return [relative, sha(readFileSync(filename))];
    }));
    const commitBasis = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
    const source = {repository: 'MontrealAI/AGI-Alpha-Agent-v0', commit: commitBasis,
        constructor: observedSources['examples/autonomous-enterprises/foundry.mjs'],
        checker: observedSources['examples/autonomous-enterprises/checker.mjs'], closure: sha(canonical(observedSources))};
    const charterSource = Object.fromEntries(['constructor', 'checker', 'closure'].map(key => [key, source[key]]));
    const workspace = await load('examples/successor-capability/workspace.mjs');
    const controller = await load('examples/autonomous-enterprises/controller.mjs');
    const {defaultCharter} = await load('examples/autonomous-enterprises/protocol.mjs');
    const native = await load('examples/autonomous-enterprises/native-contract.mjs');
    const {DOCKET_PATHS} = await load('examples/successor-capability/discovery-lab-docket.mjs');
    const limits = {checkingUnits: 20_000_000, elapsedMs: 60_000, memoryBytes: 32_000_000};
    async function frozenMission(n = 2) {
        const charter = {...defaultCharter(charterSource), maxN: n,
            constructionLimit: n === 32 ? 2_000_000 : 100_000, taskLimit: 1};
        let value = await controller.start(await workspace.createWorkspace(), charter);
        for (let i = 0; i < 2; i++) value = await controller.next(value, {expectedSource: charterSource});
        return value;
    }
    const frozen = frozenMission();
    async function frame(value, suffix = 'ordinary', alternateLimits = limits) {
        const inspected = await workspace.inspectWorkspace(value), row = inspected.enterprises.attempts.at(-1);
        const inspectionId = 'inspection-fleet-' + suffix, logicalCommissionId = 'logical-enterprise-fleet-' + suffix;
        const context = {schema: native.CONTEXT_SCHEMA, source: copy(source), inspectionId, logicalCommissionId,
            route: copy(route), limits: copy(alternateLimits), binding: {missionId: value.missionId,
                revision: value.revision, eventHead: inspected.head,
                eventPrefixDigest: sha(canonical({missionId: value.missionId, revision: value.revision,
                    eventDigests: value.events.map(event => event.digest)})),
                attempt: row.attempt, state: row.state, freezeDigest: row.freeze.digest,
                artifactDigests: row.successor?.retainedArtifactDigests || row.freeze.artifactDigests,
                invocationId: row.invocation?.invocationId || null}};
        const transport = await native.createNativeExport(value, {attempt: row.attempt,
            inspectionId, logicalCommissionId, route: 'fleet-check', source, limits: alternateLimits});
        return {context, transport, raw: canonical(transport)};
    }
    const receiver = (context, extra = {}) => createEnterpriseReceiver({installedContext: context,
        inspectNativeRequest: native.inspectNativeRequest, ...extra});

    test('real n2 frozen mission and unchanged thirteen-section docket cross the actual Fleet receiver', async () => {
        const value = await frozen, before = canonical(value), f = await frame(value, 'positive');
        const service = receiver(f.context), result = await service.receive(f.raw);
        assert.equal(result.state, 'LOCAL_CHECKED'); assert.equal(result.nativeReceipt.accepted, true);
        assert.deepEqual(result.route, route); assert.deepEqual(result.binding, f.context.binding);
        assert.equal(result.originalTransport, f.raw); assert.equal(result.transportDigest, sha(f.raw));
        assert.equal(result.requestDigest, sha(canonical(f.transport.request)));
        assert.equal(result.nativeReceipt.docketDigest, sha(f.transport.docket));
        assert.deepEqual(Object.keys(JSON.parse(f.transport.docket).files).sort(), [...DOCKET_PATHS].sort());
        assert.equal(result.resourceUsed.checkingUnits, RECEIVER_ADMISSION_UNITS + result.nativeReceipt.resourceUsed.checkingUnits);
        assert.ok(result.nativeReceipt.work.knownReplayWork > 0); assert.ok(result.resourceUsed.memoryBytes > 0);
        assert.equal(result.installedSourceCaptureQualified, false); assert.deepEqual(result.authority, []);
        assert.equal(canonical(value), before);
        assert.equal(service.exportJournal().records[0].nativeReceiptDigest, sha(canonical(result.nativeReceipt)));
        saveEvidence('positive-n2', f, result);
    });

    test('same inspection is reconciled once and restored receiver history cannot execute it again', async () => {
        const f = await frame(await frozen, 'duplicate'), service = receiver(f.context);
        await service.receive(f.raw);
        await assert.rejects(service.receive(f.raw), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        const restored = receiver(f.context, {priorJournal: service.exportJournal()});
        await assert.rejects(restored.receive(f.raw), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        assert.equal(restored.exportJournal().records.length, 1);
    });

    test('the receiver reserves before awaiting and a recovered pending inspection never runs blindly', async () => {
        const f = await frame(await frozen, 'pending'), service = receiver(f.context);
        const first = service.receive(f.raw), pending = service.exportJournal();
        assert.equal(pending.records[0].state, 'PENDING');
        assert.equal(pending.records[0].nativeReservationUnresolved, true);
        await assert.rejects(service.receive(f.raw), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        const recovered = receiver(f.context, {priorJournal: pending});
        await assert.rejects(recovered.receive(f.raw), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        assert.equal((await first).state, 'LOCAL_CHECKED');
        assert.equal(recovered.exportJournal().records[0].state, 'PENDING');
    });

    test('wrong route, token, mission, source and invocation are refused against independently retained context', async () => {
        const f = await frame(await frozen, 'binding');
        for (const edit of [request => { request.route = native.routeFor('manager-usdc'); },
            request => { request.route.tokenAddress = native.routeFor('jobs-agialpha').tokenAddress; },
            request => { request.binding.missionId = 'capability-00000000-0000-4000-8000-000000000000'; },
            request => { request.source.closure = '9'.repeat(64); },
            request => { request.binding.invocationId = 'invocation-00000000-0000-4000-8000-000000000000'; }]) {
            const transport = copy(f.transport); edit(transport.request);
            await assert.rejects(receiver(f.context).receive(canonical(transport)), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        }
    });

    test('positive cap, submitted status and imported authority never become a Fleet commission', async () => {
        const f = await frame(await frozen, 'authority');
        for (const edit of [request => { request.route.capBaseUnits = '1'; },
            request => { request.externalSubmission = 'SUBMITTED'; },
            request => { request.authority = ['execute']; }]) {
            const transport = copy(f.transport); edit(transport.request);
            await assert.rejects(receiver(f.context).receive(canonical(transport)), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        }
    });

    test('changed docket and stale frozen evidence cannot inherit an earlier positive receipt', async () => {
        const f = await frame(await frozen, 'docket');
        const changed = copy(f.transport); changed.docket += ' ';
        const result = await receiver(f.context).receive(canonical(changed));
        assert.equal(result.state, 'LOCAL_REJECTED'); assert.deepEqual(result.authority, []);
        assert.equal(result.nativeReceipt.state, 'REJECTED');
        assert.equal(result.nativeReceipt.reconciliationKey, null);
        assert.equal(result.nativeReceipt.work.knownReplayWork, 0);
        assert.equal(result.nativeReceipt.work.unknownPartialReplay, false);
        saveEvidence('negative-docket', {...f, raw: canonical(changed)}, result);
        const stale = copy(f.transport); stale.request.binding.freezeDigest = '9'.repeat(64);
        await assert.rejects(receiver(f.context).receive(canonical(stale)), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
    });

    test('insufficient current checking budget remains inconclusive with a retained consumed inspection', async () => {
        const f = await frame(await frozen, 'budget', {...limits, checkingUnits: 0});
        const service = receiver(f.context), result = await service.receive(f.raw);
        assert.equal(result.state, 'INCONCLUSIVE'); assert.equal(result.nativeReceipt, null);
        assert.equal(result.receiverResourceUsed.checkingUnits, RECEIVER_ADMISSION_UNITS);
        await assert.rejects(service.receive(f.raw), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
    });

    test('zero memory or elapsed allowance refuses before native invocation', async () => {
        for (const field of ['memoryBytes', 'elapsedMs']) {
            const f = await frame(await frozen, 'zero-' + field, {...limits, [field]: 0});
            const service = receiver(f.context), result = await service.receive(f.raw);
            assert.equal(result.state, 'INCONCLUSIVE'); assert.equal(result.nativeReceipt, null);
            assert.equal(result.resourceUsed.checkingUnits, RECEIVER_ADMISSION_UNITS);
            assert.equal(service.exportJournal().records[0].nativeReservationUnresolved, false);
        }
    });

    test('actual bounded native queue-full refusal is retained as known unstarted without automatic retry', async () => {
        const value = await frozen, f = await frame(value, 'queue-refusal');
        const blockers = [];
        for (let i = 0; i < 4; i++) blockers.push(await frame(value, 'queue-slot-' + i));
        const occupied = blockers.map(item => native.inspectNativeRequest(item.transport.request, item.context,
            {docket: item.transport.docket}));
        const service = receiver(f.context), result = await service.receive(f.raw);
        await Promise.all(occupied);
        assert.equal(result.state, 'INCONCLUSIVE');
        assert.deepEqual(result.nativeReceipt.reasons, ['NATIVE_INSPECTION_QUEUE_FULL_NOT_STARTED']);
        assert.equal(result.nativeReceipt.work.knownReplayWork, 0);
        assert.equal(result.nativeReceipt.work.unknownPartialReplay, false);
        assert.equal(result.nativeReceipt.binding, null); assert.equal(result.nativeReceipt.source, null);
        assert.equal(result.nativeReceipt.reconciliationKey, null);
        assert.equal(result.resourceUsed.checkingUnits, 2 * RECEIVER_ADMISSION_UNITS);
        assert.equal(service.exportJournal().records[0].nativeReservationUnresolved, false);
        await assert.rejects(service.receive(f.raw), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        saveEvidence('known-unstarted-queue', f, result);
    });

    test('unknown historical invocation remains inconclusive after native replay and reload', async () => {
        let value = await frozen;
        for (let i = 0; i < 2; i++) value = await controller.next(value, {expectedSource: charterSource, seed: 55});
        const f = await frame(value, 'unknown'), service = receiver(f.context), result = await service.receive(f.raw);
        assert.equal(result.state, 'INCONCLUSIVE'); assert.equal(result.nativeReceipt.accepted, false);
        assert.equal(result.nativeReceipt.historicalState.unresolvedReservation, true);
        const restored = receiver(f.context, {priorJournal: service.exportJournal()});
        await assert.rejects(restored.receive(f.raw), /ENTERPRISE_NATIVE_INSPECTION_FAILED/);
        saveEvidence('unknown-invocation', f, result);
    });

    test('missing installed inspector and altered prior-journal custody fail closed', async () => {
        const f = await frame(await frozen, 'custody');
        assert.throws(() => createEnterpriseReceiver({installedContext: f.context, inspectNativeRequest: null}), /INSPECTOR_REQUIRED/);
        const service = receiver(f.context); await service.receive(f.raw);
        const journal = service.exportJournal(); journal.contextDigest = '0'.repeat(64);
        assert.throws(() => receiver(f.context, {priorJournal: journal}), /JOURNAL_CONTEXT/);
    });

    test('actual n32 current-source frozen history crosses Fleet with full basis evidence retained', async () => {
        const value = await frozenMission(32), f = await frame(value, 'dimension32');
        const result = await receiver(f.context).receive(f.raw);
        assert.equal(result.state, 'LOCAL_CHECKED'); assert.equal(result.nativeReceipt.accepted, true);
        const bundle = (await workspace.inspectWorkspace(value)).enterprises.attempts[0].bundle;
        assert.equal(bundle.convolution.verification.basisCases, 1024);
        assert.equal(bundle.inverseInherited.verification.basisCases, 32);
        saveEvidence('positive-n32', f, result);
    });

    test('source and runtime observations remain explicit development evidence with no capture promotion', t => {
        for (const [relative, expected] of Object.entries(observedSources)) assert.equal(sha(readFileSync(resolve(root, relative))), expected);
        const observation = {scope: 'ACTUAL_LOCAL_SOURCE_DEVELOPMENT_ONLY', gitHeadBasis: commitBasis,
            observedSourceMembers: members.length, observedClosureDigest: source.closure,
            runtime: {version: process.version, platform: process.platform, arch: process.arch,
                binarySha256: sha(readFileSync(process.execPath))}, installedSourceCaptureQualified: false,
            operationalPilot: 'NOT_RUN', ownerCandidate: '0dd352fdd2b1af00bc8358e0ac7f96682fd6f796'};
        t.diagnostic(JSON.stringify(observation));
        if (evidenceRoot) writeFileSync(resolve(evidenceRoot, 'source-runtime-observation.json'),
            canonical({...observation, observedSources}) + '\n');
    });
}
