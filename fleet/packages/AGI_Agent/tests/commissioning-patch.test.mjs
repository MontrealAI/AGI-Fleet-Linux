import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet, Interface } from "ethers";
import { DEFAULT, validateConfig, binding } from "../src/config.mjs";
import { ABI } from "../src/chain.mjs";
import { Store } from "../src/store.mjs";
import { Transactions } from "../src/transactions.mjs";
import { Controller } from "../src/control/controller.mjs";
import { Operations } from "../src/control/operations.mjs";
import { atomicWrite, encode } from "../src/util.mjs";
const role = "agent" in DEFAULT ? "agent" : "node";
const walletKey = role === "agent" ? "agent" : "validator";
test("old configurations retain their gas authority; malformed finalization limits fail closed", () => {
  const old = structuredClone(DEFAULT);
  delete old.limits.maxFinalizeGas;
  old.limits.maxTxGas = 432100;
  const c = validateConfig(old);
  assert.equal(c.limits.maxFinalizeGas, 432100);
  assert.equal(old.limits.maxFinalizeGas, undefined);
  assert.equal(DEFAULT.limits.maxFinalizeGas, 2000000);
  for (const value of [null, undefined, 0, 2000001, 1000000.5, "2000000"]) {
    const bad = structuredClone(DEFAULT);
    bad.limits.maxFinalizeGas = value;
    assert.throws(() => validateConfig(bad));
  }
  const changed = structuredClone(c);
  changed.limits.maxFinalizeGas = 2000000;
  assert.notEqual(binding(c, null), binding(changed, null));
});
function harness(kind, limits = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-gas-policy-"));
  const signer = Wallet.createRandom();
  const c = validateConfig(
    {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      manager: Wallet.createRandom().address,
      [walletKey]: signer.address,
      dataDir: dir,
      autoFinalizeOwnJobs: true,
      limits: { ...DEFAULT.limits, ...limits },
    },
    dir,
  );
  const store = new Store(dir),
    pin = { token: Wallet.createRandom().address };
  store.putJob("1", role === "agent" ? { owned: 1 } : { my_vote: 1 });
  const iface = new Interface(ABI);
  let signatures = 0;
  const provider = {
    getTransactionCount: async () => 0,
    getFeeData: async () => ({
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 1000000000n,
    }),
    call: async () => "0x",
    estimateGas: async () => 1000000n,
    getBalance: async () => 10n ** 18n,
  };
  const tx = new Transactions(
    c,
    { provider, iface, verify: async () => {} },
    store,
    {
      getAddress: async () => signer.address,
      signTransaction: async () => {
        signatures++;
        throw Error("TEST_REACHED_SIGNING");
      },
    },
    pin,
    binding(c, pin),
  );
  atomicWrite(
    path.join(dir, "activation.json"),
    encode({ binding: binding(c, pin), [walletKey]: signer.address }),
  );
  const request = {
    to: c.manager,
    data: iface.encodeFunctionData(
      kind === "finalize" ? "finalizeJob" : "claimUSDC",
      kind === "finalize" ? ["1"] : [signer.address],
    ),
  };
  return {
    tx,
    request,
    store,
    signatures: () => signatures,
    close() {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("larger finalization gas ceiling does not authorize an oversized ordinary claim", async () => {
  const h = harness("claim");
  try {
    await assert.rejects(
      h.tx.send(h.request, { kind: "claim" }),
      /GAS_UNITS_LIMIT/,
    );
    assert.equal(h.signatures(), 0);
    assert.equal(h.store.pending(), undefined);
  } finally {
    h.close();
  }
});
test("finalization still obeys gas-unit, per-transaction ETH and daily ETH ceilings before signing", async () => {
  for (const [limits, code] of [
    [{ maxFinalizeGas: 700000 }, /FINALIZATION_GAS_UNITS_LIMIT/],
    [{ maxTxETH: "0.0001" }, /TRANSACTION_COST_LIMIT/],
    [{ maxGas24hETH: "0.0001" }, /GAS_24H_LIMIT/],
    [{}, /TEST_REACHED_SIGNING/],
  ]) {
    const h = harness("finalize", limits);
    try {
      await assert.rejects(
        h.tx.send(h.request, { kind: "finalize", job: "1" }),
        code,
      );
      assert.equal(
        h.signatures(),
        String(code).includes("TEST_REACHED") ? 1 : 0,
      );
      assert.equal(h.store.pending(), undefined);
    } finally {
      h.close();
    }
  }
});
test("commissioning export preserves unverified status, hides structured secrets and invalidates stale scope", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-evidence-export-")),
    c = new Controller(dir);
  try {
    await c.createVault("Fixture-only evidence password!");
    await c.saveRPC(
      "https://primary.example.test/PRIMARY_SECRET",
      "https://witness.other.test/WITNESS_SECRET",
    );
    c.operations.record({
      id: "appliance",
      status: "pass",
      evidence: "Private fixture attestation; no real Mac test.",
    });
    let r = c.operations.evidenceReport();
    assert.equal(r.schema, "agi-commissioning-evidence/v1");
    assert.equal(
      r.operatorAttestations.find((x) => x.id === "appliance").status,
      "pass",
    );
    assert.equal(r.outstandingAttestationIds.length, 7);
    assert.match(r.qualification, /Not established/);
    assert.equal(r.deployment.enrollmentPresent, false);
    assert.equal(r.software.platform, process.platform);
    assert.ok(!JSON.stringify(r).includes("PRIMARY_SECRET"));
    assert.ok(!JSON.stringify(r).includes("WITNESS_SECRET"));
    assert.ok(!JSON.stringify(r).includes("primary.example"));
    assert.ok(!JSON.stringify(r).includes("Fixture-only evidence password"));
    assert.equal(Object.keys(r.requiredExternalEvidence).length, 8);
    assert.equal(
      new Operations(c, role, "changed-version").evidenceReport()
        .outstandingAttestationIds.length,
      8,
    );
    const before = r.scope;
    await c.saveConfig({
      limits: { ...c.config.limits, maxFinalizeGas: 1500000 },
    });
    r = c.operations.evidenceReport();
    assert.notEqual(r.scope, before);
    assert.equal(r.outstandingAttestationIds.length, 8);
    c.vault.lock();
    r = c.operations.evidenceReport();
    assert.equal(r.scope, null);
    assert.equal(r.scopeStatus, "locked-unverified");
    assert.equal(r.outstandingAttestationIds.length, 8);
  } finally {
    await c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
