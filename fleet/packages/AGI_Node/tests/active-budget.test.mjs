import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Controller } from "../src/control/controller.mjs";
import { Store } from "../src/store.mjs";
test("Node can change a reviewed job budget while stopped, but pending signed transactions block configuration changes", async () => {
  const home = fs.mkdtempSync(
      path.join(os.tmpdir(), "agi-node-active-budget-"),
    ),
    c = new Controller(home);
  try {
    await c.createVault("Fixture-only Node recovery password!");
    await c.wallet("create");
    const s = new Store(c.config.dataDir);
    s.putJob("1", { my_vote: 1, status: "voted", requested: 1 });
    s.close();
    await c.saveConfig({
      limits: { ...c.config.limits, maxFinalizeGas: 1700000 },
    });
    assert.equal(c.config.limits.maxFinalizeGas, 1700000);
    assert.equal(c.config.autoFinalizeOwnJobs, false);
    assert.equal(c.settings.backupSaved, false);
    const pending = new Store(c.config.dataDir);
    assert.equal(pending.job("1").my_vote, 1);
    pending.reserve({
      hash: "pending-fixture",
      raw: "fixture-only-signed-bytes",
      nonce: 0,
      kind: "vote",
      job: "1",
      gas_budget: "123",
      created: Math.floor(Date.now() / 1000),
    });
    pending.close();
    await assert.rejects(
      c.saveConfig({ limits: { ...c.config.limits, maxFinalizeGas: 2000000 } }),
      /PENDING_TRANSACTION_MUST_BE_RECONCILED_FIRST/,
    );
    assert.equal(c.config.limits.maxFinalizeGas, 1700000);
    const retained = new Store(c.config.dataDir);
    assert.equal(retained.pending().raw, "fixture-only-signed-bytes");
    retained.close();
  } finally {
    await c.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
