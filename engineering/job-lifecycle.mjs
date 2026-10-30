// Engineering fixture: actual clients and freshly compiled manager, local chain only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [fleetArg, managerArg, reportArg, ...profileArgs] = process.argv.slice(2);
assert.ok(profileArgs.length === 0 || (profileArgs.length === 2 && profileArgs[0] === '--contract-profile'), 'Use --contract-profile <reviewed-profile-id>');
const contractProfile = profileArgs.length ? profileArgs[1] : undefined;
assert.ok(fleetArg && managerArg && reportArg, 'Usage: node job-lifecycle.mjs <fleet> <manager> <report>');
const fleet = path.resolve(fleetArg), managerRoot = path.resolve(managerArg);
const agentRoot = path.join(fleet, 'packages/AGI_Agent');
const nodeRoot = path.join(fleet, 'packages/AGI_Node');
const requireManager = createRequire(path.join(managerRoot, 'package.json'));
const { default: hre } = await import(pathToFileURL(requireManager.resolve('hardhat')));
const { BrowserProvider, ContractFactory, HDNodeWallet, ZeroAddress, ZeroHash, parseUnits } =
  await import(pathToFileURL(requireManager.resolve('ethers')));
const load = (root, file) => import(pathToFileURL(path.join(root, file)));
const [agentChain, agentConfig, agentStore, agentEngine, content, review, util, fixtures, rpc,
  nodeChain, nodeConfig, nodeStore, nodeEngine] = await Promise.all([
  load(agentRoot, 'src/chain.mjs'), load(agentRoot, 'src/config.mjs'),
  load(agentRoot, 'src/store.mjs'), load(agentRoot, 'src/engine.mjs'),
  load(agentRoot, 'src/content.mjs'), load(agentRoot, 'src/review.mjs'),
  load(agentRoot, 'src/util.mjs'), load(agentRoot, 'tests/fixtures.mjs'),
  load(agentRoot, 'tests/dual-rpc-fixture.mjs'),
  load(nodeRoot, 'src/chain.mjs'), load(nodeRoot, 'src/config.mjs'),
  load(nodeRoot, 'src/store.mjs'), load(nodeRoot, 'src/engine.mjs'),
]);

// The working directory is the frozen Agent package with an explicitly local config.
assert.equal(process.cwd(), agentRoot);
const connection = await hre.network.connect('hardhat');
const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
assert.equal(Number((await provider.getNetwork()).chainId), 31337);
const wallets = Array.from({ length: 8 }, (_, i) => HDNodeWallet.fromPhrase(
  'test test test test test test test test test test test junk', undefined,
  `m/44'/60'/0'/0/${i}`,
).connect(provider));
const [owner, buyer, agent, v1, v2, v3, fee30, fee10] = wallets;
const validators = [v1, v2, v3];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-current-manager-'));
const stores = new Set(), addresses = {};
const mined = async promise => (await promise).wait();
const realNow = Date.now;
let dual;

try {
  async function deploy(name, args = []) {
    const artifact = JSON.parse(fs.readFileSync(path.join(managerRoot, 'build/contracts', name + '.json')));
    let bytecode = artifact.bytecode;
    for (const libraries of Object.values(artifact.linkReferences)) {
      for (const [library, references] of Object.entries(libraries)) {
        if (!addresses[library]) await deploy(library);
        for (const { start, length } of references) {
          bytecode = bytecode.slice(0, 2 + start * 2) + addresses[library].slice(2).toLowerCase() +
            bytecode.slice(2 + (start + length) * 2);
        }
      }
    }
    const contract = await new ContractFactory(artifact.abi, bytecode, owner).deploy(...args);
    await contract.waitForDeployment();
    addresses[name] = await contract.getAddress();
    return contract;
  }

  const token = await deploy('FailingERC20');
  const constructorArgs = [
    addresses.FailingERC20, 'ipfs://', [ZeroAddress, ZeroAddress],
    [ZeroHash, ZeroHash, ZeroHash, ZeroHash], [ZeroHash, ZeroHash], [fee30.address, fee10.address],
  ];
  // This exact reviewed generation requires an explicit initial governor.
  // Preserve the six historical arguments for the unchanged older profiles.
  if (contractProfile === 'manager-1.19.3-d0c2cbaf') constructorArgs.push(owner.address);
  const manager = await deploy('AGIJobManager', constructorArgs);
  assert.equal(await manager.owner(), owner.address);
  const deploymentBlock = (await manager.deploymentTransaction().wait()).blockNumber;
  await mined(manager.addAdditionalAgent(agent.address));
  for (const validator of validators) await mined(manager.addAdditionalValidator(validator.address));
  assert.equal(await manager.voteQuorum(), 3n);
  assert.equal(await manager.completionReviewPeriod(), 7n * 86400n);
  await mined(manager.unpauseIntake());
  const initial = parseUnits('1000', 6), payout = parseUnits('100', 6);
  for (const wallet of [buyer, agent, ...validators]) await mined(token.mint(wallet.address, initial));

  // Content and generation are deterministic fixtures; no provider or public upload.
  const evidence = new Map();
  const publishBytes = value => {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    const cid = content.rawCID(bytes);
    evidence.set(cid, bytes);
    return 'ipfs://' + cid;
  };
  const specification = publishBytes(fixtures.sampleSpec);
  const id = String(await manager.nextJobId());
  await mined(token.connect(buyer).approve(addresses.AGIJobManager, payout));
  await mined(manager.connect(buyer).createJob(specification, payout, 3600, review.DECLARATION));
  dual = await rpc.dualFixture(connection.provider, directory);

  const base = {
    ...(contractProfile ? { contractProfile } : {}),
    chainId: 31337, manager: addresses.AGIJobManager, deploymentBlock,
    confirmations: 1, trustedBuyers: [buyer.address],
  };
  const cfg = agentConfig.validateConfig({
    ...structuredClone(agentConfig.DEFAULT), ...base, agent: agent.address,
    dataDir: path.join(directory, 'agent'),
    execution: { ...agentConfig.DEFAULT.execution, publicDataOnly: true, publicPublishing: true },
  }, directory, { ready: true });
  const chain = new agentChain.Chain(cfg, dual.provider), pin = await chain.enroll();
  const reader = new content.ContentReader(cfg, async url => {
    const bytes = evidence.get(new URL(url).pathname.split('/')[2]);
    assert.ok(bytes, 'Content must exist in the fixture');
    return bytes;
  });
  let generations = 0, publications = 0;
  const options = {
    live: true, signer: agent, reader,
    executor: async kind => kind === 'generate'
      ? (generations++, { status: 'complete', content: JSON.stringify(fixtures.goodDelivery) })
      : { verdict: 'pass' },
    publisher: {
      publish: async value => (publications++, publishBytes(value)),
      verify: async (uri, value) => {
        assert.deepEqual((await reader.read(uri)).bytes, Buffer.from(value));
        return true;
      },
    },
  };
  let store = new agentStore.Store(cfg.dataDir); stores.add(store);
  util.atomicWrite(path.join(cfg.dataDir, 'activation.json'), util.encode({
    binding: agentConfig.binding(cfg, pin), agent: agent.address,
  }));
  let engine = new agentEngine.Engine(cfg, chain, store, pin, options);
  function restartAgent() {
    store.close(); stores.delete(store);
    store = new agentStore.Store(cfg.dataDir); stores.add(store);
    engine = new agentEngine.Engine(cfg, chain, store, pin, options);
  }
  async function until(client, predicate, label) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await predicate()) return;
      await client.cycle();
    }
    assert.ok(await predicate(), label);
  }
  await engine.cycle();
  assert.equal(store.work(id).stage, 'draft');
  restartAgent();
  await until(engine, () => store.pending()?.kind === 'approve', 'Agent must journal exact bond approval');
  const approvalHash = store.pending().hash;
  restartAgent();
  await engine.cycle();
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM txs WHERE hash=?').get(approvalHash).n, 1);
  await until(engine, async () => (await manager.getJobValidation(id)).completionRequested,
    'Agent must submit its prepared delivery');
  if (store.pending()) await engine.cycle();
  assert.equal((await manager.getJobCore(id)).assignedAgent, agent.address);
  assert.deepEqual((await reader.read(await manager.getJobCompletionURI(id))).bytes,
    Buffer.from(JSON.stringify(fixtures.goodDelivery)));
  assert.equal(generations, 1); assert.equal(publications, 1);

  const nodes = [];
  for (const validator of validators) {
    const nc = nodeConfig.validateConfig({
      ...structuredClone(nodeConfig.DEFAULT), ...base, validator: validator.address,
      dataDir: path.join(directory, validator.address),
    }, directory, { ready: true });
    const ch = new nodeChain.Chain(nc, dual.provider), np = await ch.enroll();
    let st = new nodeStore.Store(nc.dataDir); stores.add(st);
    util.atomicWrite(path.join(nc.dataDir, 'activation.json'), util.encode({
      binding: nodeConfig.binding(nc, np), validator: validator.address,
    }));
    const opts = { live: true, signer: validator, reader };
    let client = new nodeEngine.Engine(nc, ch, st, np, opts);
    const restart = () => {
      st.close(); stores.delete(st);
      st = new nodeStore.Store(nc.dataDir); stores.add(st);
      client = new nodeEngine.Engine(nc, ch, st, np, opts);
    };
    await until(client, () => st.pending()?.kind === 'approve', 'Node must journal exact bond approval');
    const hash = st.pending().hash;
    restart(); await client.cycle();
    assert.equal(st.db.prepare('SELECT COUNT(*) n FROM txs WHERE hash=?').get(hash).n, 1);
    await until(client, () => st.pending()?.kind === 'vote', 'Node must sign a checked vote');
    restart(); await client.cycle();
    assert.equal(st.pending(), undefined);
    assert.equal(st.db.prepare("SELECT COUNT(*) n FROM txs WHERE kind='vote' AND status=1").get().n, 1);
    nodes.push({ get client() { return client; }, get store() { return st; }, restart, validator });
  }
  const snapshot = await chain.snapshot(id);
  assert.equal(snapshot.approvals, 3n); assert.equal(snapshot.disapprovals, 0n);
  assert.equal(snapshot.quorum, 3n);
  for (const wallet of [agent, ...validators]) {
    assert.equal(await token.allowance(wallet.address, addresses.AGIJobManager), 0n);
  }

  // Force every settlement payment into the contract's pull-payment ledger.
  await mined(token.setFailTransfers(true));
  await connection.provider.request({ method: 'evm_increaseTime', params: [8 * 86400] });
  await connection.provider.request({ method: 'evm_mine', params: [] });
  Date.now = () => snapshot.now * 1000 + 8 * 86400 * 1000 + 60000;
  await engine.cycle();
  assert.equal(store.pending().kind, 'finalize');
  const finalizationHash = store.pending().hash;
  restartAgent(); await engine.cycle();
  assert.equal((await manager.getJobCore(id)).completed, true);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM txs WHERE kind='finalize' AND status=1").get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM txs WHERE hash=?').get(finalizationHash).n, 1);
  const beneficiaries = [agent, ...validators, fee30, fee10];
  const deferred = await Promise.all(beneficiaries.map(wallet => manager.pendingUSDC(wallet.address)));
  assert.ok(deferred.every(amount => amount > 0n));
  assert.equal(deferred.reduce((sum, amount) => sum + amount, 0n), await token.balanceOf(addresses.AGIJobManager));
  await mined(token.setFailTransfers(false));

  await engine.cycle(); assert.equal(store.pending().kind, 'claim');
  restartAgent(); await engine.cycle();
  for (const node of nodes) {
    await node.client.cycle(); assert.equal(node.store.pending().kind, 'claim');
    node.restart(); await node.client.cycle();
    assert.equal(node.store.db.prepare("SELECT COUNT(*) n FROM txs WHERE kind='claim' AND status=1").get().n, 1);
    const count = node.store.db.prepare('SELECT COUNT(*) n FROM txs').get().n;
    await node.client.cycle();
    assert.equal(node.store.db.prepare('SELECT COUNT(*) n FROM txs').get().n, count);
    assert.equal((await node.client.exposure()).amount, 0n);
  }
  // Fee recipients are fixture signers, outside the Agent/Node autonomous clients.
  for (const wallet of [fee30, fee10]) await mined(manager.connect(wallet).claimUSDC(wallet.address));
  for (const wallet of beneficiaries) assert.equal(await manager.pendingUSDC(wallet.address), 0n);
  assert.equal(await token.balanceOf(addresses.AGIJobManager), 0n);
  assert.equal((await engine.exposure()).amount, 0n);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM txs WHERE kind='claim' AND status=1").get().n, 1);
  const count = store.db.prepare('SELECT COUNT(*) n FROM txs').get().n;
  await engine.cycle();
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM txs').get().n, count);
  const finalBalances = await Promise.all([buyer, ...beneficiaries].map(wallet => token.balanceOf(wallet.address)));
  assert.equal(finalBalances.reduce((sum, amount) => sum + amount, 0n), initial * 5n);
  assert.equal(await token.balanceOf(buyer.address), initial - payout);
  assert.ok(await token.balanceOf(agent.address) > initial);
  for (const validator of validators) assert.ok(await token.balanceOf(validator.address) > initial);
  assert.equal(generations, 1); assert.equal(publications, 1);

  const report = {
    schema: 'agi-fleet-job-lifecycle/v1', status: 'PASS', chainId: 31337,
    managerArtifacts: 'freshly compiled AGIJobManager source',
    ...(contractProfile ? { contractProfile: pin.contractProfile, contractProfileSHA256: pin.contractProfileSHA256 } : {}),
    linkedProductionContracts: Object.keys(pin.contracts).length,
    defaultVoteQuorum: 3, defaultReviewPeriodSeconds: 7 * 86400,
    agentGenerationCount: generations, publicationCount: publications,
    persistedAgentPreparationAndApproval: true, threePersistedNodeVotes: true,
    exactBondAllowancesConsumed: true, persistedFinalization: true,
    deferredClaimsConservedUSDC: true, persistedAgentAndNodeClaims: true,
    noDuplicateTransactionsAfterRestart: true, releasedAllClientExposure: true,
    managerTokenBalanceAfter: '0', conservedTotalMockUSDC: String(initial * 5n),
    limitations: {
      liveInference: false, publicIPFS: false, nativeUSDC: false,
      independentlyOperatedValidators: false, independentRPCBackends: false,
      realTimeEndurance: false, reviewWindow: 'eight simulated days',
      identities: 'fixture allowlist; ENS/Merkle covered in the separate identity script',
    },
  };
  fs.writeFileSync(reportArg, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
} finally {
  Date.now = realNow;
  for (const store of stores) store.close();
  if (dual) await dual.close();
  provider.destroy();
  await connection.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
