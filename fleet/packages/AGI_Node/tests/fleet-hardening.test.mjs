import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet, Interface, ZeroHash } from "ethers";
import { DEFAULT, binding } from "../src/config.mjs";
import { ABI } from "../src/chain.mjs";
import { Store } from "../src/store.mjs";
import { Transactions } from "../src/transactions.mjs";
const key = "agent" in DEFAULT ? "agent" : "validator";
async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-fleet-finance-")),
    store = new Store(dir),
    wallet = Wallet.createRandom();
  const c = {
      ...structuredClone(DEFAULT),
      dataDir: dir,
      chainId: 31337,
      confirmations: 1,
      [key]: wallet.address,
      manager: Wallet.createRandom().address,
    },
    pin = { token: Wallet.createRandom().address };
  let signs = 0,
    broadcasts = 0;
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
    getBlock: async () => ({ hash: ZeroHash }),
    broadcastTransaction: async () => {
      broadcasts++;
      throw Error("uncertain");
    },
  };
  const signer = {
    getAddress: async () => wallet.address,
    signTransaction: async (t) => {
      signs++;
      return wallet.signTransaction(t);
    },
  };
  const chain = {
    provider,
    iface: new Interface(ABI),
    verify: async () => {},
    head: async () => ({ number: 100 }),
    safeHeight: async () => 100,
  };
  const tx = new Transactions(c, chain, store, signer, pin, binding(c, pin));
  fs.writeFileSync(
    path.join(dir, "activation.json"),
    JSON.stringify({ binding: binding(c, pin), [key]: wallet.address }),
  );
  const send = () =>
    tx.send(tx.approveRequest(0n), { kind: "approve", bond: "0" });
  try {
    await fn({
      dir,
      store,
      tx,
      provider,
      signer,
      wallet,
      send,
      counts: () => ({ signs, broadcasts }),
    });
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("a pause arriving during the last nonce read prevents signing", () =>
  fixture(async (f) => {
    let reads = 0;
    f.provider.getTransactionCount = async () => {
      if (++reads === 4) fs.writeFileSync(path.join(f.dir, "STOP"), "pause");
      return 0;
    };
    await assert.rejects(f.send(), /NODE_PAUSED/);
    assert.deepEqual(f.counts(), { signs: 0, broadcasts: 0 });
    assert.equal(f.store.pending(), undefined);
  }));
test("a stop arriving during signing prevents journaling and broadcast", () =>
  fixture(async (f) => {
    f.signer.signTransaction = async (t) => {
      const raw = await f.wallet.signTransaction(t);
      f.tx.halted = true;
      return raw;
    };
    await assert.rejects(f.send(), /SERVICE_STOPPING/);
    assert.equal(f.counts().broadcasts, 0);
    assert.equal(f.store.pending(), undefined);
  }));
test("a pause arriving during rebroadcast preflight retains the original pending transaction", () =>
  fixture(async (f) => {
    await f.send();
    const hash = f.store.pending().hash;
    f.provider.call = async () => {
      fs.writeFileSync(path.join(f.dir, "STOP"), "pause");
      return "0x";
    };
    await assert.rejects(f.tx.recover(), /NODE_PAUSED/);
    assert.equal(f.counts().broadcasts, 1);
    assert.equal(f.store.pending().hash, hash);
  }));
test("a newly reverting pending transaction is not rebroadcast", () =>
  fixture(async (f) => {
    await f.send();
    f.provider.call = async () => {
      throw Object.assign(Error("preflight rejected"), {
        code: "CALL_EXCEPTION",
      });
    };
    await assert.rejects(f.tx.recover(), /preflight rejected/);
    assert.equal(f.counts().broadcasts, 1);
    assert.ok(f.store.pending());
  }));
test("observation reconciles a canonical receipt without activation or rebroadcast", () =>
  fixture(async (f) => {
    await f.send();
    fs.unlinkSync(path.join(f.dir, "activation.json"));
    await f.tx.recover({ rebroadcast: false });
    assert.equal(f.counts().broadcasts, 1);
    assert.ok(f.store.pending());
    f.provider.getTransactionReceipt = async () => ({
      blockNumber: 100,
      blockHash: ZeroHash,
      status: 1,
    });
    await f.tx.recover({ rebroadcast: false });
    assert.equal(f.store.pending(), undefined);
    assert.equal(f.counts().broadcasts, 1);
  }));
