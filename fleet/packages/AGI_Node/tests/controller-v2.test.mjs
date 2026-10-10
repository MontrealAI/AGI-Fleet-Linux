import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Controller } from "../src/control/controller.mjs";
import { Store } from "../src/store.mjs";
import { sealBackup, openBackup } from "../src/control/vault.mjs";
const password = "Fixture-only password for 2026!",
  manager = "0x" + "1".repeat(40),
  buyer = "0x" + "2".repeat(40);
function harness() {
  let nonce = 0,
    child;
  const connect = (c) => ({
    enroll: async () => ({
      chainId: c.chainId,
      manager: c.manager,
      contracts: {},
      token: "fixture",
    }),
    verify: async () => {},
    manager: {
      validatorCredential: async () => ["0x" + "1".repeat(64), buyer],
      blacklistedValidators: async () => false,
    },
    token: { balanceOf: async () => 100000000n, allowance: async () => 0n },
    provider: {
      destroy() {},
      getBalance: async () => 1000000000000000000n,
      getTransactionCount: async () => nonce,
      getTransactionReceipt: async () => null,
    },
  });
  const spawn = () => {
    child = new EventEmitter();
    Object.assign(child, {
      pid: 99999999,
      connected: true,
      send(m) {
        this.last = m;
        if (m.type === "stop") setImmediate(() => this.emit("exit", 0));
      },
      kill() {
        setImmediate(() => this.emit("exit", 1));
      },
    });
    return child;
  };
  return {
    options: {
      connect,
      spawn,
      keychain: { supported: false, remove: async () => {} },
    },
    nonce: (value) => (nonce = value),
    child: () => child,
  };
}
test("guided controller protects authority, backup, pause, reauthorization and recovery state", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-controller-test-")),
    restoredHome = fs.mkdtempSync(path.join(os.tmpdir(), "agi-restored-test-")),
    h = harness();
  const c = new Controller(home, h.options);
  let restored;
  try {
    await c.createVault(password);
    await c.saveRPC("https://rpc.example.test/PRIVATE_FIXTURE_TOKEN");
    await c.wallet("create");
    const recovery = await c.revealRecovery(password);
    c.confirmRecovery({token:recovery.token, answers:recovery.indices.map(i=>recovery.phrase.split(" ")[i])});
    const privateKey = c.vault.get("privateKey");
    await c.saveConfig({
      chainId: 31337,
      manager,
      trustedBuyers: [buyer],
      deploymentBlock: 10,
    });
    await c.enroll();
    await assert.rejects(c.activationChallenge(), /BACKUP_REQUIRED/);
    assert.throws(() => c.acknowledgeBackup(), /DOWNLOAD_BACKUP_FIRST/);
    const backup = await c.backup(password);
    await c.verifyBackup(backup,password);
    c.acknowledgeBackup();
    const status = JSON.stringify(c.status());
    assert.ok(!status.includes(privateKey));
    assert.ok(!status.includes("PRIVATE_FIXTURE_TOKEN"));
    h.nonce(5);
    await assert.rejects(
      c.activationChallenge(),
      /USED_WALLET_REQUIRES_HISTORY/,
    );
    h.nonce(0);
    const challenge = await c.activationChallenge();
    await assert.rejects(
      c.activate({
        id: challenge.id,
        acknowledgeRisk: true,
        independentReview: false,
      }),
      /ACTIVATION_ACKNOWLEDGEMENT/,
    );
    await c.activate({
      id: challenge.id,
      acknowledgeRisk: true,
      independentReview: true,
    });
    await c.start("live");
    assert.equal(h.child().last.privateKey, privateKey);
    h.child().emit("message", {
      type: "issue",
      code: "DEPLOYMENT_CODE_CHANGED",
    });
    assert.equal(c.health, null);
    await assert.rejects(c.saveConfig({ autoClaim: false }), /STOP_BEFORE/);
    c.pause();
    await c.stop();
    assert.equal(c.status().paused, true);
    await assert.rejects(c.start("live"), /NODE_PAUSED/);
    await c.resume();
    await c.start("observe");
    assert.equal("privateKey" in h.child().last, false);
    await c.stop();
    assert.equal(c.status().paused, false);
    await c.saveConfig({ autoClaim: false });
    assert.equal(
      fs.existsSync(path.join(c.config.dataDir, "activation.json")),
      false,
    );
    assert.equal(c.settings.backupSaved, false);
    restored = new Controller(restoredHome, h.options);
    await restored.restore(backup, password, true);
    assert.equal(restored.config.validator, c.config.validator);
    assert.equal(restored.vault.get("privateKey"), privateKey);
    assert.equal(restored.settings.restored, true);
    await assert.rejects(
      restored.activationChallenge(),
      /RESTORE_RECONCILIATION_REQUIRED/,
    );
    h.nonce(3);
    await assert.rejects(
      restored.reconcileRestore(),
      /RESTORE_RECONCILIATION_REQUIRED/,
    );
    h.nonce(0);
    await restored.reconcileRestore();
    assert.equal(restored.settings.restored, false);
    const original = fs.readFileSync(restored.configFile, "utf8");
    const invalid = await openBackup(backup, password);
    invalid.database = Buffer.from("corrupt database").toString("base64");
    await assert.rejects(
      restored.restore(await sealBackup(invalid, password), password, true),
      /BACKUP_DATABASE_FORMAT/,
    );
    assert.equal(fs.readFileSync(restored.configFile, "utf8"), original);
    await assert.rejects(
      restored.restore(backup, "wrong", true),
      /PASSWORD_OR_FILE_INCORRECT/,
    );
    assert.equal(fs.readFileSync(restored.configFile, "utf8"), original);
    const store = new Store(c.config.dataDir);
    store.putJob("9", { created_block: 20, requested: 1 });
    store.set("cursor", { number: 20, hash: "fixture" });
    store.close();
    await assert.rejects(
      c.saveConfig({ manager: buyer }),
      /NEW_DEPLOYMENT_REQUIRES_SEPARATE_WORKSPACE/,
    );
    await c.reindex();
    assert.equal(
      c.dbRead((db) => db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n),
      0,
    );
    await c.lock();
    assert.equal(c.vault.unlocked, false);
  } finally {
    await c.close();
    await restored?.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(restoredHome, { recursive: true, force: true });
  }
});
test("worker crashes back off and reach a circuit breaker without silent live reauthorization", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-supervisor-test-")),
    h = harness(),
    c = new Controller(home, h.options);
  try {
    await c.createVault(password);
    await c.saveRPC("https://rpc.example.test");
    await c.wallet("create");
    await c.saveConfig({ manager, trustedBuyers: [buyer] });
    await c.enroll();
    await c.start("observe");
    for (let i = 0; i < 5; i++) {
      h.child().emit("exit", 1);
      clearTimeout(c.restartTimer);
      if (i < 4) {
        assert.equal(c.desired, true);
        c.spawnWorker();
      }
    }
    assert.equal(c.desired, false);
    assert.equal(c.settings.incidents[0].code, "RESTART_LIMIT_REACHED");
    assert.equal(c.status().running, false);
    assert.equal(
      fs.existsSync(path.join(c.config.dataDir, "activation.json")),
      false,
    );
  } finally {
    await c.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test("interrupted restore marker prevents automatic startup into mixed state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-restore-marker-"));
  try {
    fs.writeFileSync(path.join(home, "restore-in-progress.json"), "{}");
    assert.throws(
      () => new Controller(home),
      /RESTORE_INTERRUPTED_RECOVERY_REQUIRED/,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
