// Isolated chain 31337 only. Synthetic public jobs/identities; no real inference.
// Setup transactions are fixture-created and recorded from actual signed bytes;
// finalization uses the unmodified application policy, signer and durable journal.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import {
  BrowserProvider,
  ContractFactory,
  HDNodeWallet,
  Transaction,
  ZeroAddress,
  ZeroHash,
  parseUnits,
} from "ethers";
import { artifacts, Chain } from "../src/chain.mjs";
import { DEFAULT, validateConfig, binding } from "../src/config.mjs";
import { Store } from "../src/store.mjs";
import { Transactions } from "../src/transactions.mjs";
import { atomicWrite, encode } from "../src/util.mjs";
import { dualFixture } from "./dual-rpc-fixture.mjs";
const connection = await hre.network.connect("hardhat");
const provider = new BrowserProvider(connection.provider, undefined, {
  cacheTimeout: -1,
});
assert.equal(Number((await provider.getNetwork()).chainId), 31337);
const dir = fs.mkdtempSync(
  path.join(os.tmpdir(), "agi-finalization-integration-"),
);
const wallets = Array.from({ length: 12 }, (_, i) =>
  HDNodeWallet.fromPhrase(
    "test test test test test test test test test test test junk",
    undefined,
    `m/44'/60'/0'/0/${i}`,
  ).connect(provider),
);
const [owner, buyer, agent, ...rest] = wallets,
  validators = rest.slice(0, 7),
  w30 = wallets[10],
  w10 = wallets[11];
const role = "agent" in DEFAULT ? "agent" : "node",
  walletKey = role === "agent" ? "agent" : "validator",
  actor = role === "agent" ? agent : validators[0];
const store = new Store(dir);
let dual;
const realNow = Date.now;
async function mined(promise) {
  const transaction = await promise,
    receipt = await transaction.wait();
  if (transaction.from.toLowerCase() === actor.address.toLowerCase()) {
    const raw = Transaction.from(transaction).serialized;
    store.reserve({
      hash: transaction.hash,
      raw,
      nonce: transaction.nonce,
      kind: "fixture-setup",
      gas_budget: String(
        transaction.gasLimit *
          (transaction.maxFeePerGas ?? transaction.gasPrice),
      ),
      created: Math.floor(Date.now() / 1000),
    });
    store.markReceipt(transaction.hash, receipt, Math.floor(Date.now() / 1000));
  }
  return receipt;
}
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
  const token = await deploy("MockERC20");
  const manager = await deploy("AGIJobManager", [
    addresses.MockERC20,
    "ipfs://",
    [ZeroAddress, ZeroAddress],
    [ZeroHash, ZeroHash, ZeroHash, ZeroHash],
    [ZeroHash, ZeroHash],
    [w30.address, w10.address],
  ]);
  const creation = (await manager.deploymentTransaction().wait()).blockNumber;
  assert.equal(await manager.voteQuorum(), 3n);
  await mined(manager.addAdditionalAgent(agent.address));
  for (const w of validators)
    await mined(manager.addAdditionalValidator(w.address));
  await mined(manager.unpauseIntake());
  for (const w of [buyer, agent, ...validators])
    await mined(token.mint(w.address, parseUnits("10000", 6)));
  let c = validateConfig(
    {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      manager: addresses.AGIJobManager,
      [walletKey]: actor.address,
      deploymentBlock: creation,
      confirmations: 1,
      dataDir: dir,
      trustedBuyers: [buyer.address],
      autoFinalizeOwnJobs: true,
    },
    dir,
  );
  dual = await dualFixture(connection.provider, dir);
  const chain = new Chain(c, dual.provider),
    pin = await chain.enroll();
  assert.equal(Object.keys(pin.contracts).length, 9);
  let signatures = 0;
  const signer = {
    getAddress: async () => actor.address,
    signTransaction: async (tx) => {
      signatures++;
      return actor.signTransaction(tx);
    },
  };
  function transactionLayer(limits) {
    const cfg = { ...c, limits: { ...c.limits, ...limits } };
    atomicWrite(
      path.join(dir, "activation.json"),
      encode({ binding: binding(cfg, pin), [walletKey]: actor.address }),
    );
    return new Transactions(cfg, chain, store, signer, pin, binding(cfg, pin));
  }
  const results = [];
  for (const count of [3, 7]) {
    const id = String(await manager.nextJobId());
    await mined(
      token
        .connect(buyer)
        .approve(addresses.AGIJobManager, parseUnits("100", 6)),
    );
    await mined(
      manager
        .connect(buyer)
        .createJob(
          "ipfs://fixture-spec",
          parseUnits("100", 6),
          3600,
          "Synthetic contract settlement fixture; no content validation claim.",
        ),
    );
    await mined(
      token
        .connect(agent)
        .approve(addresses.AGIJobManager, parseUnits("100", 6)),
    );
    await mined(manager.connect(agent).applyForJob(id, "", []));
    await mined(
      manager
        .connect(agent)
        .requestJobCompletion(id, "ipfs://fixture-delivery"),
    );
    for (const w of validators.slice(0, count)) {
      await mined(
        token.connect(w).approve(addresses.AGIJobManager, parseUnits("100", 6)),
      );
      await mined(manager.connect(w).validateJob(id, "", []));
    }
    store.putJob(
      id,
      role === "agent"
        ? { owned: 1, status: "submitted" }
        : { my_vote: 1, status: "voted" },
    );
    await connection.provider.request({
      method: "evm_increaseTime",
      params: [8 * 86400],
    });
    await connection.provider.request({ method: "evm_mine", params: [] });
    const simulated = (await provider.getBlock("latest")).timestamp * 1000;
    Date.now = () => simulated;
    const request = {
      to: addresses.AGIJobManager,
      data: chain.iface.encodeFunctionData("finalizeJob", [id]),
    };
    const estimate = await dual.provider.estimateGas({
        ...request,
        from: actor.address,
        value: 0n,
      }),
      margin = (estimate * 120n + 99n) / 100n;
    assert.ok(margin > 700000n, "fixture must reproduce old ceiling");
    assert.ok(margin <= BigInt(DEFAULT.limits.maxFinalizeGas));
    const previousSignatures = signatures;
    await assert.rejects(
      transactionLayer({ maxFinalizeGas: 700000 }).send(request, {
        kind: "finalize",
        job: id,
      }),
      /FINALIZATION_GAS_UNITS_LIMIT/,
    );
    await assert.rejects(
      transactionLayer({ maxTxETH: "0.000000001" }).send(request, {
        kind: "finalize",
        job: id,
      }),
      /TRANSACTION_COST_LIMIT/,
    );
    assert.equal(signatures, previousSignatures);
    assert.equal(store.pending(), undefined);
    const before = await token.balanceOf(actor.address),
      tx = transactionLayer({});
    const hash = await tx.send(request, {
      kind: "finalize",
      job: id,
      beforeSign: async () => {
        const s = await chain.snapshot(id);
        assert.equal(s.completed, false);
        assert.ok(s.approvals >= 3n);
        assert.ok(BigInt(s.now) > s.settlementAfter);
      },
    });
    assert.equal(signatures, previousSignatures + 1);
    const pending = store.pending();
    assert.equal(pending.hash, hash);
    const decoded = Transaction.from(pending.raw);
    assert.equal(decoded.hash, hash);
    assert.equal(decoded.gasLimit, margin);
    await tx.recover();
    assert.equal(store.pending(), undefined);
    const receipt = await dual.provider.getTransactionReceipt(hash);
    assert.equal(receipt.status, 1);
    assert.equal((await manager.getJobCore(id)).completed, true);
    assert.ok(
      (await token.balanceOf(actor.address)) > before,
      "actual local token receipt and bond release",
    );
    assert.equal(
      await token.balanceOf(addresses.AGIJobManager),
      0n,
      "settled fixture leaves no manager token balance",
    );
    results.push({
      validators: count,
      estimate: String(estimate),
      with20PercentMargin: String(margin),
      gasUsed: String(receipt.gasUsed),
      hash,
      oldLimitBlockedWithoutSigning: true,
      ETHCapStillEnforced: true,
      applicationSignatureJournalAndRecovery: true,
      managerTokenBalanceAfter: "0",
    });
    Date.now = realNow;
  }
  console.log(
    JSON.stringify(
      {
        role,
        runtime: process.version,
        chainId: 31337,
        manager: "v1.1.0",
        quorum: 3,
        results,
        limitations:
          "Synthetic identities and mock ERC20 on one in-process chain behind two transports. Setup/votes are fixture-created and accurately journaled; finalization uses the application transaction layer. No real independent operators, native USDC, public RPC, model, IPFS or mainnet capacity qualification.",
      },
      null,
      2,
    ),
  );
} finally {
  Date.now = realNow;
  store.close();
  if (dual) await dual.close();
  provider.destroy();
  await connection.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
