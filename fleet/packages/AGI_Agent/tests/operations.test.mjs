import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VerifiedProvider } from "../src/verified-rpc.mjs";
import { monitorSnapshot, CASES } from "../src/control/operations.mjs";
import { Controller } from "../src/control/controller.mjs";
import { createControlServer } from "../src/control/server.mjs";
import {
  validateConnection,
  pollActor,
  startMonitor,
} from "../fleet/monitor.mjs";
import { DEFAULT, validateConfig } from "../src/config.mjs";
const wallet = "0x" + "1".repeat(40),
  other = "0x" + "2".repeat(40),
  hash = "0x" + "1".repeat(64);
function verified(primary, witness = primary) {
  let stopped = 0;
  const p = new VerifiedProvider(
    "http://127.0.0.1:1",
    "http://127.0.0.1:2",
    "unused",
    {
      primaryPerform: primary,
      witness: { _perform: witness, destroy() {} },
      onDisagreement: () => stopped++,
    },
  );
  return { p, stopped: () => stopped };
}
const block = (n = 100) => ({
  number: "0x" + n.toString(16),
  hash,
  parentHash: hash,
  timestamp: "0x1",
  stateRoot: hash,
  receiptsRoot: hash,
  transactionsRoot: hash,
});
const base = async (r) =>
  r.method === "chainId"
    ? "0x1"
    : r.method === "getBlock"
      ? block(r.blockTag === "0x63" ? 99 : 100)
      : r.method === "getBalance"
        ? "0x64"
        : "0x";
test("dual RPC reconciles head lag at the lower height and pins the same balance block", async () => {
  const tags = [];
  const x = verified(
    async (r) => {
      if (r.method === "getBalance") tags.push(r.blockTag);
      return base(r);
    },
    async (r) => {
      if (r.method === "getBlock" && r.blockTag === "latest") return block(99);
      if (r.method === "getBalance") tags.push(r.blockTag);
      return base(r);
    },
  );
  try {
    assert.equal(
      await x.p._perform({
        method: "getBalance",
        address: wallet,
        blockTag: "latest",
      }),
      "0x64",
    );
    assert.deepEqual(tags, ["0x63", "0x63"]);
    assert.equal(x.stopped(), 0);
  } finally {
    x.p.destroy();
  }
});
test("dual RPC block, contract, balance, nonce, chain, log and receipt disagreements latch signing stop", async () => {
  for (const [method, request, a, b] of [
    [
      "getBlock",
      { blockTag: "0x64" },
      block(),
      { ...block(), hash: "0x" + "2".repeat(64) },
    ],
    [
      "call",
      { blockTag: "0x64", transaction: { to: wallet, data: "0x" } },
      "0x00",
      "0x01",
    ],
    ["getCode", { blockTag: "0x64", address: wallet }, "0x01", "0x02"],
    ["getBalance", { blockTag: "0x64", address: wallet }, "0x1", "0x2"],
    [
      "getTransactionCount",
      { blockTag: "pending", address: wallet },
      "0x0",
      "0x1",
    ],
    ["chainId", {}, "0x1", "0xaa36a7"],
    [
      "getLogs",
      { filter: { fromBlock: "0x1", toBlock: "0x2" } },
      [],
      [
        {
          address: wallet,
          topics: [],
          data: "0x",
          blockNumber: "0x1",
          blockHash: hash,
          transactionHash: hash,
          transactionIndex: "0x0",
          logIndex: "0x0",
        },
      ],
    ],
    [
      "getTransactionReceipt",
      { hash },
      {
        transactionHash: hash,
        blockHash: hash,
        blockNumber: "0x64",
        status: "0x0",
        logs: [],
      },
      {
        transactionHash: hash,
        blockHash: hash,
        blockNumber: "0x64",
        status: "0x1",
        logs: [],
      },
    ],
  ]) {
    const x = verified(
      async () => a,
      async () => b,
    );
    try {
      await assert.rejects(
        x.p._perform({ method, ...request }),
        (e) => e.code === "RPC_DISAGREEMENT",
      );
      assert.equal(x.stopped(), 1);
      await assert.rejects(
        x.p._perform({
          method: "broadcastTransaction",
          signedTransaction: "0x",
        }),
        /RPC_DISAGREEMENT/,
      );
    } finally {
      x.p.destroy();
    }
  }
});
test("verification outage cannot fall back, does not latch a disagreement, and recovers", async () => {
  let down = true;
  const x = verified(base, async (r) => {
    if (down) throw Error("secret-bearing RPC failure");
    return base(r);
  });
  try {
    await assert.rejects(
      x.p._perform({ method: "getBalance", address: wallet, blockTag: "0x64" }),
      (e) =>
        e.code === "RPC_VERIFICATION_UNAVAILABLE" &&
        !e.message.includes("secret"),
    );
    assert.equal(x.stopped(), 0);
    down = false;
    assert.equal(
      await x.p._perform({
        method: "getBalance",
        address: wallet,
        blockTag: "0x64",
      }),
      "0x64",
    );
  } finally {
    x.p.destroy();
  }
});
test("dual RPC uses the larger gas estimate while preserving exact primary-only broadcast", async () => {
  let broadcast = 0;
  const x = verified(
    async (r) =>
      r.method === "estimateGas" ? "0x5208" : (broadcast++, "hash"),
    async (r) => {
      assert.notEqual(r.method, "broadcastTransaction");
      return "0x6000";
    },
  );
  try {
    assert.equal(
      await x.p._perform({ method: "estimateGas", transaction: {} }),
      "0x6000",
    );
    assert.equal(
      await x.p._perform({
        method: "broadcastTransaction",
        signedTransaction: "exact",
      }),
      "hash",
    );
    assert.equal(broadcast, 1);
  } finally {
    x.p.destroy();
  }
});
function healthy() {
  const now = Date.now(),
    at = new Date(now).toISOString();
  return {
    now,
    s: {
      running: true,
      unlocked: true,
      mode: "live",
      config: { chainId: 1 },
      lastSuccessfulCycle: at,
      lastCycle: at,
      lastCyclePassed: true,
      health: { checkedAt: at, eth: "0.1", usdc: "10", eligible: true },
      verification: { checkedAt: at, block: 100 },
      finalized: 99,
      runtime: { status: "ready" },
      companion: { calls24h: 2, config: { maxCalls24h: 48 } },
      counts: [{ status: "assigned", count: 1 }],
      pending: null,
    },
    probes: {
      checkedAt: at,
      diskFreeBytes: 1024 ** 3,
      gateway: { ok: true, checkedAt: at },
      ipfs: { ok: true, checkedAt: at },
    },
  };
}
test("monitor never treats a failed, stale or unverified cycle as healthy; secret fields stay private", () => {
  const { s, probes, now } = healthy();
  assert.equal(
    monitorSnapshot(s, probes, "agent", "1.1.0", now).state,
    "healthy",
  );
  s.rpcURL = "SUPERSECRET";
  s.config.agent = wallet;
  s.privateKey = "SUPERSECRET";
  s.jobs = [{ details: "SUPERSECRET" }];
  const good = monitorSnapshot(s, probes, "agent", "1.1.0", now);
  assert.ok(!JSON.stringify(good).includes("SUPERSECRET"));
  assert.ok(!JSON.stringify(good).includes(wallet));
  assert.equal(good.activeJobs, 1);
  for (const change of [
    (x) => (x.lastCyclePassed = false),
    (x) => (x.lastSuccessfulCycle = new Date(now - 300000).toISOString()),
    (x) => (x.verification.lastError = "RPC_DISAGREEMENT"),
    (x) => (x.companion.calls24h = 48),
    (x) => (x.paused = true),
  ]) {
    const copy = structuredClone(s);
    change(copy);
    assert.equal(
      monitorSnapshot(copy, probes, "agent", "1.1.0", now).state,
      "attention",
    );
  }
  assert.equal(
    monitorSnapshot(s, probes, "agent", "1.1.0", now + 300000).wallet.eth,
    null,
  );
});
test("legacy configuration migrates conservatively without treating independence as reviewed", () => {
  const old = structuredClone(DEFAULT);
  delete old.independenceReviewed;
  assert.equal(validateConfig(old).independenceReviewed, false);
  assert.throws(
    () => validateConfig({ ...old, independenceReviewed: "yes" }),
    /CONFIG_INDEPENDENCE/,
  );
});
test("public-chain activation requires independent RPC and recorded identity review; mainnet also requires scoped commissioning", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-ops-"));
  const c = new Controller(dir);
  try {
    await c.createVault("Fixture-only secret password!");
    await c.wallet("create");
    await assert.rejects(c.activationChallenge(), /VERIFICATION_RPC_REQUIRED/);
    await c.saveRPC(
      "https://primary.example.test/key",
      "https://witness.other.test/key",
    );
    assert.throws(
      () => c.assertOperationsReady(),
      /INDEPENDENCE_REVIEW_REQUIRED/,
    );
    await c.saveConfig({ independenceReviewed: true });
    c.assertOperationsReady();
    await c.saveConfig({ chainId: 1 });
    assert.throws(() => c.assertOperationsReady(), /COMMISSIONING_REQUIRED/);
    for (const id of Object.keys(CASES))
      c.operations.record({
        id,
        status: "pass",
        evidence: "Fixture operator attestation, not a real qualification.",
      });
    c.assertOperationsReady();
    await c.saveRPC(
      "https://changed.example.test/key",
      "https://witness.other.test/key",
    );
    assert.throws(() => c.assertOperationsReady(), /COMMISSIONING_REQUIRED/);
    assert.throws(
      () =>
        c.operations.record({ id: "soak", status: "pass", evidence: "short" }),
      /COMMISSIONING_EVIDENCE_REQUIRED/,
    );
    const self = c.operations.identity();
    await assert.rejects(
      c.operations.excludePeer({ identity: self }),
      /PEER_WALLET_MUST_DIFFER/,
    );
    await c.operations.excludePeer({
      identity: {
        schema: "agi-actor-identity/v1",
        role: "node",
        wallet: other,
      },
    });
    assert.ok(c.config.excludedParties.includes(other));
    assert.equal(c.config.independenceReviewed, false);
    await assert.rejects(
      c.saveRPC("https://same.test/key1", "https://same.test/key2"),
      /RPC_PROVIDERS_MUST_DIFFER/,
    );
    const text = JSON.stringify(c.operations.summary());
    assert.ok(!text.includes("primary.example"));
  } finally {
    await c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("monitor credentials reach only read status and are rejected by signing/operator routes", async () => {
  const secret = "a".repeat(64),
    { s, probes } = healthy();
  const controller = {
    companion: { acceptsReadToken: (t) => t === secret },
    operations: {
      snapshot: () => monitorSnapshot(s, probes, "agent", "1.1.0"),
    },
  };
  const app = await createControlServer(controller, { port: 0 });
  try {
    const origin = `http://127.0.0.1:${app.port}`,
      headers = { Authorization: "Bearer " + secret };
    assert.equal(
      (await fetch(origin + "/api/monitor/status", { headers })).status,
      200,
    );
    assert.equal(
      (await fetch(origin + "/api/status", { headers })).status,
      401,
    );
    assert.equal((await fetch(origin + "/api/monitor/status")).status, 401);
    assert.equal(
      (
        await fetch(origin + "/api/settlement-budget", {
          method: "POST",
          headers: {
            ...headers,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            acknowledge: true,
            limits: { maxFinalizeGas: 2000000 },
          }),
        })
      ).status,
      401,
    );
    assert.equal(
      (await fetch(origin + "/api/operations/evidence", { headers })).status,
      401,
    );
    assert.equal(
      (
        await fetch(origin + "/api/pause", {
          method: "POST",
          headers: {
            ...headers,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      401,
    );
    controller.companion.acceptsReadToken = () => false;
    assert.equal(
      (await fetch(origin + "/api/monitor/status", { headers })).status,
      401,
    );
  } finally {
    await app.close();
  }
});
test("fleet validates localhost-only access and detects stale data and dead tunnels", async () => {
  const c = {
    schema: "agi-fleet-read-access/v1",
    role: "agent",
    token: "a".repeat(64),
    url: "http://127.0.0.1:8788/api/monitor/status",
  };
  const a = validateConnection({
    connection: c,
    name: "Mini",
    forwardPort: 18788,
  });
  assert.throws(() =>
    validateConnection({
      connection: { ...c, url: "https://example.com/api/status" },
      name: "Mini",
      forwardPort: 18788,
    }),
  );
  assert.throws(() =>
    validateConnection({ connection: c, name: "Mini", forwardPort: 80 }),
  );
  const { s, probes } = healthy();
  const good = monitorSnapshot(s, probes, "agent", "1.1.0");
  assert.equal(
    (
      await pollActor(a, async (url, req) => {
        assert.equal(req.headers.Host, "127.0.0.1:8788");
        assert.equal(req.headers.Authorization, "Bearer " + c.token);
        return Response.json(good);
      })
    ).state,
    "healthy",
  );
  assert.equal(
    (
      await pollActor(a, async () =>
        Response.json({ ...good, generatedAt: "2000-01-01T00:00:00Z" }),
      )
    ).state,
    "offline",
  );
  assert.equal(
    (
      await pollActor(a, async () => {
        throw Error("down");
      })
    ).state,
    "offline",
  );
});
test("fleet hub requires its own session, does not export tokens, and persists observed exceptions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-fleet-"));
  const app = await startMonitor({
    home: dir,
    port: 0,
    fetchImpl: async () => {
      throw Error("offline");
    },
  });
  try {
    const origin = `http://127.0.0.1:${app.port}`,
      post = async (route, body, t) =>
        fetch(origin + route, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Authorization: "Bearer " + t,
          },
          body: JSON.stringify(body),
        });
    assert.equal((await fetch(origin + "/api/status")).status, 400);
    const sr = await post("/api/session", { token: app.url.split("#")[1] });
    const { token } = await sr.json();
    assert.equal(
      (await post("/api/session", { token: app.url.split("#")[1] })).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/add",
          {
            name: "Mini",
            forwardPort: 18788,
            connection: {
              schema: "agi-fleet-read-access/v1",
              role: "agent",
              token: "b".repeat(64),
              url: "http://127.0.0.1:8788/api/monitor/status",
            },
          },
          token,
        )
      ).status,
      200,
    );
    await app.poll();
    const report = app.report();
    assert.ok(!JSON.stringify(report).includes("b".repeat(64)));
    assert.equal(report.actors.length, 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.report().actors[0].state, "offline");
    assert.ok(app.report().actors[0].history.unhealthySamples >= 1);
    assert.ok(fs.existsSync(path.join(dir, "observations.json")));
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("one RPC receipt index lag waits without recording success or latching a conflict", async () => {
  const x = verified(
    async () => null,
    async () => ({
      transactionHash: hash,
      blockHash: hash,
      blockNumber: "0x64",
      status: "0x1",
      logs: [],
    }),
  );
  try {
    await assert.rejects(
      x.p._perform({ method: "getTransactionReceipt", hash }),
      /RPC_VERIFICATION_UNAVAILABLE/,
    );
    assert.equal(x.stopped(), 0);
  } finally {
    x.p.destroy();
  }
});
