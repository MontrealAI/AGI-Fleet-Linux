import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault, sealBackup, openBackup } from "../src/control/vault.mjs";
import { Keychain, launchAgent } from "../src/control/os-integration.mjs";
const password = "Public fixture password only 2026!";
test("encrypted vault round trips, locks, rejects wrong password, tampering and unsafe KDF", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-vault-test-"));
  try {
    const v = new Vault(home);
    await assert.rejects(v.create("short"), /PASSWORD_LENGTH/);
    await v.create(password);
    v.set({
      rpcURL: "https://example.test/secret-fixture",
      privateKey: "fixture-not-a-real-key",
    });
    const key = v.key.toString("base64");
    assert.ok(!fs.readFileSync(v.file, "utf8").includes("secret-fixture"));
    v.lock();
    assert.throws(() => v.get("privateKey"), /NODE_LOCKED/);
    await assert.rejects(v.unlock("incorrect"), /PASSWORD_OR_FILE_INCORRECT/);
    await v.unlock(password);
    assert.equal(v.get("privateKey"), "fixture-not-a-real-key");
    v.lock();
    v.unlockKey(key);
    assert.equal(v.get("rpcURL"), "https://example.test/secret-fixture");
    v.lock();
    const original = JSON.parse(fs.readFileSync(v.file)),
      bad = structuredClone(original);
    bad.data = (bad.data[0] === "A" ? "B" : "A") + bad.data.slice(1);
    fs.writeFileSync(v.file, JSON.stringify(bad));
    await assert.rejects(v.unlock(password), /PASSWORD_OR_FILE_INCORRECT/);
    bad.N = 2 ** 30;
    fs.writeFileSync(v.file, JSON.stringify(bad));
    await assert.rejects(v.unlock(password), /ENCRYPTED_FILE_FORMAT/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test("backup uses authenticated independent encryption and rejects wrong-purpose envelopes", async () => {
  const value = { schema: 2, wallet: "fixture" },
    a = await sealBackup(value, password),
    b = await sealBackup(value, password);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.deepEqual(await openBackup(a, password), value);
  await assert.rejects(openBackup(a, "wrong"), /PASSWORD_OR_FILE_INCORRECT/);
  await assert.rejects(
    openBackup({ ...a, purpose: "agi-node-vault/v2" }, password),
    /ENCRYPTED_FILE_FORMAT/,
  );
});
test("macOS adapter keeps credentials out of argv and escapes launch-agent paths", async () => {
  const calls = [],
    key = Buffer.alloc(32, 9).toString("base64");
  const k = new Keychain(
    "/tmp/user folder",
    "darwin",
    async (executable, args, input) => {
      calls.push({ executable, args, input });
      return args[0] === "find-generic-password" ? key : "";
    },
  );
  await k.set(key);
  assert.equal(calls[0].args.join(" ").includes(key), false);
  assert.ok(calls[0].input.includes(key));
  assert.equal(await k.get(), key);
  await k.remove();
  const xml = launchAgent("/tmp/A&B<user>", "/tmp/node with space");
  assert.ok(xml.includes("A&amp;B&lt;user&gt;"));
  assert.ok(xml.includes("<string>/tmp/node with space</string>"));
  assert.ok(xml.includes("<key>RunAtLoad</key><true/>"));
  await assert.rejects(
    new Keychain("/tmp", "linux").set(key),
    /OS_CREDENTIAL_UNAVAILABLE/,
  );
});
