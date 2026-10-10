import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet, Interface, ZeroHash, parseUnits, Transaction } from "ethers";
import { Transactions } from "../src/transactions.mjs";
import { Store } from "../src/store.mjs";
import { DEFAULT } from "../src/config.mjs";
import { ABI } from "../src/chain.mjs";
import { atomicWrite, encode } from "../src/util.mjs";
async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-tx-")),
    store = new Store(dir),
    signer = Wallet.createRandom(),
    manager = Wallet.createRandom().address,
    token = Wallet.createRandom().address;
  const c = {
      ...structuredClone(DEFAULT),
      dataDir: dir,
      chainId: 31337,
      confirmations: 1,
      validator: signer.address,
      manager,
    },
    pin = { token };
  let broadcasts = 0;
  const provider = {
    getTransactionCount: async () => 0,
    getFeeData: async () => ({
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 100000000n,
    }),
    call: async () => {},
    estimateGas: async () => 100000n,
    getBalance: async () => parseUnits("1", 18),
    broadcastTransaction: async () => {
      broadcasts++;
      throw new Error("connection lost after broadcast");
    },
    getTransactionReceipt: async () => null,
    getBlock: async () => ({ hash: ZeroHash }),
  };
  const chain = {
    provider,
    iface: new Interface(ABI),
    verify: async () => {},
    head: async () => ({ number: 100 }),
    safeHeight: async () => 100,
    snapshot: async () => ({ context: "ctx" }),
    eligible: () => null,
  };
  const tx = new Transactions(c, chain, store, signer, pin, "binding");
  atomicWrite(
    path.join(dir, "activation.json"),
    encode({ binding: "binding", validator: signer.address }),
  );
  try {
    await fn({
      c,
      pin,
      chain,
      provider,
      tx,
      store,
      signer,
      broadcasts: () => broadcasts,
      dir,
    });
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("journal survives failed broadcast and retries exact same signed hash without duplicate nonce", () =>
  fixture(async ({ tx, store, broadcasts, provider }) => {
    const hash = await tx.send(tx.approveRequest(10n), {
      kind: "approve",
      bond: "10",
      context: "ctx",
    });
    assert.equal(broadcasts(), 1);
    assert.equal(store.pending().hash, hash);
    const raw = store.pending().raw;
    await assert.rejects(
      tx.send(tx.approveRequest(10n), { kind: "approve", bond: "10" }),
      /TRANSACTION_PENDING/,
    );
    await tx.recover();
    assert.equal(broadcasts(), 2);
    assert.equal(store.pending().raw, raw);
    provider.getTransactionReceipt = async () => ({
      blockNumber: 100,
      blockHash: ZeroHash,
      status: 1,
    });
    await tx.recover();
    assert.equal(store.pending(), undefined);
    assert.equal(broadcasts(), 2);
  }));
test("signer refuses native value, foreign target, over-limit allowance and arbitrary transfer", () =>
  fixture(async ({ tx, c, pin }) => {
    assert.throws(
      () =>
        tx.policy(
          { ...tx.approveRequest(1n), value: 1n },
          "approve",
          null,
          null,
          "1",
        ),
      /NATIVE_VALUE/,
    );
    assert.throws(
      () =>
        tx.policy(
          { ...tx.approveRequest(1n), to: c.manager },
          "approve",
          null,
          null,
          "1",
        ),
      /TOKEN_TARGET/,
    );
    assert.throws(
      () =>
        tx.policy(
          tx.approveRequest(parseUnits("26", 6)),
          "approve",
          null,
          null,
          parseUnits("26", 6),
        ),
      /BOND_LIMIT/,
    );
    const transfer = new Interface([
      "function transfer(address,uint256) returns(bool)",
    ]);
    assert.throws(() =>
      tx.policy(
        {
          to: pin.token,
          data: transfer.encodeFunctionData("transfer", [c.validator, 1]),
        },
        "approve",
        null,
        null,
        "1",
      ),
    );
  }));
test("daily gas, transaction and bond budgets bound authorization", () =>
  fixture(async ({ tx, store, c }) => {
    store.reserve({
      hash: "h",
      raw: "r",
      nonce: 0,
      kind: "vote",
      job: "1",
      bond: parseUnits("99", 6).toString(),
      gas_budget: parseUnits("0.029", 18).toString(),
      created: 100,
    });
    assert.throws(
      () => tx.budget(100, parseUnits("0.002", 18), "0", "claim"),
      /GAS_24H_LIMIT/,
    );
    assert.throws(
      () => tx.budget(100, 1n, parseUnits("2", 6), "vote"),
      /BOND_24H_LIMIT/,
    );
    c.limits.maxTransactions24h = 1;
    assert.throws(
      () => tx.budget(100, 1n, "0", "claim"),
      /TRANSACTION_24H_LIMIT/,
    );
  }));
test("external nonce, changed activation, stop file and pre-sign state changes prevent signing", () =>
  fixture(async ({ tx, provider, dir, store }) => {
    const req = tx.approveRequest(1n),
      meta = { kind: "approve", bond: "1" };
    provider.getTransactionCount = async (_a, tag) =>
      tag === "pending" ? 1 : 0;
    await assert.rejects(tx.send(req, meta), /EXTERNAL_PENDING_NONCE/);
    provider.getTransactionCount = async () => 0;
    atomicWrite(path.join(dir, "STOP"), "stop");
    await assert.rejects(tx.send(req, meta), /NODE_PAUSED/);
    fs.unlinkSync(path.join(dir, "STOP"));
    await assert.rejects(
      tx.send(req, {
        ...meta,
        beforeSign: async () => {
          throw new Error("changed");
        },
      }),
      /changed/,
    );
    assert.equal(store.pending(), undefined);
    atomicWrite(
      path.join(dir, "activation.json"),
      encode({ binding: "changed", validator: tx.c.validator }),
    );
    await assert.rejects(tx.send(req, meta), /ACTIVATION_SCOPE_CHANGED/);
  }));
test("nonce changes during simulation block signing", () =>
  fixture(async ({ tx, provider, store }) => {
    let calls = 0;
    provider.getTransactionCount = async () => (++calls <= 2 ? 0 : 1);
    await assert.rejects(
      tx.send(tx.approveRequest(1n), { kind: "approve", bond: "1" }),
      /NONCE_CHANGED_BEFORE_SIGNING/,
    );
    assert.equal(store.pending(), undefined);
  }));
test("pending vote context changes and unknown consumed nonces prevent rebroadcast", () =>
  fixture(async ({ tx, chain, provider, store, broadcasts, c }) => {
    const req = {
      to: c.manager,
      data: chain.iface.encodeFunctionData("validateJob", ["1", "", []]),
    };
    await tx.send(req, {
      kind: "vote",
      job: "1",
      decision: "approve",
      bond: "0",
      context: "ctx",
    });
    assert.equal(Transaction.from(store.pending().raw).value, 0n);
    chain.snapshot = async () => ({ context: "new" });
    await assert.rejects(tx.recover(), /PENDING_CONTEXT_CHANGED/);
    assert.equal(broadcasts(), 1);
    provider.getTransactionCount = async () => 1;
    await assert.rejects(tx.recover(), /NONCE_CONSUMED_WITHOUT_KNOWN_RECEIPT/);
  }));
test("receipt requires canonical block and finality; failed receipt pauses new signing", () =>
  fixture(async ({ tx, provider, chain, dir, store }) => {
    await tx.send(tx.approveRequest(0n), { kind: "approve", bond: "0" });
    provider.getTransactionReceipt = async () => ({
      blockNumber: 100,
      blockHash: ZeroHash,
      status: 0,
    });
    chain.safeHeight = async () => 99;
    await tx.recover();
    assert.ok(store.pending());
    chain.safeHeight = async () => 100;
    provider.getBlock = async () => ({ hash: "other" });
    await assert.rejects(tx.recover(), /TRANSACTION_REORG/);
    provider.getBlock = async () => ({ hash: ZeroHash });
    await tx.recover();
    assert.equal(store.pending(), undefined);
    assert.equal(fs.existsSync(path.join(dir, "STOP")), true);
  }));
test("confirmed external wallet use is rejected even when no transaction is pending", () =>
  fixture(async ({ tx, provider, store }) => {
    provider.getTransactionCount = async () => 1;
    await assert.rejects(
      tx.send(tx.approveRequest(0n), { kind: "approve", bond: "0" }),
      /EXTERNAL_NONCE_CHANGED/,
    );
    assert.equal(store.pending(), undefined);
  }));
test("backwards clock cannot silently reset spending limits", () =>
  fixture(async ({ tx }) => {
    tx.budget(10000, 0n, "0", "claim");
    assert.throws(
      () => tx.budget(9000, 0n, "0", "claim"),
      /SPENDING_CLOCK_CHANGED/,
    );
  }));
test("altered pending journal signature is not rebroadcast", () =>
  fixture(async ({ tx, store, broadcasts }) => {
    await tx.send(tx.approveRequest(0n), { kind: "approve", bond: "0" });
    store.db.prepare("UPDATE txs SET nonce=nonce+1").run();
    await assert.rejects(tx.recover(), /JOURNAL_SIGNATURE_MISMATCH/);
    assert.equal(broadcasts(), 1);
  }));
