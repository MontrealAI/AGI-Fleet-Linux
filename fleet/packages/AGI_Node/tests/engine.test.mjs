import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet } from "ethers";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
import { DEFAULT, binding } from "../src/config.mjs";
import { atomicWrite, encode } from "../src/util.mjs";
test("a pre-sign contract rejection defers that job without starving another opportunity", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-engine-")),
    store = new Store(dir),
    c = {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      dataDir: dir,
      manager: Wallet.createRandom().address,
      validator: Wallet.createRandom().address,
    },
    pin = {},
    now = Math.floor(Date.now() / 1000);
  const chain = {
    verify: async () => {},
    scan: async () => ({ caughtUp: true }),
    manager: { pendingUSDC: async () => 0n },
    token: { balanceOf: async () => 1000n, allowance: async () => 0n },
    snapshot: async (id) => ({
      id,
      context: "ctx",
      bond: 0n,
      payout: 1n,
      slash: 0n,
    }),
    eligible: () => null,
    voteRequest: (id, decision) => ({ id, decision }),
  };
  try {
    for (const id of ["1", "2"])
      store.putJob(id, {
        created_block: Number(id),
        requested: 1,
        status: "reviewed",
        next_review: now + 1000,
        review: encode({
          decision: "approve",
          context: "ctx",
          reviewedAt: now,
          reviewBinding: binding(c, pin),
        }),
      });
    atomicWrite(
      path.join(dir, "activation.json"),
      encode({ binding: binding(c, pin), validator: c.validator }),
    );
    const engine = new Engine(c, chain, store, pin, { live: true });
    engine.tx.send = async (_req, meta) => {
      if (meta.job === "1")
        throw Object.assign(new Error("contract says no"), {
          code: "CALL_EXCEPTION",
        });
      store.reserve({
        hash: "second",
        raw: "recorded",
        nonce: 0,
        kind: "vote",
        job: "2",
        decision: "approve",
        gas_budget: "1",
        created: now,
      });
    };
    await engine.cycle();
    assert.equal(store.job("1").reason, "CONTRACT_SIMULATION_REJECTED");
    assert.equal(store.pending().job, "2");
    assert.equal(store.meta("runtime").status, "vote-pending");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
