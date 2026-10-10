// Runs only an in-process chain (31337). Never uses AGI_AGENT_RPC_URL or real keys.
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
import { sampleSpec, goodDelivery } from "./fixtures.mjs";
import { Publisher } from "../src/publisher.mjs";
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-agent-integration-"));
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
  await mined(manager.setVoteQuorum(1));
  await mined(manager.unpauseIntake());
  for (const w of [buyer, agent, validator, outsider]) {
    await mined(token.mint(w.address, parseUnits("10000", 6)));
  }

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
  async function job({
    employer = buyer,
    details = DECLARATION,
    spec = specURI,
    payout = "100",
  } = {}) {
    const id = String(await manager.nextJobId());
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
    return id;
  }
  const good = await job(),
    untrusted = await job({ employer: outsider }),
    unsupported = await job({
      details: "Subjective work with no supported acceptance terms",
    });
  const c = validateConfig(
    {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      manager: addresses.AGIJobManager,
      agent: agent.address,
      deploymentBlock: creation,
      confirmations: 1,
      trustedBuyers: [buyer.address],
      dataDir: dir,
      keystore: path.join(dir, "unused.json"),
      pollSeconds: 1,
      execution: {
        ...DEFAULT.execution,
        publicDataOnly: true,
        publicPublishing: true,
      },
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
    if (!evidence.has(cid)) throw Error("offline");
    return evidence.get(cid);
  });
  let aiCalls = 0,
    publishCalls = 0;
  const executor = async (kind) => {
    aiCalls++;
    return kind === "generate"
      ? { status: "complete", content: JSON.stringify(goodDelivery) }
      : { verdict: "pass" };
  };
  let revokeOnPublish = false;
  const publisher = {
    publish: async (content) => {
      publishCalls++;
      if(revokeOnPublish) await mined(manager.removeAdditionalAgent(agent.address));
      return uri(content);
    },
    verify: async (location, content) => {
      assert.deepEqual(
        (await reader.read(location)).bytes,
        Buffer.from(content),
      );
      return true;
    },
  };
  store = new Store(dir);
  let engine = new Engine(c, chain, store, pin, {
    reader,
    executor,
    publisher,
  });
  await engine.cycle();
  assert.equal(store.job(good).status, "supported");
  assert.equal(aiCalls, 0);
  assert.equal(publishCalls, 0);
  assert.equal(store.pending(), undefined);
  assert.equal(store.job(untrusted).reason, "BUYER_NOT_IN_SCOPE");
  assert.equal(store.job(unsupported).status, "unsupported");
  console.log(
    "PASS preview scans actual contract; no inference, publishing or signing; buyer and format gates",
  );
  store.db.prepare("UPDATE jobs SET next_review=0").run();
  atomicWrite(
    path.join(dir, "activation.json"),
    encode({ binding: binding(c, pin), agent: agent.address }),
  );
  const build = () =>
    new Engine(c, chain, store, pin, {
      reader,
      executor,
      publisher,
      live: true,
      signer: agent,
    });
  engine = build();
  await mined(manager.removeAdditionalAgent(agent.address));
  await engine.cycle();
  assert.equal(aiCalls,0); assert.equal(publishCalls,0); assert.equal(store.pending(),undefined);
  assert.equal(store.work(good).stage,"new");
  await mined(manager.addAdditionalAgent(agent.address));
  store.db.prepare("UPDATE jobs SET next_review=0").run();
  await engine.cycle();
  assert.equal(store.work(good).stage, "draft");
  assert.equal((await manager.getJobCore(good)).assignedAgent, ZeroAddress);
  store.close();
  store = new Store(dir);
  engine = build();
  await engine.cycle();
  assert.equal(store.work(good).stage, "checked");
  revokeOnPublish=true;
  await engine.cycle();
  assert.equal(store.work(good).stage, "published");
  assert.equal(store.pending(),undefined);
  assert.equal(await token.allowance(agent.address,addresses.AGIJobManager),0n);
  console.log("PASS revoked identity blocks preparation; revocation during publication prevents bond-approval signing");
  revokeOnPublish=false;
  await mined(manager.addAdditionalAgent(agent.address));
  store.db.prepare("UPDATE jobs SET next_review=0").run();
  await engine.cycle();
  assert.equal(store.work(good).stage, "published");
  assert.equal(store.pending().kind, "approve");
  const approval = store.pending().hash;
  store.close();
  store = new Store(dir);
  engine = build();
  await engine.cycle();
  assert.equal(store.pending(), undefined);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM txs WHERE hash=?").get(approval).n,
    1,
  );
  const expectedBond = (await chain.snapshot(good)).bond;
  await engine.cycle();
  assert.equal(store.pending().kind, "apply");
  await engine.cycle();
  assert.equal((await manager.getJobCore(good)).assignedAgent, agent.address);
  assert.equal(
    await token.allowance(agent.address, addresses.AGIJobManager),
    0n,
  );
  assert.equal((await manager.getJobBonds(good)).agentAmount, expectedBond);
  assert.equal(aiCalls, 2);
  assert.equal(publishCalls, 1);
  await engine.cycle();
  assert.equal(store.pending().kind, "submit");
  await engine.cycle();
  assert.equal(
    (await manager.getJobValidation(good)).completionRequested,
    true,
  );
  assert.equal(await manager.getJobCompletionURI(good), store.work(good).uri);
  assert.equal(store.job(good).status, "submitted");
  console.log(
    "PASS prepare, restart, formal checks, AI review, verified publication, exact bond approval, assignment and submission",
  );
  await engine.cycle();
  assert.equal(store.pending(), undefined);
  assert.equal(aiCalls, 2);
  await mined(token.setFailTransfers(true));
  await mined(manager.connect(buyer).acceptJob(good));
  assert.ok((await manager.pendingUSDC(agent.address)) > 0n);
  await mined(token.setFailTransfers(false));
  await engine.cycle();
  assert.equal(store.pending().kind, "claim");
  await engine.cycle();
  assert.equal(await manager.pendingUSDC(agent.address), 0n);
  assert.equal((await engine.exposure()).amount, 0n);
  console.log(
    "PASS buyer settlement releases bond; deferred payment automatically claimed; no retained agent exposure",
  );
  const lost = await job();
  await engine.cycle();
  await engine.cycle();
  await mined(manager.addAdditionalAgent(outsider.address));
  await mined(
    token
      .connect(outsider)
      .approve(addresses.AGIJobManager, parseUnits("100", 6)),
  );
  await mined(manager.connect(outsider).applyForJob(lost, "", []));
  await engine.cycle();
  assert.equal(store.job(lost).status, "lost");
  assert.equal(store.pending(), undefined);
  console.log(
    "PASS competing agent wins: no bond application or work submission to that job",
  );
  const limited = await job({ payout: "1000" });
  await engine.cycle();
  assert.equal(store.job(limited).reason, "BOND_LIMIT");
  const second = await job();
  await engine.cycle();
  atomicWrite(path.join(dir, "STOP"), "test");
  await engine.cycle();
  assert.equal(store.meta("runtime").status, "paused");
  assert.equal(store.pending(), undefined);
  fs.unlinkSync(path.join(dir, "STOP"));
  await engine.cycle();
  await engine.cycle();
  await engine.cycle();
  await engine.cycle();
  await engine.cycle();
  await engine.cycle();
  await engine.cycle();
  assert.equal(
    (await manager.getJobValidation(second)).completionRequested,
    true,
  );
  const before = aiCalls;
  await engine.cycle();
  assert.equal(aiCalls, before);
  await mined(
    token
      .connect(validator)
      .approve(addresses.AGIJobManager, parseUnits("100", 6)),
  );
  await mined(manager.connect(validator).validateJob(second, "", []));
  await connection.provider.request({
    method: "evm_increaseTime",
    params: [8 * 86400],
  });
  await connection.provider.request({ method: "evm_mine", params: [] });
  const realNow = Date.now;
  const simulated = (await provider.getBlock("latest")).timestamp * 1000;
  Date.now = () => simulated;
  try {
    await engine.cycle();
    assert.equal(store.pending().kind, "finalize");
    await engine.cycle();
    assert.equal((await manager.getJobCore(second)).completed, true);
  } finally {
    Date.now = realNow;
  }
  console.log(
    "PASS limits, pause, no duplicate work, and favorable-vote finalization after the actual contract deadline",
  );
  const wrong = structuredClone(pin);
  wrong.contracts.AGIJobManager.codeHash = ZeroHash;
  Date.now = () => simulated;
  try {
    await assert.rejects(chain.verify(wrong), /DEPLOYMENT_CODE_CHANGED/);
  } finally {
    Date.now = realNow;
  }
  console.log(
    "INTEGRATION PASSED: AGI Agent against exact AGIJobManager v1.1.0 and eight linked libraries, isolated Hardhat chain. AI and publication mocked; no live account or public upload.",
  );
} finally {
  store?.close();
  if (dual) await dual.close();
  provider.destroy();
  await connection.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
