import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AbiCoder, getAddress, Interface, keccak256 } from 'ethers';
import { LEGACY_CONTRACT_PROFILE as LEGACY, MANAGER_117_CONTRACT_PROFILE as CURRENT, MANAGER_1193_CONTRACT_PROFILE as LATEST,
  RUNTIME_CONTRACTS, CONTRACT_ARTIFACTS, loadContractProfile, contractProfileID } from '../shared/runtime/src/contract-profiles.mjs';
import { Chain as AgentChain, matchRuntime } from '../packages/AGI_Agent/src/chain.mjs';
import { Transactions } from '../packages/AGI_Agent/src/transactions.mjs';
import { codeOf, NodeError } from '../packages/AGI_Agent/src/util.mjs';
import { Chain as NodeChain } from '../packages/AGI_Node/src/chain.mjs';
import { DEFAULT as AGENT_DEFAULT, validateConfig as agentConfig, binding as agentBinding, preparationBinding } from '../packages/AGI_Agent/src/config.mjs';
import { DEFAULT as NODE_DEFAULT, validateConfig as nodeConfig, binding as nodeBinding } from '../packages/AGI_Node/src/config.mjs';
import { Chain as OperatorChain } from '../ops/chain.mjs';
import { config as operatorConfig } from './helpers.mjs';
import { binding as operatorBinding, inShard } from '../ops/config.mjs';
import { canonical, sha256 } from '../packages/AGI_Agent/src/util.mjs';
import { computeSourceIdentity } from '../shared/runtime/compute/source-identity.mjs';
import { acquireWalletLease } from '../packages/AGI_Agent/src/wallet-lease.mjs';
import { acquireWalletLease as nodeLease } from '../packages/AGI_Node/src/wallet-lease.mjs';

const fleet = fileURLToPath(new URL('..', import.meta.url));
const agentRoot = path.join(fleet, 'packages/AGI_Agent');
const address = n => getAddress('0x' + n.toString(16).padStart(40, '0'));
const profiles = Object.fromEntries([LEGACY, CURRENT, LATEST].map(id => [id, loadContractProfile(agentRoot, id)]));
function config(patch = {}) {
  return agentConfig({ ...structuredClone(AGENT_DEFAULT), chainId: 31337,
    manager: address(10), agent: address(30), deploymentBlock: 1,
    confirmations: 1, trustedBuyers: [address(40)], ...patch }, '/tmp/profile-config');
}
function fixture(id = LEGACY) {
  const profile = profiles[id], addresses = Object.fromEntries(RUNTIME_CONTRACTS.map((name, index) => [name, address(index + 10)]));
  const token = address(100), codes = {};
  for (const name of RUNTIME_CONTRACTS) {
    const artifact = profile.artifacts[name];
    let code = artifact.deployedBytecode;
    const patch = (start, length, value) => { code = code.slice(0, 2 + start * 2) + value + code.slice(2 + (start + length) * 2); };
    for (const libs of Object.values(artifact.deployedLinkReferences))
      for (const [lib, refs] of Object.entries(libs))
        for (const ref of refs) patch(ref.start, ref.length, addresses[lib].slice(2).toLowerCase());
    for (const refs of Object.values(artifact.immutableReferences))
      for (const ref of refs) patch(ref.start, ref.length, (name === 'AGIJobManager' ? token : addresses[name]).slice(2).toLowerCase().padStart(ref.length * 2, '0'));
    codes[name] = code;
  }
  let calls = 0;
  const abi = new Interface(profile.artifacts.AGIJobManager.abi), coder = AbiCoder.defaultAbiCoder();
  const provider = {
    getNetwork: async () => { calls++; return { chainId: 31337n }; },
    getBlock: async () => { calls++; return { number: 100, hash: '0x' + 'ab'.repeat(32), timestamp: Math.floor(Date.now() / 1000) }; },
    getCode: async (target, block) => { calls++; if (block === 0) return '0x'; return codes[Object.keys(addresses).find(name => addresses[name].toLowerCase() === target.toLowerCase())] ?? '0x'; },
    call: async tx => {
      calls++;
      if (tx.data === abi.getFunction('usdcToken').selector) return coder.encode(['address'], [token]);
      if (tx.data === '0x313ce567') return coder.encode(['uint8'], [6]);
      // Policy reads for the four operator roles use synthetic stable fixture values.
      const fn = abi.getFunction(tx.data.slice(0, 10));
      if (fn?.outputs.length === 1) return coder.encode(fn.outputs, [fn.outputs[0].type === 'address' ? address(200) : 1n]);
      throw Error('Unexpected fixture RPC call');
    },
  };
  return { profile, addresses, token, codes, provider, calls: () => calls };
}

test('finite optional profile selectors preserve omitted legacy config and authority hashes', () => {
  const c = config(), pin = { fixture: true };
  assert.equal(Object.hasOwn(c, 'contractProfile'), false);
  const { dataDir, keystore, ...authority } = c;
  assert.equal(agentBinding(c, pin), sha256(canonical({ config: authority, deployment: pin })));
  const explicit = config({ contractProfile: LEGACY }), current = config({ contractProfile: CURRENT });
  assert.notEqual(agentBinding(c, pin), agentBinding(explicit, pin));
  assert.notEqual(agentBinding(explicit, pin), agentBinding(current, pin));
  assert.notEqual(preparationBinding(c, pin), preparationBinding(current, pin));
  for (const invalid of ['', null, undefined, '../artifacts', '/tmp/profile', 'main', 'v1.17.0', 'f'.repeat(64), {}, ['manager-1.17.0-b7218196']])
    for (const validate of [patch => config(patch), patch => nodeConfig({ ...structuredClone(NODE_DEFAULT), ...patch }), patch => operatorConfig('moderator', patch)])
      assert.throws(() => validate({ contractProfile: invalid }), /CONFIG_CONTRACT_PROFILE/);
  for (const key of ['contractProfilePath', 'contractProfileSHA256', 'artifacts', 'libraryProfiles'])
    assert.throws(() => config({ [key]: CURRENT }), /CONFIG_UNKNOWN_FIELD/);
  const n = nodeConfig(structuredClone(NODE_DEFAULT));
  assert.notEqual(nodeBinding(n, pin), nodeBinding({ ...n, contractProfile: CURRENT }, pin));
  const o = operatorConfig('moderator');
  assert.notEqual(operatorBinding(o, pin), operatorBinding({ ...o, contractProfile: CURRENT }, pin));
});

test('all reviewed bundles bind exactly eleven artifacts and immutable complete provenance', () => {
  for (const profile of Object.values(profiles)) {
    assert.deepEqual(Object.keys(profile.artifacts).sort(), [...CONTRACT_ARTIFACTS].sort());
    assert.ok(Object.isFrozen(profile.artifacts.ENSOwnership.deployedLinkReferences));
    assert.throws(() => { profile.artifacts.ENSOwnership.deployedBytecode = '0x'; }, TypeError);
  }
  assert.notEqual(profiles[LEGACY].artifacts.ENSOwnership.deployedBytecode, profiles[CURRENT].artifacts.ENSOwnership.deployedBytecode);
  assert.deepEqual(profiles[LEGACY].artifacts.AGIJobManager.abi, profiles[CURRENT].artifacts.AGIJobManager.abi);
  assert.equal(Object.keys(profiles[CURRENT].manifest.productionSources).length, 11);
});

for (const [label, Chain] of [['Agent', AgentChain], ['Node', NodeChain], ['Operator', OperatorChain]]) {
  test(label + ' enrolls and revalidates complete coherent legacy and explicit Manager graphs', async () => {
    for (const id of [undefined, LEGACY, CURRENT, LATEST]) {
      const f = fixture(id), c = config(id ? { contractProfile: id } : {}), chain = new Chain(c, f.provider);
      const pin = await chain.enroll();
      assert.equal(pin.sourceCommit, f.profile.sourceCommit);
      assert.equal(pin.contractProfile, id);
      assert.equal(Object.hasOwn(pin, 'contractProfileSHA256'), id !== undefined);
      if (id) assert.equal(pin.contractProfileSHA256, f.profile.manifestSHA256);
      assert.equal(Object.keys(pin.contracts).length, 9);
      await chain.verify(pin);
    }
  });
}

test('profile and pin substitution fails before RPC or signer use', async () => {
  const f = fixture(CURRENT), c = config({ contractProfile: CURRENT }), chain = new AgentChain(c, f.provider), pin = await chain.enroll();
  for (const mutate of [p => { delete p.contractProfile; }, p => { delete p.contractProfileSHA256; }, p => { p.contractProfile = LEGACY; }, p => { p.contractProfileSHA256 = '0'.repeat(64); }, p => { p.sourceCommit = profiles[LEGACY].sourceCommit; }, p => { p.sourceTag = 'v1.1.0'; }]) {
    const changed = structuredClone(pin); mutate(changed); const before = f.calls();
    await assert.rejects(chain.verify(changed), /DEPLOYMENT_CONTRACT_PROFILE_MISMATCH/);
    assert.equal(f.calls(), before);
  }
  const legacy = new AgentChain(config(), f.provider), before = f.calls();
  await assert.rejects(legacy.verify(pin), /DEPLOYMENT_CONTRACT_PROFILE_MISMATCH/);
  assert.equal(f.calls(), before);
  c.contractProfile = LEGACY;
  await assert.rejects(chain.verify(pin), /CONTRACT_PROFILE_CHANGED/);
  assert.equal(f.calls(), before);
});

test('mixed 1.17 manager and legacy ENS library fail enrollment and relabelled-pin verification', async () => {
  const old = fixture(), f = fixture(CURRENT), c = config({ contractProfile: CURRENT });
  const chain = new AgentChain(c, f.provider), pin = await chain.enroll();
  f.codes.ENSOwnership = old.codes.ENSOwnership;
  await assert.rejects(chain.enroll(), /RUNTIME_(BYTECODE|LENGTH)_MISMATCH/);
  const relabelled = structuredClone(pin);
  relabelled.contracts.ENSOwnership.codeHash = keccak256(f.codes.ENSOwnership);
  await assert.rejects(chain.verify(relabelled), /RUNTIME_(BYTECODE|LENGTH)_MISMATCH/);
  assert.throws(() => matchRuntime('ENSOwnership', f.addresses.ENSOwnership, old.codes.ENSOwnership, f.token, {}, CURRENT), /RUNTIME_(BYTECODE|LENGTH)_MISMATCH/);
  assert.throws(() => matchRuntime('ENSOwnership', f.addresses.ENSOwnership, fixture(CURRENT).codes.ENSOwnership, f.token), /RUNTIME_(BYTECODE|LENGTH)_MISMATCH/);
  await assert.rejects(new AgentChain(config(), fixture(CURRENT).provider).enroll(), /RUNTIME_(BYTECODE|LENGTH)_MISMATCH/);
});

test('current 1.19.3 profile refuses previous-generation code and pins before any signing', async () => {
  for (const previous of [LEGACY, CURRENT]) {
    const f = fixture(LATEST), c = config({ contractProfile: LATEST });
    const chain = new AgentChain(c, f.provider), pin = await chain.enroll();
    const prior = fixture(previous);
    f.codes.AGIJobManager = prior.codes.AGIJobManager;
    await assert.rejects(chain.enroll(), /RUNTIME_(BYTECODE|LENGTH)_MISMATCH/);
    const changed = structuredClone(pin);
    changed.contracts.AGIJobManager.codeHash = keccak256(f.codes.AGIJobManager);
    await assert.rejects(chain.verify(changed), /RUNTIME_(BYTECODE|LENGTH)_MISMATCH/);
    const priorPin = await new AgentChain(config({ contractProfile: previous }), prior.provider).enroll();
    const before = f.calls();
    await assert.rejects(chain.verify(priorPin), /DEPLOYMENT_CONTRACT_PROFILE_MISMATCH/);
    assert.equal(f.calls(), before);
  }
  assert.equal(profiles[LATEST].sourceCommit, 'd0c2cbaf58b594e20d888c3fc744bada06172306');
  const input = JSON.parse(fs.readFileSync(path.join(profiles[LATEST].base, 'compiler-inputs', profiles[LATEST].provenance.artifacts.AGIJobManager.buildInfoId + '.json')));
  assert.equal(input.settings.viaIR, true);
  assert.equal(input.settings.optimizer.runs, 40);
  assert.equal(input.settings.evmVersion, 'shanghai');
  assert.ok(!/[LE]/.test(input.settings.optimizer.details.yulDetails.optimizerSteps));
});

test('rehashed pin graph cannot substitute an address, token immutable, member or linked target', async () => {
  for (const mutate of [
    p => { p.contracts.AGIJobManager.address = address(99); },
    p => { p.token = address(101); },
    p => { p.contracts.Other = p.contracts.UriUtils; delete p.contracts.UriUtils; },
    p => { p.contracts.UriUtils.address = p.contracts.TransferUtils.address; p.contracts.UriUtils.codeHash = p.contracts.TransferUtils.codeHash; },
  ]) {
    const f = fixture(CURRENT), chain = new AgentChain(config({ contractProfile: CURRENT }), f.provider), pin = await chain.enroll();
    mutate(pin);
    await assert.rejects(chain.verify(pin), /DEPLOYMENT_CODE_CHANGED|INCOMPLETE_LIBRARY_GRAPH|RUNTIME_(BYTECODE|LENGTH)_MISMATCH|LIBRARY_ADDRESS_MISMATCH/);
  }
});

test('tampered artifact or compiler input fails its shipped profile integrity', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-contract-profile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(agentRoot, 'contract'), path.join(dir, 'contract'), { recursive: true });
  for (const name of ['artifacts/ENSOwnership.json', 'compiler-inputs/' + profiles[LEGACY].provenance.artifacts.AGIJobManager.buildInfoId + '.json']) {
    const file = path.join(dir, 'contract', name), original = fs.readFileSync(file);
    fs.appendFileSync(file, '\n');
    assert.throws(() => loadContractProfile(dir, LEGACY), /CONTRACT_PROFILE_INTEGRITY/);
    fs.writeFileSync(file, original);
  }
  const target = path.join(dir, 'contract/artifacts/ENSOwnership.json');
  fs.unlinkSync(target); fs.symlinkSync(path.join(agentRoot, 'contract/artifacts/ENSOwnership.json'), target);
  assert.throws(() => loadContractProfile(dir, LEGACY), /CONTRACT_PROFILE_PATH/);
});

test('all fourteen standalone and nested role adapters resolve the same reviewed profiles', async () => {
  const packages = ['AGI_Agent', 'AGI_Node', 'AGI_Employer', 'AGI_Evidence', 'AGI_Moderator', 'AGI_Recovery'];
  let count = 0;
  for (const name of packages) {
    const bases = [path.join(fleet, 'packages', name)];
    if (!['AGI_Agent', 'AGI_Node'].includes(name)) bases.push(...['AGI_Agent', 'AGI_Node'].map(child => path.join(fleet, 'packages', name, 'packages', child)));
    for (const base of bases) {
      const module = await import(pathToFileURL(path.join(base, 'src/contract-profiles.mjs')));
      assert.equal(module.loadContractProfile(base, CURRENT).manifestSHA256, profiles[CURRENT].manifestSHA256);
      assert.equal(module.loadContractProfile(base, LATEST).manifestSHA256, profiles[LATEST].manifestSHA256);
      assert.equal(module.loadContractProfile(base).manifestSHA256, profiles[LEGACY].manifestSHA256);
      count++;
    }
  }
  assert.equal(count, 14);
});

test('profile change cannot split wallet lease, market sharding, limits, STOP or journals', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-contract-authority-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = acquireWalletLease(31337, address(30), dir); t.after(release);
  assert.throws(() => nodeLease(31337, address(30), dir), /WALLET_ALREADY_RUNNING/);
  const old = operatorConfig('moderator'), current = operatorConfig('moderator', { contractProfile: CURRENT });
  for (let job = 0; job < 50; job++) assert.equal(inShard(old, job), inShard(current, job));
  assert.deepEqual(config().limits, config({ contractProfile: CURRENT }).limits);
  fs.writeFileSync(path.join(dir, 'STOP'), 'existing-stop');
  fs.writeFileSync(path.join(dir, 'journal.json'), '{"spent":"17","pending":"keep"}');
  const before = ['STOP', 'journal.json'].map(name => fs.readFileSync(path.join(dir, name)));
  config({ contractProfile: CURRENT }); loadContractProfile(agentRoot, CURRENT);
  assert.deepEqual(['STOP', 'journal.json'].map(name => fs.readFileSync(path.join(dir, name))), before);
});


test('profile mismatch blocks the actual transaction entry before signing or budget mutation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-profile-signer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fixture(CURRENT), c = config({ contractProfile: CURRENT, dataDir: dir });
  const chain = new AgentChain(c, f.provider), pin = await chain.enroll();
  f.codes.ENSOwnership = fixture().codes.ENSOwnership;
  pin.contracts.ENSOwnership.codeHash = keccak256(f.codes.ENSOwnership);
  const binding = agentBinding(c, pin);
  fs.writeFileSync(path.join(dir, 'activation.json'), JSON.stringify({ binding, agent: c.agent }));
  let signed = 0, changed = 0;
  const store = { pending: () => null, set: () => changed++ };
  const signer = { getAddress: async () => c.agent, signTransaction: async () => { signed++; throw Error('must not sign'); } };
  const tx = new Transactions(c, chain, store, signer, pin, binding);
  await assert.rejects(tx.send({}, { kind: 'claim' }), error => {
    assert.ok(error instanceof NodeError);
    assert.match(codeOf(error), /^RUNTIME_(BYTECODE|LENGTH)_MISMATCH$/);
    return true;
  });
  assert.equal(signed, 0); assert.equal(changed, 0);
  const legacyConfig = config({ dataDir: dir });
  fs.writeFileSync(path.join(dir, 'activation.json'), JSON.stringify({ binding: agentBinding(legacyConfig, pin), agent: c.agent }));
  await assert.rejects(tx.send({}, { kind: 'claim' }), /ACTIVATION_SCOPE_CHANGED/);
  assert.equal(signed, 0); assert.equal(changed, 0);
});


test('replacing artifact, provenance and recomputed manifest together cannot replace the code-pinned graph', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-profile-manifest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'runtime/src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.symlinkSync(path.dirname(path.dirname(fileURLToPath(import.meta.resolve('ethers')))), path.join(dir, 'node_modules/ethers'));
  fs.copyFileSync(path.join(fleet, 'shared/runtime/src/contract-profiles.mjs'), path.join(dir, 'runtime/src/contract-profiles.mjs'));
  fs.cpSync(path.join(fleet, 'shared/runtime/contract-profiles'), path.join(dir, 'runtime/contract-profiles'), { recursive: true });
  const fresh = await import(pathToFileURL(path.join(dir, 'runtime/src/contract-profiles.mjs')));
  assert.equal(fresh.loadContractProfile(agentRoot, CURRENT).manifestSHA256, profiles[CURRENT].manifestSHA256);
  const bundle = path.join(dir, 'runtime/contract-profiles', CURRENT);
  const artifact = path.join(bundle, 'artifacts/ENSOwnership.json');
  const replacement = fs.readFileSync(path.join(agentRoot, 'contract/artifacts/ENSOwnership.json'));
  fs.writeFileSync(artifact, replacement);
  const provenanceFile = path.join(bundle, 'artifact-provenance.json'), provenance = JSON.parse(fs.readFileSync(provenanceFile));
  provenance.artifacts.ENSOwnership.artifactSHA256 = sha256(replacement);
  fs.writeFileSync(provenanceFile, JSON.stringify(provenance));
  const manifestFile = path.join(dir, 'runtime/contract-profiles', CURRENT + '.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.files['artifacts/ENSOwnership.json'] = sha256(replacement);
  manifest.files['artifact-provenance.json'] = sha256(fs.readFileSync(provenanceFile));
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  await assert.rejects(async () => fresh.loadContractProfile(agentRoot, CURRENT), /CONTRACT_PROFILE_INTEGRITY/);
});

test('symlinked parent directories fail closed and profile-source changes invalidate runtime source identity', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-profile-parent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = path.join(dir, 'real'); fs.mkdirSync(real);
  fs.cpSync(path.join(agentRoot, 'contract'), path.join(real, 'contract'), { recursive: true });
  fs.symlinkSync(real, path.join(dir, 'alias'));
  assert.throws(() => loadContractProfile(path.join(dir, 'alias'), LEGACY), /CONTRACT_PROFILE_PATH/);
  fs.renameSync(path.join(real, 'contract/artifacts'), path.join(real, 'original-artifacts'));
  fs.symlinkSync(path.join(real, 'original-artifacts'), path.join(real, 'contract/artifacts'));
  assert.throws(() => loadContractProfile(real, LEGACY), /CONTRACT_PROFILE_PATH/);
  const source = path.join(dir, 'source');
  for (const name of ['compute', 'src', 'shared/runtime/contract-profiles']) fs.mkdirSync(path.join(source, name), { recursive: true });
  const manifest = path.join(source, 'shared/runtime/contract-profiles/profile.json');
  fs.writeFileSync(manifest, JSON.stringify(profiles[LEGACY].manifest));
  const legacyIdentity = computeSourceIdentity(source);
  fs.writeFileSync(manifest, JSON.stringify(profiles[CURRENT].manifest));
  assert.notEqual(computeSourceIdentity(source), legacyIdentity);
});
