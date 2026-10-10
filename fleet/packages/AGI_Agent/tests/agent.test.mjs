import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Interface, Wallet, parseUnits } from "ethers";
import {
  normalizeWork,
  AGENT_DECLARATION,
  checkDelivery,
  deliveryURI,
  assertPrepared,
  shardFor,
} from "../src/work.mjs";
import { DECLARATION } from "../src/review.mjs";
import { DEFAULT, validateConfig, binding } from "../src/config.mjs";
import { Publisher } from "../src/publisher.mjs";
import { rawCID } from "../src/content.mjs";
import { Store } from "../src/store.mjs";
import { Engine } from "../src/engine.mjs";
import { Transactions } from "../src/transactions.mjs";
import { ABI, TOKEN_ABI } from "../src/chain.mjs";
import { Controller } from "../src/control/controller.mjs";
import { parseAnswer } from "../src/control/companion.mjs";
import { sampleSpec, goodDelivery } from "./fixtures.mjs";
import { atomicWrite, encode, sha256, NodeError } from "../src/util.mjs";
const content = JSON.stringify(goodDelivery),
  spec = normalizeWork(sampleSpec, DECLARATION),
  a = Wallet.createRandom().address,
  m = Wallet.createRandom().address,
  token = Wallet.createRandom().address;
function harness({ executor, publisher } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-agent-unit-"));
  const c = validateConfig(
    {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      agent: a,
      manager: m,
      dataDir: dir,
      execution: {
        ...DEFAULT.execution,
        publicDataOnly: true,
        publicPublishing: true,
      },
    },
    dir,
  );
  const store = new Store(dir),
    pin = { chainId: 31337, manager: m, token },
    chain = {
      assertAgentAuthorized: async () => ({eligible:true,eligibility:"verified"}),
      iface: new Interface(ABI),
      snapshot: async () => ({ id: "1" }),
      eligible: () => null,
    };
  const engine = new Engine(c, chain, store, pin, {
    live: true,
    executor:
      executor ??
      (async (kind) =>
        kind === "generate"
          ? { status: "complete", content }
          : { verdict: "pass" }),
    publisher: publisher ?? { publish: async () => deliveryURI(content) },
    reader: {
      read: async () => ({
        bytes: Buffer.from(JSON.stringify(sampleSpec)),
        sha256: sha256(JSON.stringify(sampleSpec)),
      }),
    },
  });
  atomicWrite(
    path.join(dir, "activation.json"),
    encode({ binding: binding(c, pin), agent: a }),
  );
  store.putJob("1", { details: DECLARATION, created_block: 1 });
  return {
    dir,
    c,
    store,
    chain,
    pin,
    engine,
    row: () => store.job("1"),
    close: () => {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("original formal format remains validator-compatible; extended envelope is explicit opt-in", () => {
  assert.equal(spec.compatibility, "agi-node-v2.1");
  assert.throws(() => normalizeWork(sampleSpec, "arbitrary buyer terms"));
  const envelope = {
    schema: "agi-agent-job/v1",
    task: "Build the specified record",
    inputs: "Public values only",
    acceptance: sampleSpec,
    dataPolicy: "public",
  };
  assert.throws(() => normalizeWork(envelope, AGENT_DECLARATION));
  assert.equal(
    normalizeWork(envelope, AGENT_DECLARATION, true).compatibility,
    "buyer-or-envelope-validator",
  );
  assert.throws(() =>
    normalizeWork(
      { ...envelope, dataPolicy: "private" },
      AGENT_DECLARATION,
      true,
    ),
  );
  assert.throws(() =>
    normalizeWork({ ...envelope, command: "rm -rf" }, AGENT_DECLARATION, true),
  );
});
test("content must pass formal checks and exact prepared content-address binding", () => {
  assert.equal(checkDelivery(spec, content).decision, "approve");
  assert.equal(
    checkDelivery(spec, JSON.stringify({ ...goodDelivery, priceUSDC: 1000 }))
      .decision,
    "reject",
  );
  assert.throws(() => checkDelivery(spec, "a".repeat(12001)));
  const w = {
    spec,
    content,
    uri: deliveryURI(content),
    stage: "published",
    binding: "policy",
  };
  assertPrepared(w, "policy");
  for (const patch of [
    { content: content + " " },
    { uri: "https://evil.test" },
    { stage: "checked" },
    { binding: "other" },
  ])
    assert.throws(() => assertPrepared({ ...w, ...patch }, "policy"));
});
test("fleet partitions cover each opportunity exactly once and remain stable across restarts", () => {
  const counts = Array(8).fill(0);
  for (let i = 1; i <= 10000; i++) {
    const slot = shardFor(1, m, String(i), 8);
    assert.equal(slot, shardFor(1, m.toLowerCase(), String(i), 8));
    counts[slot]++;
  }
  assert.ok(counts.every((n) => n > 1000 && n < 1500));
});
test("relocating an encrypted backup preserves portable authority while policy changes invalidate it", () => {
  const c = validateConfig(structuredClone(DEFAULT), "/tmp/a");
  assert.equal(
    binding(c, {}),
    binding({ ...c, dataDir: "/tmp/b", keystore: "/tmp/b/key" }, {}),
  );
  assert.notEqual(
    binding(c, {}),
    binding({ ...c, execution: { ...c.execution, shardCount: 2 } }, {}),
  );
});
test("generation is journaled before invocation; review and publishing are separate persisted stages", async () => {
  let h,
    calls = 0;
  h = harness({
    executor: async (kind) => {
      calls++;
      assert.equal(
        h.store.work("1").stage,
        kind === "generate" ? "generating" : "draft",
      );
      return kind === "generate"
        ? { status: "complete", content }
        : { verdict: "pass" };
    },
  });
  try {
    await h.engine.prepare(h.row(), { specURI: "ipfs://fixture" });
    assert.equal(h.store.work("1").stage, "draft");
    await h.engine.prepare(h.row(), {});
    assert.equal(h.store.work("1").stage, "checked");
    await h.engine.prepare(h.row(), {});
    assertPrepared(h.store.work("1"), h.engine.preparationBinding);
    assert.equal(calls, 2);
    assert.equal(h.store.pending(), undefined);
  } finally {
    h.close();
  }
});
test("formal failure, model concern and quota outage cannot reach publication or a bond", async () => {
  for (const mode of ["formal", "quality", "quota"]) {
    let publishes = 0;
    const h = harness({
      executor: async (kind) => {
        if (mode === "quota") throw new NodeError("COMPANION_DAILY_LIMIT");
        return kind === "generate"
          ? { status: "complete", content: mode === "formal" ? "{}" : content }
          : { verdict: "decline" };
      },
      publisher: {
        publish: async () => {
          publishes++;
          return deliveryURI(content);
        },
      },
    });
    try {
      if (mode === "quota") {
        await assert.rejects(
          h.engine.prepare(h.row(), { specURI: "ipfs://fixture" }),
          /DAILY_LIMIT/,
        );
        assert.equal(h.store.work("1").attempts, 0);
      } else {
        await h.engine.prepare(h.row(), { specURI: "ipfs://fixture" });
        await h.engine.prepare(h.row(), {});
        assert.equal(h.store.work("1").stage, "new");
      }
      assert.equal(publishes, 0);
      assert.equal(h.store.pending(), undefined);
    } finally {
      h.close();
    }
  }
});
test("failed public availability retries the same checked bytes without another model call", async () => {
  let calls = 0,
    tries = 0;
  const h = harness({
    executor: async (kind) => {
      calls++;
      return kind === "generate"
        ? { status: "complete", content }
        : { verdict: "pass" };
    },
    publisher: {
      publish: async () => {
        if (++tries === 1) throw new NodeError("PUBLIC_DELIVERY_UNAVAILABLE");
        return deliveryURI(content);
      },
    },
  });
  try {
    await h.engine.prepare(h.row(), { specURI: "fixture" });
    await h.engine.prepare(h.row(), {});
    await assert.rejects(h.engine.prepare(h.row(), {}), /PUBLIC_DELIVERY/);
    assert.equal(h.store.work("1").stage, "checked");
    await h.engine.prepare(h.row(), {});
    assert.equal(calls, 2);
    assert.equal(tries, 2);
  } finally {
    h.close();
  }
});
test("pause during generation cannot promote a returned draft into spend authority", async () => {
  let h;
  h = harness({
    executor: async () => {
      atomicWrite(path.join(h.dir, "STOP"), "operator");
      return { status: "complete", content };
    },
  });
  try {
    await assert.rejects(
      h.engine.prepare(h.row(), { specURI: "fixture" }),
      /NODE_PAUSED/,
    );
    assert.notEqual(h.store.work("1").stage, "published");
    assert.equal(h.store.pending(), undefined);
  } finally {
    h.close();
  }
});
test("new agent signer permits only exact approved apply/submit/claim/finalize actions", () => {
  const h = harness();
  try {
    const tx = h.engine.tx;
    h.store.saveWork("1", {
      binding: h.engine.binding,
      spec_hash: "x",
      spec,
      content,
      uri: deliveryURI(content),
      stage: "published",
    });
    h.store.putJob("1", { owned: 1 });
    const req = (name, args) => ({
      to: m,
      data: h.chain.iface.encodeFunctionData(name, args),
    });
    tx.policy(req("applyForJob", ["1", "", []]), "apply", "1", null, "1");
    tx.policy(
      req("requestJobCompletion", ["1", deliveryURI(content)]),
      "submit",
      "1",
      null,
      "0",
    );
    tx.policy(req("claimUSDC", [a]), "claim", null, null, "0");
    for (const r of [
      req("validateJob", ["1", "", []]),
      req("disapproveJob", ["1", "", []]),
      req("disputeJob", ["1"]),
    ])
      assert.throws(() => tx.policy(r, "apply", "1", null, "1"));
    assert.throws(() =>
      tx.policy(req("claimUSDC", [m]), "claim", null, null, "0"),
    );
    assert.throws(() =>
      tx.policy(
        req("requestJobCompletion", ["1", deliveryURI("other")]),
        "submit",
        "1",
        null,
        "0",
      ),
    );
    assert.throws(() =>
      tx.policy(
        { ...req("applyForJob", ["1", "", []]), value: 1n },
        "apply",
        "1",
        null,
        "1",
      ),
    );
    assert.throws(() =>
      tx.policy(
        tx.approveRequest(parseUnits("26", 6)),
        "approve",
        "1",
        null,
        String(parseUnits("26", 6)),
      ),
    );
  } finally {
    h.close();
  }
});
test("spending caps include pending journal reservations and stop on clock rollback", () => {
  const h = harness();
  try {
    const now = Math.floor(Date.now() / 1000);
    h.engine.tx.budget(now, 1n, "0", "claim");
    assert.throws(
      () => h.engine.tx.budget(now - 301, 1n, "0", "claim"),
      /CLOCK/,
    );
    h.store.reserve({
      hash: "0x1",
      raw: "fixture",
      nonce: 0,
      kind: "apply",
      job: "1",
      bond: parseUnits("100", 6).toString(),
      gas_budget: "1",
      created: now,
    });
    assert.throws(() => h.engine.tx.budget(now, 1n, "1", "apply"), /BOND_24H/);
  } finally {
    h.close();
  }
});
test("publisher pins a raw CID, verifies local bytes and requires public byte verification", async () => {
  const c = {
      ...DEFAULT,
      execution: { ...DEFAULT.execution, publicPublishing: true },
    },
    bytes = Buffer.from(content),
    cid = rawCID(bytes);
  let calls = 0,
    verified = 0;
  const pub = new Publisher(c, {
    fetchImpl: async (url, request) => {
      calls++;
      assert.ok(url.startsWith("http://127.0.0.1:5001/api/v0/"));
      assert.equal(request.redirect, "error");
      if (url.includes("block/put")) {
        assert.ok(request.body instanceof FormData);
        return Response.json({ Key: cid, Size: bytes.length });
      }
      return new Response(bytes);
    },
    reader: {
      read: async (uri) => {
        verified++;
        assert.equal(uri, "ipfs://" + cid);
        return { sha256: sha256(bytes) };
      },
    },
  });
  assert.equal(await pub.publish(content), "ipfs://" + cid);
  assert.equal(calls, 2);
  assert.equal(verified, 1);
  const bad = new Publisher(c, {
    fetchImpl: async () =>
      Response.json({ Key: rawCID(Buffer.from("bad")), Size: bytes.length }),
  });
  await assert.rejects(bad.publish(content), /HASH_MISMATCH/);
  const disabled = new Publisher({
    ...c,
    execution: { ...c.execution, publicPublishing: false },
  });
  await assert.rejects(disabled.publish(content), /NOT_AUTHORIZED/);
});
test("model output rejects arbitrary actions, ambiguous fields and oversized deliverables", () => {
  assert.equal(
    parseAnswer("generate", JSON.stringify({ status: "complete", content }))
      .content,
    content,
  );
  for (const value of [
    { status: "complete", content, command: "transfer" },
    { status: "complete", content: "" },
    { status: "complete", content: "x".repeat(12001) },
    { status: "success", content },
  ])
    assert.throws(() => parseAnswer("generate", JSON.stringify(value)));
  assert.throws(() =>
    parseAnswer("quality", '{"verdict":"pass","verdict":"decline"}'),
  );
  assert.throws(() => parseAnswer("quality", '{"verdict":"approve"}'));
});
test("controller broker requires live authorization and validates formal checks before sending quality input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-agent-broker-")),
    c = new Controller(dir);
  let calls = 0;
  try {
    await c.createVault("private test password 123");
    c.companion.request = async () => {
      calls++;
      return { verdict: "pass" };
    };
    await assert.rejects(
      c.executeWork({
        kind: "quality",
        payload: { specification: spec, delivery: content },
      }),
      /EXECUTOR_UNAVAILABLE/,
    );
    c.desired = true;
    c.worker = {};
    c.workerMode = "live";
    c.config.execution.publicDataOnly = true;
    c.config.execution.publicPublishing = true;
    await assert.rejects(
      c.executeWork({
        kind: "quality",
        payload: { specification: spec, delivery: "{}" },
      }),
      /DELIVERY_CHECK_FAILED/,
    );
    assert.equal(calls, 0);
    await c.executeWork({
      kind: "quality",
      payload: { specification: spec, delivery: content },
    });
    assert.equal(calls, 1);
  } finally {
    c.worker = null;
    c.desired = false;
    await c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("unrecorded confirmed wallet activity prevents a new signature", async () => {
  const h = harness();
  try {
    h.chain.verify = async () => {};
    h.chain.provider = { getTransactionCount: async () => 1 };
    h.engine.tx.signer = { getAddress: async () => a };
    await assert.rejects(
      h.engine.tx.send(h.engine.tx.approveRequest(0n), { kind: "approve" }),
      /EXTERNAL_NONCE_CHANGED/,
    );
    assert.equal(h.store.pending(), undefined);
  } finally {
    h.close();
  }
});
test("full encrypted backup preserves prepared work and its portable authority on another home", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-agent-backup-")),
    target = fs.mkdtempSync(path.join(os.tmpdir(), "agi-agent-restored-")),
    c = new Controller(dir),
    r = new Controller(target),
    password = "private backup test password 123";
  try {
    await c.createVault(password);
    await c.wallet("create");
    const b = binding(c.config, null),
      store = new Store(c.config.dataDir);
    store.saveWork("9", {
      binding: b,
      spec_hash: "fixture",
      spec,
      content,
      uri: deliveryURI(content),
      stage: "published",
    });
    store.putJob("9", { owned: 1, status: "assigned" });
    store.close();
    const sealed = await c.backup(password);
    await r.restore(sealed, password, true);
    const recovered = new Store(r.config.dataDir);
    try {
      assertPrepared(recovered.work("9"), binding(r.config, null));
      assert.equal(recovered.job("9").owned, 1);
      assert.equal(recovered.work("9").content, content);
    } finally {
      recovered.close();
    }
    assert.equal(r.settings.restored, true);
    assert.equal(
      fs.existsSync(path.join(r.config.dataDir, "activation.json")),
      false,
    );
  } finally {
    await c.close();
    await r.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
test("changing stopped policy reconsiders skipped opportunities without altering completed or owned history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-agent-policy-")),
    c = new Controller(dir);
  try {
    await c.createVault("private policy test password 123");
    const store = new Store(c.config.dataDir);
    store.putJob("1", { status: "unsupported", next_review: 9999999999 });
    store.putJob("2", { status: "terminal" });
    store.close();
    await c.saveConfig({
      execution: { ...c.config.execution, allowEnvelopes: true },
    });
    let s = new Store(c.config.dataDir);
    assert.equal(s.job("1").status, "waiting");
    assert.equal(s.job("1").next_review, 0);
    assert.equal(s.job("2").status, "terminal");
    s.putJob("3", { owned: 1, status: "assigned" });
    s.close();
    await assert.rejects(
      c.saveConfig({ autoClaim: false }),
      /ACTIVE_JOBS_MUST_FINISH/,
    );
  } finally {
    await c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("revoked identity cannot reach evidence reading, model generation, review or publication", async () => {
  let calls=0;
  const h=harness({executor:async()=>{calls++;throw Error("must not run")},publisher:{publish:async()=>{calls++;throw Error("must not run")}}});
  try {
    h.chain.assertAgentAuthorized=async()=>{throw new NodeError("AGENT_NOT_AUTHORIZED")};
    h.engine.reader.read=async()=>{calls++;throw Error("must not read")};
    for(const stage of ["new","draft","checked","published"]) {
      h.store.saveWork("1",{binding:h.engine.binding,spec_hash:"fixture",spec,content,uri:deliveryURI(content),stage,attempts:0});
      await assert.rejects(h.engine.prepare(h.row(),{}),/AGENT_NOT_AUTHORIZED/);
    }
    assert.equal(calls,0);assert.equal(h.store.pending(),undefined);
  } finally {h.close();}
});
