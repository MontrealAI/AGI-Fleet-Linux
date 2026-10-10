import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { Interface } from "ethers";
import { Store } from "../ops/store.mjs";
import { Chain } from "../ops/chain.mjs";
import { Engine } from "../ops/engine.mjs";
import { Controller } from "../ops/controller.mjs";
import { createServer } from "../ops/server.mjs";
import { health } from "../ops/health.mjs";
import { serviceLabel } from "../ops/os.mjs";
import { collectEvidence, modelReview } from "../ops/evidence.mjs";
import { acquireLock, sha256, canonical, now } from "../ops/common.mjs";
import { acquireWalletLease } from "../packages/AGI_Node/src/wallet-lease.mjs";
import { acquireWalletLease as acquireAgentLease } from "../packages/AGI_Agent/src/wallet-lease.mjs";
import { ABI } from "../packages/AGI_Node/src/chain.mjs";
import { AUTONOMY_DECLARATION } from "../packages/AGI_Node/src/autonomy.mjs";
import { config, temp, addr, snap, spec } from "./helpers.mjs";

async function childHolding(module, invocation) {
  const code = `import * as m from ${JSON.stringify(module)}; ${invocation}; process.stdout.write("held\\n"); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("lease child timed out: " + err));
    }, 5000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (c) => {
      clearTimeout(timer);
      reject(Error("lease child exited " + c + ": " + err));
    });
    child.stdout.once("data", (d) => {
      clearTimeout(timer);
      assert.equal(String(d), "held\n");
      resolve();
    });
  });
  return child;
}

test("Agent and Node exclude the same wallet across processes; crash releases the lease", async () => {
  const dir = temp();
  let child;
  try {
    const release = acquireAgentLease(31337, addr(90), dir);
    assert.throws(
      () => acquireWalletLease(31337, addr(90), dir),
      /WALLET_ALREADY_RUNNING/,
    );
    const other = acquireWalletLease(31337, addr(91), dir);
    other();
    release();
    child = await childHolding(
      new URL("../packages/AGI_Node/src/wallet-lease.mjs", import.meta.url)
        .href,
      `m.acquireWalletLease(31337,${JSON.stringify(addr(90))},${JSON.stringify(dir)})`,
    );
    assert.throws(
      () => acquireAgentLease(31337, addr(90), dir),
      /WALLET_ALREADY_RUNNING/,
    );
    const ended = once(child, "exit");
    child.kill("SIGKILL");
    await ended;
    child = null;
    const resumed = acquireAgentLease(31337, addr(90), dir);
    resumed();
    resumed();
  } finally {
    if (child) child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("process lease rejects duplicates and recovers a stale PID after a crash", async () => {
  const home = temp();
  let child;
  try {
    child = await childHolding(
      new URL("../ops/common.mjs", import.meta.url).href,
      `m.acquireLock(${JSON.stringify(home)})`,
    );
    assert.throws(() => acquireLock(home), /INSTANCE_ALREADY_RUNNING/);
    const ended = once(child, "exit");
    child.kill("SIGKILL");
    await ended;
    child = null;
    const release = acquireLock(home);
    assert.throws(() => acquireLock(home), /INSTANCE_ALREADY_RUNNING/);
    release();
    assert.equal(fs.existsSync(path.join(home, "process.lock")), false);
    assert.ok(fs.existsSync(path.join(home, "process-lock.sqlite")));
  } finally {
    if (child) child.kill("SIGKILL");
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("beneficiary scanning is bounded, fair and resumes after restart", async () => {
  const home = temp();
  let store = new Store(home);
  try {
    const beneficiaries = Array.from({ length: 5 }, (_, i) => addr(i + 30)),
      reads = [];
    const c = config("recovery", {
      claimBeneficiaries: beneficiaries,
      maxClaimsPerCycle: 2,
    });
    const chain = {
      manager: {
        settlementPaused: async () => false,
        pendingUSDC: async (b) => {
          reads.push(b);
          return 0n;
        },
      },
    };
    let engine = new Engine(c, chain, store, {}, { reader: {} });
    await engine.claims(false);
    assert.deepEqual(reads, beneficiaries.slice(0, 2));
    store.close();
    store = new Store(home);
    engine = new Engine(c, chain, store, {}, { reader: {} });
    await engine.claims(false);
    await engine.claims(false);
    assert.deepEqual(reads, [...beneficiaries, beneficiaries[0]]);
  } finally {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function engineFixture() {
  const home = temp(),
    store = new Store(home),
    c = config("recovery");
  const state = snap({ neutralRefundAfter: 1n });
  store.putJob("0", {
    created: 1,
    details: AUTONOMY_DECLARATION,
    spec_uri: sha256(state.specURI),
  });
  const chain = {
    c,
    iface: new Interface(ABI),
    verify: async () => {},
    scan: async () => ({ caughtUp: true }),
    snapshot: async () => state,
    manager: { settlementPaused: async () => false },
    provider: { getBlock: async () => ({ timestamp: now() - 86400 }) },
  };
  const engine = new Engine(c, chain, store, {}, { reader: {} });
  engine.tx.active = () => {};
  return {
    home,
    store,
    c,
    chain,
    engine,
    cleanup() {
      store.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test("ready jobs receive a turn between claims", async () => {
  const f = engineFixture();
  try {
    const actions = [];
    f.engine.claims = async () => {
      actions.push("claim");
      f.store.reserve({
        hash: "claimed",
        raw: "fixture",
        nonce: 0,
        action: "claim",
        gas_budget: "1",
        created: now(),
        binding: "test",
      });
      f.store.db.exec("UPDATE txs SET status='confirmed'");
      return true;
    };
    f.engine.tx.send = async (_r, a) => {
      actions.push(a.action);
    };
    await f.engine.cycle({ live: true });
    await f.engine.cycle({ live: true });
    assert.deepEqual(actions, ["claim", "refund"]);
  } finally {
    f.cleanup();
  }
});

test("fatal transaction errors reach service health and retain the blocked job", async () => {
  const f = engineFixture();
  try {
    f.engine.tx.send = async () => {
      throw Error("EXTERNAL_NONCE_CHANGED");
    };
    await assert.rejects(
      f.engine.cycle({ live: true }),
      /EXTERNAL_NONCE_CHANGED/,
    );
    assert.equal(f.store.job("0").status, "blocked");
    assert.equal(f.store.stats().blockedJobs, 1);
    assert.equal(f.store.meta("lastCycle"), null);
  } finally {
    f.cleanup();
  }
});

test("cached proofs with self-consistent hashes still require valid decisions and times", async () => {
  const f = engineFixture();
  try {
    f.c.role = "moderator";
    const state = snap(),
      row = { ...f.store.job("0"), createdTime: now() - 86400 };
    const reader = {
      read: async (u) => ({
        bytes: Buffer.from(
          u === state.specURI ? JSON.stringify(spec) : '{"answer":42}',
        ),
      }),
    };
    const good = await collectEvidence(f.c, row, state, reader);
    for (const patch of [
      { decision: "uncertain" },
      { expires: good.created - 1, created: good.created + 500 },
    ]) {
      const bad = { ...good, ...patch };
      delete bad.hash;
      bad.hash = sha256(canonical(bad));
      // A not-yet-expired but inverted interval must fail schema checks too.
      if (patch.expires) {
        bad.expires = now() + 300;
        bad.created = now() + 400;
        delete bad.hash;
        bad.hash = sha256(canonical(bad));
      }
      await assert.rejects(
        f.engine.proof({ ...row, proof: JSON.stringify(bad) }, state),
      );
    }
  } finally {
    f.cleanup();
  }
});

test("incomplete or filtered model responses cannot pass the veto gate", async () => {
  const home = temp(),
    store = new Store(home);
  try {
    for (const reason of ["length", "content_filter", "tool_calls", null]) {
      const fetcher = async url =>url.endsWith('/health')?Response.json({role:'moderator',policyHash:'a'.repeat(64),policyCurrent:true,gatewayReady:true,stopped:false,uid:((process.getuid?.()??0)+1)}):
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: '{"verdict":"consistent"}' },
                finish_reason: reason,
              },
            ],
          }),
        );
      await assert.rejects(
        modelReview(config(), "a".repeat(64), {}, store, fetcher),
      );
    }
    assert.equal(store.stats().modelRequests24h, 4);
  } finally {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("monitor credential reads health but cannot access configuration or control", async () => {
  const home = temp(),
    controller = new Controller(home, "evidence");
  let panel = await createServer(controller);
  try {
    const file = path.join(home, "monitor-access.json"),
      monitor = JSON.parse(fs.readFileSync(file));
    const headers = {
      Authorization: "Bearer " + monitor.token,
      "Content-Type": "application/json",
    };
    const response = await fetch(panel.origin + "/api/health", { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.healthy, false);
    assert.ok(body.issues.includes("SERVICE_STOPPED"));
    assert.equal(body.config, undefined);
    assert.equal(body.pin, undefined);
    assert.equal(body.events, undefined);
    for (const [route, method] of [
      ["status", "GET"],
      ["monitor", "GET"],
      ["pause", "POST"],
      ["authorize", "POST"],
    ]) {
      assert.equal(
        (
          await fetch(panel.origin + "/api/" + route, {
            headers,
            method,
            ...(method === "POST" ? { body: "{}" } : {}),
          })
        ).status,
        403,
      );
    }
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    await new Promise((r) => panel.server.close(r));
    panel = await createServer(controller);
    assert.equal(JSON.parse(fs.readFileSync(file)).token, monitor.token);
  } finally {
    await new Promise((r) => panel.server.close(r));
    await controller.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("health distinguishes blocked jobs, expired authority and settlement pause", () => {
  const state = {
    running: true,
    mode: "live",
    status: "settlement-paused",
    config: { pollSeconds: 30 },
    stats: { blockedJobs: 1, exhaustedClaims: 1 },
    lastCycle: { time: 1000 },
    activation: { expires: 999 },
  };
  assert.deepEqual(health(state, 1000).issues, [
    "SETTLEMENT_PAUSED",
    "CLAIM_RETRIES_EXHAUSTED",
    "JOBS_NEED_ATTENTION",
    "AUTHORITY_EXPIRED",
  ]);
  state.status = "running";
  state.stats = { blockedJobs: 0, exhaustedClaims: 0 };
  state.activation.expires = 2000;
  assert.equal(health(state, 1000).healthy, true);
  assert.ok(health(state, 2001).issues.includes("NO_RECENT_CYCLE"));
  assert.notEqual(
    serviceLabel("/homes/a", "recovery"),
    serviceLabel("/homes/b", "recovery"),
  );
});

test("v1.0 transaction journals migrate without losing signed transactions", () => {
  const home = temp();
  let store;
  try {
    const db = new DatabaseSync(path.join(home, "service.sqlite"));
    db.exec(
      "CREATE TABLE txs(hash TEXT PRIMARY KEY,raw TEXT NOT NULL,nonce INTEGER UNIQUE NOT NULL,action TEXT NOT NULL,job TEXT,beneficiary TEXT,proof_hash TEXT,context TEXT,bond TEXT NOT NULL,gas_budget TEXT NOT NULL,created INTEGER NOT NULL,binding TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',block_number INTEGER,block_hash TEXT,receipt TEXT)",
    );
    db.prepare(
      "INSERT INTO txs(hash,raw,nonce,action,bond,gas_budget,created,binding) VALUES(?,?,?,?,?,?,?,?)",
    ).run("old", "original-signed", 2, "refund", "0", "123", 10, "policy");
    db.close();
    store = new Store(home);
    assert.equal(store.pending().raw, "original-signed");
    assert.equal(store.pending().accounted, 10);
    assert.equal(store.recent().length, 1);
  } finally {
    store?.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("event admission verifies the employer from contract state and fails closed on RPC errors", async () => {
  const home = temp(),
    store = new Store(home),
    c = config("employer", {
      wallet: addr(1),
      trustedBuyers: [addr(1), addr(2)],
    });
  try {
    const iface = new Interface(ABI),
      blockHash = "0x" + "1".repeat(64);
    const logs = [0, 1, 2, 3].map((id) => ({
      ...iface.encodeEventLog(iface.getEvent("JobCreated"), [
        id,
        "ipfs://spec",
        1000000n,
        3600n,
        AUTONOMY_DECLARATION,
      ]),
      blockNumber: 1,
      blockHash,
      removed: false,
    }));
    const reads = [];
    const chain = {
      c,
      iface,
      head: async () => ({ number: 1 }),
      safeHeight: async () => 1,
      provider: {
        getBlock: async () => ({ hash: blockHash }),
        getLogs: async () => logs,
      },
      manager: {
        getJobCore: async (id, options) => {
          reads.push(options.blockTag);
          if (id === "3")
            throw Object.assign(Error("deleted"), {
              data: iface.encodeErrorResult("JobNotFound", []),
            });
          return { employer: [addr(1), addr(2), addr(3)][Number(id)] };
        },
      },
    };
    await Chain.prototype.scan.call(chain, store);
    assert.deepEqual(
      store.queue(10).map((r) => r.id),
      ["0"],
    );
    assert.deepEqual(reads, [1, 1, 1, 1]);
    store.db.prepare("DELETE FROM meta WHERE k='cursor'").run();
    chain.manager.getJobCore = async () => {
      throw Error("NETWORK_ERROR");
    };
    await assert.rejects(
      Chain.prototype.scan.call(chain, store),
      /NETWORK_ERROR/,
    );
    assert.equal(store.meta("cursor"), null);
  } finally {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
