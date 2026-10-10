// Runs only an in-process chain (31337). Never uses AGI_NODE_RPC_URL or real keys.
import { dualFixture } from "./dual-rpc-fixture.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import {
  BrowserProvider,
  ContractFactory,
  HDNodeWallet,
  ZeroAddress,
  ZeroHash,
  parseUnits,
} from "ethers";
import { artifacts, Chain } from "../src/chain.mjs";
import { DEFAULT, validateConfig, binding } from "../src/config.mjs";
import { Store } from "../src/store.mjs";
import { Engine } from "../src/engine.mjs";
import { ContentReader, rawCID } from "../src/content.mjs";
import { DECLARATION } from "../src/review.mjs";
import { sampleSpec, goodDelivery } from "../src/demo.mjs";
import { atomicWrite, encode } from "../src/util.mjs";
const connection = await hre.network.connect("hardhat");
const provider = new BrowserProvider(connection.provider, undefined, {
  cacheTimeout: -1,
});
assert.equal(Number((await provider.getNetwork()).chainId), 31337);
const wallets = Array.from({ length: 7 }, (_, i) =>
  HDNodeWallet.fromPhrase(
    "test test test test test test test test test test test junk",
    undefined,
    `m/44'/60'/0'/0/${i}`,
  ).connect(provider),
);
const [owner, buyer, agent, validator, w30, w10, outsider] = wallets;
let store, dual;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-node-integration-"));
const mined = async (promise) => (await promise).wait();
try {
  const addresses = {};
  async function deploy(name, args = []) {
    const a =
      artifacts[name] ??
      JSON.parse(
        fs.readFileSync(
          new URL("../contract/artifacts/" + name + ".json", import.meta.url),
        ),
      );
    let bytecode = a.bytecode;
    for (const libs of Object.values(a.linkReferences))
      for (const [lib, refs] of Object.entries(libs)) {
        if (!addresses[lib]) await deploy(lib);
        for (const { start, length } of refs)
          bytecode =
            bytecode.slice(0, 2 + start * 2) +
            addresses[lib].slice(2).toLowerCase() +
            bytecode.slice(2 + (start + length) * 2);
      }
    const c = await new ContractFactory(a.abi, bytecode, owner).deploy(...args);
    await c.waitForDeployment();
    addresses[name] = await c.getAddress();
    return c;
  }
  const token = await deploy("FailingERC20");
  const manager = await deploy("AGIJobManager", [
    addresses.FailingERC20,
    "ipfs://",
    [ZeroAddress, ZeroAddress],
    [ZeroHash, ZeroHash, ZeroHash, ZeroHash],
    [ZeroHash, ZeroHash],
    [w30.address, w10.address],
  ]);
  const creation = (await manager.deploymentTransaction().wait()).blockNumber;
  await mined(manager.addAdditionalAgent(agent.address));
  await mined(manager.addAdditionalValidator(validator.address));
  await mined(manager.setMaxActiveJobsPerAgent(20));
  await mined(manager.unpauseIntake());
  for (const w of [buyer, agent, validator, outsider]) {
    await mined(token.mint(w.address, parseUnits("10000", 6)));
  }
  await mined(
    token
      .connect(agent)
      .approve(addresses.AGIJobManager, parseUnits("10000", 6)),
  );
  const evidence = new Map();
  function uri(value) {
    const bytes = Buffer.from(
        typeof value === "string" ? value : JSON.stringify(value),
      ),
      cid = rawCID(bytes);
    evidence.set(cid, bytes);
    return "ipfs://" + cid;
  }
  const specURI = uri(sampleSpec);
  async function job(
    delivery,
    {
      details = DECLARATION,
      spec = specURI,
      employer = buyer,
      payout = "100",
    } = {},
  ) {
    const id = (await manager.nextJobId()).toString();
    await mined(
      token
        .connect(employer)
        .approve(addresses.AGIJobManager, parseUnits(payout, 6)),
    );
    await mined(
      manager
        .connect(employer)
        .createJob(spec, parseUnits(payout, 6), 3600, details),
    );
    await mined(manager.connect(agent).applyForJob(id, "", []));
    await mined(
      manager
        .connect(agent)
        .requestJobCompletion(
          id,
          typeof delivery === "string" && delivery.startsWith("ipfs:")
            ? delivery
            : uri(delivery),
        ),
    );
    return id;
  }
  const good = await job(goodDelivery),
    bad = await job({ ...goodDelivery, priceUSDC: 999 }),
    unsupported = await job(goodDelivery, {
      details: "Please judge the writing creatively.",
    }),
    missing = await job("ipfs://" + rawCID(Buffer.from("not uploaded"))),
    untrusted = await job(goodDelivery, { employer: outsider });
  const c = validateConfig(
    {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      manager: addresses.AGIJobManager,
      validator: validator.address,
      deploymentBlock: creation,
      confirmations: 1,
      minReviewSeconds: 30,
      trustedBuyers: [buyer.address],
      dataDir: dir,
      keystore: path.join(dir, "unused.json"),
      pollSeconds: 1,
    },
    dir,
    { ready: true },
  );
  dual = await dualFixture(connection.provider, dir);
  const chain = new Chain(c, dual.provider),
    pin = await chain.enroll();
  assert.equal(Object.keys(pin.contracts).length, 9);
  const reader = new ContentReader(c, async (url) => {
    const cid = new URL(url).pathname.split("/")[2];
    if (!evidence.has(cid)) throw new Error("offline");
    return evidence.get(cid);
  });
  store = new Store(dir);
  let engine = new Engine(c, chain, store, pin, { reader });
  await engine.cycle();
  assert.equal(store.job(good).status, "reviewed");
  assert.equal(JSON.parse(store.job(good).review).decision, "approve");
  assert.equal(JSON.parse(store.job(bad).review).decision, "reject");
  assert.equal(store.job(unsupported).status, "unsupported");
  assert.equal(store.job(missing).status, "abstained");
  assert.equal(store.job(untrusted).reason, "BUYER_NOT_IN_REVIEW_SCOPE");
  assert.equal(store.pending(), undefined);
  console.log(
    "PASS observation: correct approvals/rejections, unsupported/unavailable/untrusted abstentions",
  );
  atomicWrite(
    path.join(dir, "activation.json"),
    encode({ binding: binding(c, pin), validator: validator.address }),
  );
  engine = new Engine(c, chain, store, pin, {
    reader,
    live: true,
    signer: validator,
  });
  await engine.cycle();
  assert.equal(store.pending().kind, "approve");
  const approvalHash = store.pending().hash;
  // Restart with a pending journal; receipt recovery must not generate another approval.
  store.close();
  store = new Store(dir);
  engine = new Engine(c, chain, store, pin, {
    reader,
    live: true,
    signer: validator,
  });
  await engine.cycle();
  assert.equal(store.pending(), undefined);
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) AS n FROM txs WHERE hash=?")
      .get(approvalHash).n,
    1,
  );
  await engine.cycle();
  assert.equal(store.pending().kind, "vote");
  await engine.cycle();
  assert.equal((await manager.getJobValidation(good)).validatorApprovals, 1n);
  assert.equal(
    await token.allowance(validator.address, addresses.AGIJobManager),
    0n,
  );
  assert.equal((await engine.exposure()).amount, parseUnits("15", 6));
  console.log(
    "PASS signed approval, persisted restart recovery, bonded approval, exact allowance consumed",
  );
  for (let i = 0; i < 4; i++) await engine.cycle();
  assert.equal((await manager.getJobValidation(bad)).validatorDisapprovals, 1n);
  assert.equal((await manager.getJobValidation(good)).validatorApprovals, 1n);
  assert.equal((await engine.exposure()).amount, parseUnits("30", 6));
  console.log("PASS autonomous rejection and no duplicate vote after restart");
  // Authoritative terminal settlement releases the approving validator bond/reward.
  await mined(token.setFailTransfers(true));
  await mined(manager.connect(buyer).acceptJob(good));
  assert.equal(
    await manager.pendingUSDC(validator.address),
    parseUnits("23", 6),
  );
  await mined(token.setFailTransfers(false));
  await engine.cycle();
  assert.equal(store.pending().kind, "claim");
  await engine.cycle();
  assert.equal(await manager.pendingUSDC(validator.address), 0n);
  assert.equal(store.job(good).status, "terminal");
  assert.equal((await engine.exposure()).amount, parseUnits("15", 6));
  console.log(
    "PASS failed USDC payout is reserved and autonomously claimed to the validator after recovery",
  );
  const over = await job(goodDelivery, { payout: "1000" });
  await engine.cycle();
  assert.equal(store.job(over).reason, "BOND_LIMIT");
  const pauseJob = await job(goodDelivery);
  await mined(manager.setSettlementPaused(true));
  await engine.cycle();
  assert.equal(store.job(pauseJob).reason, "SETTLEMENT_PAUSED");
  await mined(manager.setSettlementPaused(false));
  const snap = await chain.snapshot(pauseJob);
  assert.equal(
    chain.eligible({ ...snap, buyer: validator.address }),
    "CONFLICT_OF_INTEREST",
  );
  const tampered = structuredClone(pin);
  tampered.contracts.AGIJobManager.codeHash = ZeroHash;
  await assert.rejects(chain.verify(tampered), /DEPLOYMENT_CODE_CHANGED/);
  atomicWrite(path.join(dir, "STOP"), "test");
  await engine.cycle();
  assert.equal(store.meta("runtime").status, "paused");
  assert.equal(store.pending(), undefined);
  console.log(
    "PASS settlement releases exposure; bond, pause, conflict, code-integrity and stop gates",
  );
  fs.unlinkSync(path.join(dir, "STOP"));
  c.autoFinalizeOwnJobs = true;
  atomicWrite(
    path.join(dir, "activation.json"),
    encode({ binding: binding(c, pin), validator: validator.address }),
  );
  engine = new Engine(c, chain, store, pin, {
    reader,
    live: true,
    signer: validator,
  });
  const realNow = Date.now;
  await connection.provider.request({
    method: "evm_increaseTime",
    params: [8 * 86400],
  });
  await connection.provider.request({ method: "evm_mine", params: [] });
  const simulated = (await provider.getBlock("latest")).timestamp * 1000;
  Date.now = () => simulated;
  try {
    await engine.cycle();
    assert.equal(store.pending().kind, "finalize");
    await engine.cycle();
    const result = await manager.getJobCore(bad);
    assert.ok(result.completed || result.expired || result.disputed);
    console.log(
      "PASS optional autonomous permissionless finalization after the review deadline",
    );
  } finally {
    Date.now = realNow;
  }
  const csvSpec = {
    schema: "agi-node-job/v1",
    profile: "csv-table/v1",
    title: "Public rows",
    columns: [
      { name: "id", type: "string" },
      { name: "score", type: "number", min: 0, max: 10 },
    ],
    minRows: 1,
    maxRows: 5,
    uniqueBy: ["id"],
  };
  const schemaSpec = {
    schema: "agi-node-job/v1",
    profile: "json-schema-2020-12/v1",
    title: "Public JSON",
    acceptanceSchema: {
      type: "object",
      properties: { score: { type: "integer", minimum: 0, maximum: 10 } },
      required: ["score"],
      additionalProperties: false,
    },
  };
  const csvGood = await job("id,score\na,9\n", { spec: uri(csvSpec) }),
    schemaBad = await job({ score: 20 }, { spec: uri(schemaSpec) });
  engine = new Engine(c, chain, store, pin, { reader });
  const extendedNow = (await provider.getBlock("latest")).timestamp * 1000;
  Date.now = () => extendedNow;
  try {
    await engine.cycle();
  } finally {
    Date.now = realNow;
  }
  assert.equal(JSON.parse(store.job(csvGood).review).decision, "approve");
  assert.equal(JSON.parse(store.job(schemaBad).review).decision, "reject");
  console.log(
    "PASS v2 CSV and JSON Schema reviews against jobs on the actual manager",
  );
  console.log(
    "INTEGRATION PASSED: real AGIJobManager v1.1.0 + 8 linked libraries, isolated Hardhat chain.",
  );
} finally {
  store?.close();
  if (dual) await dual.close();
  provider.destroy();
  await connection.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
