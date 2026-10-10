import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet } from "ethers";
import { Controller } from "../src/control/controller.mjs";
import { Store } from "../src/store.mjs";
import { binding, preparationBinding, DEFAULT } from "../src/config.mjs";
import { assertPrepared, normalizeWork, deliveryURI } from "../src/work.mjs";
import { DECLARATION } from "../src/review.mjs";
import { sampleSpec, goodDelivery } from "./fixtures.mjs";
import { atomicWrite } from "../src/util.mjs";
const password = "Fixture-only recovery password!";
async function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-budget-recovery-"));
  let c = new Controller(home);
  await c.createVault(password);
  await c.wallet("create");
  const recovery=await c.revealRecovery(password);
  c.confirmRecovery({token:recovery.token,answers:recovery.indices.map(i=>recovery.phrase.split(" ")[i]),passphrase:""});
  await c.saveConfig({
    chainId: 31337,
    manager: Wallet.createRandom().address,
    limits: { ...c.config.limits, maxFinalizeGas: 700000 },
  });
  atomicWrite(
    c.pinFile,
    JSON.stringify({
      fixture: true,
      chainId: 31337,
      manager: c.config.manager,
      token: Wallet.createRandom().address,
    }),
  );
  const s = new Store(c.config.dataDir),
    content = JSON.stringify(goodDelivery),
    old = binding(c.config, c.pin());
  for (const [id, status] of [
    ["1", "submitted"],
    ["2", "assigned"],
  ]) {
    s.putJob(id, {
      owned: 1,
      status,
      requested: status === "submitted" ? 1 : 0,
      bond: "1000000",
    });
    s.saveWork(id, {
      binding: old,
      spec_hash: "fixture",
      spec: normalizeWork(sampleSpec, DECLARATION),
      content,
      uri: deliveryURI(content),
      stage: "published",
      attempts: 2,
    });
  }
  s.saveWork("stale", { ...s.work("2"), binding: "other-authority" });
  s.reserve({
    hash: "fixture-confirmed-hash",
    raw: "fixture-only-signed-bytes",
    nonce: 0,
    kind: "submit",
    job: "1",
    gas_budget: "400000",
    created: Math.floor(Date.now() / 1000),
  });
  s.db.prepare("UPDATE txs SET state='confirmed',status=1 WHERE nonce=0").run();
  s.set("spendingClock", 12345);
  s.set("cursor", { number: 55, hash: "fixture-block" });
  const before = {
    jobs: s.db.prepare("SELECT * FROM jobs ORDER BY id").all(),
    work: s.db.prepare("SELECT * FROM work ORDER BY job").all(),
    txs: s.db.prepare("SELECT * FROM txs").all(),
  };
  s.close();
  atomicWrite(path.join(c.config.dataDir, "STOP"), "Fixture STOP must remain");
  atomicWrite(
    path.join(c.config.dataDir, "activation.json"),
    JSON.stringify({ binding: old, agent: c.config.agent }),
  );
  c.settings.backupSaved = true;
  c.saveState();
  return {
    get c() {
      return c;
    },
    home,
    before,
    async restart() {
      await c.close();
      c = new Controller(home);
      await c.unlock(password);
      return c;
    },
    async close() {
      await c.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
const request = { acknowledge: true, limits: { maxFinalizeGas: 2000000 } };
function checkPreserved(f) {
  const c = f.c,
    s = new Store(c.config.dataDir);
  try {
    assert.deepEqual(s.db.prepare("SELECT * FROM txs").all(), f.before.txs);
    assert.deepEqual(
      s.db.prepare("SELECT * FROM jobs ORDER BY id").all(),
      f.before.jobs,
    );
    const work = s.db.prepare("SELECT * FROM work ORDER BY job").all();
    for (let i = 0; i < work.length; i++) {
      const { binding: actual, ...rest } = work[i],
        { binding: prior, ...previous } = f.before.work[i];
      assert.deepEqual(rest, previous);
      assert.equal(
        actual,
        prior === "other-authority"
          ? prior
          : preparationBinding(c.config, c.pin()),
      );
    }
    assertPrepared(
      s.work("2"),
      preparationBinding(c.config, c.pin()),
      binding(c.config, c.pin()),
    );
    assert.throws(
      () =>
        assertPrepared(
          s.work("stale"),
          preparationBinding(c.config, c.pin()),
          binding(c.config, c.pin()),
        ),
      /PREPARED_WORK_REQUIRED/,
    );
    assert.equal(s.meta("spendingClock"), 12345);
    assert.deepEqual(s.meta("cursor"), { number: 55, hash: "fixture-block" });
    assert.equal(
      fs.readFileSync(path.join(c.config.dataDir, "STOP"), "utf8"),
      "Fixture STOP must remain",
    );
    assert.equal(
      fs.existsSync(path.join(c.config.dataDir, "activation.json")),
      false,
    );
    assert.equal(c.settings.backupSaved, false);
  } finally {
    s.close();
  }
}
test("active submitted and assigned jobs retain work and transaction history through narrow recovery and restart", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.c.saveConfig({
        limits: { ...f.c.config.limits, maxFinalizeGas: 2000000 },
      }),
      /ACTIVE_JOBS_MUST_FINISH/,
    );
    const beforeScope = f.c.operations.scope();
    const result = await f.c.saveSettlementBudget(request);
    assert.equal(result.recovery.reboundWorkRows, 2);
    assert.equal(result.recovery.state, "saved");
    assert.equal(f.c.config.limits.maxFinalizeGas, 2000000);
    assert.equal(f.c.config.limits.maxTxETH, "0.01");
    assert.equal(f.c.config.limits.maxBondUSDC, "25");
    assert.notEqual(f.c.operations.scope(), beforeScope);
    checkPreserved(f);
    await assert.rejects(f.c.activationChallenge(), /BACKUP_REQUIRED/);
    assert.equal(
      f.c.operations.evidenceReport().settlementBudgetRecovery.history.length,
      1,
    );
    await f.restart();
    checkPreserved(f);
    assert.equal(f.c.config.limits.maxFinalizeGas, 2000000);
  } finally {
    await f.close();
  }
});
test("recovery refuses pending transactions, running or locked state, missing acknowledgement and out-of-scope changes", async () => {
  const f = await fixture();
  try {
    for (const input of [
      { limits: { maxFinalizeGas: 2000000 } },
      { ...request, manager: Wallet.createRandom().address },
      { acknowledge: true, limits: { maxBondUSDC: "100" } },
      { acknowledge: true, limits: { maxTxGas: 2000000 } },
      { acknowledge: true, limits: { maxFinalizeGas: 2000001 } },
      { acknowledge: true, limits: { maxTxETH: "0" } },
    ])
      await assert.rejects(f.c.saveSettlementBudget(input));
    f.c.desired = true;
    await assert.rejects(f.c.saveSettlementBudget(request), /STOP_BEFORE/);
    f.c.desired = false;
    f.c.vault.lock();
    await assert.rejects(f.c.saveSettlementBudget(request), /NODE_LOCKED/);
    await f.c.unlock(password);
    const s = new Store(f.c.config.dataDir);
    s.reserve({
      hash: "pending-fixture",
      raw: "pending-fixture",
      nonce: 1,
      kind: "finalize",
      job: "1",
      gas_budget: "123",
      created: Math.floor(Date.now() / 1000),
    });
    s.close();
    await assert.rejects(
      f.c.saveSettlementBudget(request),
      /PENDING_TRANSACTION_MUST_BE_RECONCILED_FIRST/,
    );
    assert.equal(f.c.config.limits.maxFinalizeGas, 700000);
    assert.ok(fs.existsSync(path.join(f.c.config.dataDir, "activation.json")));
    assert.equal(f.c.budgetRecoveryReport().history.length, 0);
  } finally {
    await f.close();
  }
});
test("preparation scope ignores exactly the three recovery budgets and retains every other authority field", () => {
  const c = structuredClone(DEFAULT),
    pin = { fixture: 1 },
    old = preparationBinding(c, pin);
  for (const k of ["maxFinalizeGas", "maxTxETH", "maxGas24hETH"]) {
    const n = structuredClone(c);
    n.limits[k] = k === "maxFinalizeGas" ? 1500000 : "0.001";
    assert.equal(preparationBinding(n, pin), old);
    assert.notEqual(binding(n, pin), binding(c, pin));
  }
  for (const k of Object.keys(c.limits).filter(
    (k) => !["maxFinalizeGas", "maxTxETH", "maxGas24hETH"].includes(k),
  )) {
    const n = structuredClone(c);
    n.limits[k] = typeof n.limits[k] === "number" ? n.limits[k] + 1 : "2";
    assert.notEqual(preparationBinding(n, pin), old, k);
  }
  for (const [k, v] of Object.entries({
    manager: Wallet.createRandom().address,
    agent: Wallet.createRandom().address,
    chainId: 11155111,
    label: "changed",
    proof: ["0x" + "1".repeat(64)],
    trustedBuyers: [Wallet.createRandom().address],
    excludedParties: [Wallet.createRandom().address],
    autoFinalizeOwnJobs: false,
    execution: { ...c.execution, allowEnvelopes: true },
  }))
    assert.notEqual(preparationBinding({ ...c, [k]: v }, pin), old, k);
  assert.notEqual(preparationBinding(c, { fixture: 2 }), old);
});
test("interruption before config replacement leaves old budgets usable, migrated work intact and authority revoked", async () => {
  const f = await fixture(),
    rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {
      if (to === f.c.configFile)
        throw Error("FIXTURE_CONFIG_WRITE_INTERRUPTED");
      return rename(from, to);
    };
    await assert.rejects(
      f.c.saveSettlementBudget(request),
      /FIXTURE_CONFIG_WRITE_INTERRUPTED/,
    );
    fs.renameSync = rename;
    await f.restart();
    assert.equal(f.c.config.limits.maxFinalizeGas, 700000);
    checkPreserved(f);
    assert.equal(f.c.budgetRecoveryReport().history.at(-1).state, "prepared");
    await f.c.saveSettlementBudget(request);
    assert.equal(f.c.config.limits.maxFinalizeGas, 2000000);
    checkPreserved(f);
  } finally {
    fs.renameSync = rename;
    await f.close();
  }
});
test("interruption after durable config replacement cannot restore old live authority or lose prepared work", async () => {
  const f = await fixture(),
    set = Store.prototype.set;
  try {
    Store.prototype.set = function (k, v) {
      if (k === "settlementBudgetRecovery" && v.at(-1).state === "saved")
        throw Error("FIXTURE_AUDIT_INTERRUPTED");
      return set.call(this, k, v);
    };
    await assert.rejects(
      f.c.saveSettlementBudget(request),
      /FIXTURE_AUDIT_INTERRUPTED/,
    );
    Store.prototype.set = set;
    await f.restart();
    assert.equal(f.c.config.limits.maxFinalizeGas, 2000000);
    checkPreserved(f);
    const report = f.c.budgetRecoveryReport();
    assert.equal(report.history.at(-1).state, "prepared");
    assert.equal(report.history.at(-1).toBinding, report.currentBinding);
    await assert.rejects(f.c.activationChallenge(), /BACKUP_REQUIRED/);
  } finally {
    Store.prototype.set = set;
    await f.close();
  }
});
