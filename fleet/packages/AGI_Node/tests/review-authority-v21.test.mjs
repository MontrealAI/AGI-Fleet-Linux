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
test("enabling cloud review or changing authority cannot reuse a previously passing review for signing", async () => {
  for (const scenario of [
    "legacy",
    "different-binding",
    "missing-cloud-result",
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-review-binding-")),
      store = new Store(dir);
    const c = {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      dataDir: dir,
      manager: Wallet.createRandom().address,
      validator: Wallet.createRandom().address,
    };
    c.ai.cloudVeto = true;
    c.ai.cloudPublicOnly = true;
    const pin = {},
      now = Math.floor(Date.now() / 1000);
    const chain = {
      verify: async () => {},
      scan: async () => ({ caughtUp: true }),
      manager: { pendingUSDC: async () => 0n },
      token: { balanceOf: async () => 1000n, allowance: async () => 0n },
      snapshot: async () => ({
        context: "ctx",
        bond: 0n,
        payout: 1n,
        slash: 0n,
      }),
      eligible: () => null,
    };
    try {
      const result = { decision: "approve", context: "ctx", reviewedAt: now };
      if (scenario === "different-binding") result.reviewBinding = "old-policy";
      if (scenario === "missing-cloud-result")
        result.reviewBinding = binding(c, pin);
      store.putJob("1", {
        created_block: 1,
        requested: 1,
        status: "reviewed",
        next_review: now + 1000,
        review: encode(result),
      });
      atomicWrite(
        path.join(dir, "activation.json"),
        encode({ binding: binding(c, pin), validator: c.validator }),
      );
      const engine = new Engine(c, chain, store, pin, { live: true });
      engine.tx.send = async () => assert.fail("Stale review must never sign");
      await engine.cycle();
      assert.equal(store.job("1").status, "queued");
      assert.equal(store.job("1").next_review, 0);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
