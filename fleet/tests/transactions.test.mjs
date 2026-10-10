import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Wallet, Interface } from "ethers";
import { Store } from "../ops/store.mjs";
import { Transactions } from "../ops/transactions.mjs";
import { Engine } from "../ops/engine.mjs";
import { requestFor } from "../ops/policy.mjs";
import { binding } from "../ops/config.mjs";
import { now } from "../ops/common.mjs";
import { config, temp, addr } from "./helpers.mjs";

function fixture(patch = {}) {
  const home = temp(),
    store = new Store(home),
    wallet = Wallet.createRandom();
  const c = config("recovery", {
    wallet: wallet.address,
    claimBeneficiaries: [addr(1)],
  });
  let broadcasts = 0,
    verifications = 0,
    signatures = 0;
  const provider = {
    getTransactionCount: async () => 0,
    getFeeData: async () => ({
      maxFeePerGas: 100000000n,
      maxPriorityFeePerGas: 10000000n,
    }),
    call: async () => "0x",
    estimateGas: async () => 21000n,
    getBalance: async () => 10n ** 18n,
    getTransactionReceipt: async () => null,
    broadcastTransaction: async () => {
      broadcasts++;
      throw Error("uncertain transport");
    },
    ...patch,
  };
  const chain = {
    c,
    provider,
    iface: new Interface([
      "function refundUnresolvedDispute(uint256)",
      "function claimUSDC(address)",
    ]),
    verify: async () => {
      verifications++;
    },
    manager: {
      pendingUSDC: async () => 100n,
      settlementPaused: async () => false,
    },
  };
  const pin = { token: addr(20) },
    bound = binding(c, pin);
  store.set("initialNonce", 0);
  store.set("activation", {
    binding: bound,
    wallet: c.wallet,
    expires: now() + 3600,
  });
  const signer = {
    getAddress: async () => wallet.address,
    signTransaction: async (t) => {
      signatures++;
      return wallet.signTransaction(t);
    },
  };
  const tx = new Transactions(c, chain, store, pin, signer, bound),
    action = { action: "refund", job: "1" },
    request = requestFor(chain, pin, action);
  return {
    home,
    store,
    c,
    chain,
    pin,
    tx,
    action,
    request,
    counts: () => ({ broadcasts, verifications, signatures }),
    cleanup() {
      store.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test("uncertain broadcast is journaled first; observation and STOP never rebroadcast", async () => {
  const f = fixture();
  try {
    await f.tx.send(f.request, f.action, { beforeSign: async () => {} });
    assert.equal(f.counts().broadcasts, 1);
    assert.ok(f.store.pending().raw.startsWith("0x"));
    await f.tx.recover();
    assert.equal(f.counts().broadcasts, 1);
    fs.writeFileSync(path.join(f.home, "STOP"), "operator pause");
    await f.tx.recover({ rebroadcast: true });
    assert.equal(f.counts().broadcasts, 1);
    fs.unlinkSync(path.join(f.home, "STOP"));
    await f.tx.recover({ rebroadcast: true });
    assert.equal(f.counts().broadcasts, 2);
    assert.equal(f.counts().signatures, 1);
  } finally {
    f.cleanup();
  }
});

test("unexpected wallet use and daily budgets prevent signing", async () => {
  const a = fixture({
    getTransactionCount: async (_, tag) => (tag === "pending" ? 1 : 0),
  });
  try {
    await assert.rejects(
      a.tx.send(a.request, a.action, { beforeSign: async () => {} }),
      /EXTERNAL_PENDING_NONCE/,
    );
    assert.equal(a.counts().signatures, 0);
  } finally {
    a.cleanup();
  }
  const b = fixture();
  try {
    b.c.limits.maxGas24hETH = "0";
    await assert.rejects(
      b.tx.send(b.request, b.action, { beforeSign: async () => {} }),
      /GAS_DAILY_LIMIT/,
    );
    assert.equal(b.counts().signatures, 0);
  } finally {
    b.cleanup();
  }
});

test("policy drift after gas estimation prevents signing", async () => {
  const f = fixture();
  let n = 0;
  f.chain.verify = async () => {
    if (++n === 2) throw Error("POLICY_CHANGED");
  };
  try {
    await assert.rejects(
      f.tx.send(f.request, f.action, { beforeSign: async () => {} }),
      /POLICY_CHANGED/,
    );
    assert.equal(f.counts().signatures, 0);
    assert.equal(f.store.pending(), undefined);
  } finally {
    f.cleanup();
  }
});

test("confirmed receipt must match canonical block before journal confirmation", async () => {
  const f = fixture();
  try {
    await f.tx.send(f.request, f.action, { beforeSign: async () => {} });
    f.chain.provider.getTransactionReceipt = async () => ({
      blockNumber: 5,
      blockHash: "A",
      status: 1,
    });
    f.chain.head = async () => 10;
    f.chain.safeHeight = async () => 9;
    f.chain.provider.getBlock = async () => ({ hash: "B" });
    await assert.rejects(f.tx.recover(), /TRANSACTION_REORG/);
    assert.equal(f.store.pending().status, "pending");
  } finally {
    f.cleanup();
  }
});

test("RPC outage does not consume claim attempts; real call rejection does", async () => {
  const f = fixture();
  try {
    const engine = new Engine(f.c, f.chain, f.store, f.pin, {
      signer: null,
      reader: {},
    });
    f.chain.provider.call = async () => {
      throw Object.assign(Error("network"), { code: "NETWORK_ERROR" });
    };
    await assert.rejects(engine.claims(true), /network/);
    assert.equal(
      f.store.db.prepare("SELECT attempts FROM claims").get().attempts,
      0,
    );
    f.chain.provider.call = async () => {
      throw Object.assign(Error("execution rejected"), {
        code: "CALL_EXCEPTION",
      });
    };
    await engine.claims(true);
    assert.equal(
      f.store.db.prepare("SELECT attempts FROM claims").get().attempts,
      1,
    );
  } finally {
    f.cleanup();
  }
});

test("settlement pause and concurrent payment preserve claim retries", async () => {
  const f = fixture();
  try {
    const engine = new Engine(f.c, f.chain, f.store, f.pin, { reader: {} });
    let paused = true,
      calls = 0,
      amount = 100n;
    f.chain.manager.settlementPaused = async () => paused;
    f.chain.manager.pendingUSDC = async () => amount;
    f.chain.provider.call = async () => {
      calls++;
      if (calls === 1) paused = true;
      else amount = 0n;
      throw Object.assign(Error("rejected"), { code: "CALL_EXCEPTION" });
    };
    await engine.claims(true);
    assert.equal(calls, 0);
    paused = false;
    await engine.claims(true);
    assert.equal(calls, 1);
    assert.equal(
      f.store.db.prepare("SELECT attempts FROM claims").get().attempts,
      0,
    );
    paused = false;
    await engine.claims(true);
    const row = f.store.db.prepare("SELECT * FROM claims").get();
    assert.equal(row.attempts, 0);
    assert.equal(row.status, "paid");
    assert.equal(row.amount, "0");
  } finally {
    f.cleanup();
  }
});

test("stop during the final nonce check prevents signing", async () => {
  const f = fixture();
  try {
    let reads = 0;
    f.chain.provider.getTransactionCount = async () => {
      if (++reads === 4) f.tx.halted = true;
      return 0;
    };
    await assert.rejects(
      f.tx.send(f.request, f.action, { beforeSign: async () => {} }),
      /SERVICE_STOPPING/,
    );
    assert.equal(f.counts().signatures, 0);
    assert.equal(f.counts().broadcasts, 0);
    assert.equal(f.store.pending(), undefined);
  } finally {
    f.cleanup();
  }
});

test("stop during a pending transaction preflight prevents rebroadcast", async () => {
  const f = fixture();
  try {
    await f.tx.send(f.request, f.action, { beforeSign: async () => {} });
    f.chain.provider.call = async () => {
      f.tx.halted = true;
      return "0x";
    };
    await assert.rejects(
      f.tx.recover({ rebroadcast: true }),
      /SERVICE_STOPPING/,
    );
    assert.equal(f.counts().broadcasts, 1);
    assert.equal(f.counts().signatures, 1);
    assert.ok(f.store.pending());
  } finally {
    f.cleanup();
  }
});

test("delayed mining keeps pending costs reserved and renews the finality budget window", () => {
  const f = fixture();
  try {
    const created = now() - 2 * 86400;
    f.store.reserve({
      hash: "delayed",
      raw: "signed",
      nonce: 0,
      action: "refund",
      gas_budget: "100",
      created,
      binding: "test",
    });
    assert.equal(f.store.recent().length, 1);
    f.store.receipt("delayed", {
      status: 1,
      blockNumber: 3,
      blockHash: "block",
      gasUsed: 1n,
    });
    assert.equal(f.store.recent().length, 1);
    const row = f.store.db.prepare("SELECT created,accounted FROM txs").get();
    assert.equal(row.created, created);
    assert.ok(row.accounted >= now() - 1);
    f.c.limits.maxTransactions24h = 1;
    assert.throws(
      () => f.tx.budget(1n, 0n, "refund"),
      /TRANSACTION_DAILY_LIMIT/,
    );
    assert.equal(f.store.recent(now() + 86402).length, 0);
  } finally {
    f.cleanup();
  }
});
