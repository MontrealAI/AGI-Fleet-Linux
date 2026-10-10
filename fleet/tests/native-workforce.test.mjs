import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Journal, privateDir, digest, canonical } from "../workforce/core.mjs";
import { seal, open, recipientId } from "../workforce/envelope.mjs";
import { NativeSession } from "../workforce/native.mjs";
import {
  checkGrant,
  grantBody,
  signGrant,
  nativeRuntime,
  validatePacket,
  reviewVerdict,
} from "../workforce/runner.mjs";
import core from "../workforce/core/computer-work.cjs";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agi-workforce-"));
const H = "a".repeat(64),
  ctx = { specSha256: H, purpose: "delivery", expiresAt: 2000000000 };
const key = () => crypto.generateKeyPairSync("x25519");
const pem = (k) => k.export({ type: "spki", format: "pem" });
test("encrypted handoff supports independently keyed recipients without publishing plaintext", () => {
  const a = key(),
    b = key(),
    plain = Buffer.from("private signed-in account result"),
    e = seal(plain, [pem(a.publicKey), pem(b.publicKey)], ctx);
  assert.equal(JSON.stringify(e).includes(plain.toString()), false);
  assert.deepEqual(open(e, a.privateKey, ctx), plain);
  assert.deepEqual(open(e, b.privateKey, ctx), plain);
  assert.equal(e.header.recipients[0], recipientId(a.publicKey));
});
for (const [name, mutate] of [
  ["ciphertext", (e) => (e.data.ciphertext = "AAAA")],
  [
    "authentication tag",
    (e) => (e.data.tag = Buffer.alloc(16).toString("base64")),
  ],
  ["recipient list", (e) => e.header.recipients.reverse()],
  ["key wrapping", (e) => (e.keys[0].ciphertext = "AAAA")],
  ["context", (e) => (e.header.context.purpose = "review")],
])
  test("rejects tampered " + name, () => {
    const a = key(),
      b = key(),
      e = seal(Buffer.from("secret"), [a.publicKey, b.publicKey], ctx);
    mutate(e);
    assert.throws(() => open(e, a.privateKey, ctx));
  });
test("rejects the wrong recipient, expired handoffs and noncanonical base64", () => {
  const a = key(),
    e = seal(Buffer.from("secret"), [a.publicKey], ctx);
  assert.throws(() => open(e, key().privateKey, ctx));
  assert.throws(() => open(e, a.privateKey, ctx, { now: ctx.expiresAt }));
  e.data.nonce += "\n";
  assert.throws(() => open(e, a.privateKey, ctx));
});
test("never reuses randomized ciphertext for repeated private output", () => {
  const a = key();
  assert.notDeepEqual(
    seal(Buffer.from("x"), [a.publicKey], ctx),
    seal(Buffer.from("x"), [a.publicKey], ctx),
  );
});
test("journal keeps failed attempts, unknown costs and exact bounded reservations", () => {
  const d = tmp(),
    j = new Journal(d);
  try {
    j.start("a", H, H, "agent");
    const action = j.reserve("a", { action: "click" }, { maxActions: 1 });
    assert.throws(() => j.reserve("a", {}, { maxActions: 1 }), /BUDGET/);
    j.resolve(action, { ok: true });
    assert.throws(() => j.resolve(action, { ok: true }), /ALREADY/);
    j.finish("a", "failed");
    assert.equal(j.report().unreconciledCosts, 1);
    assert.equal(j.report().totalRuns, 1);
    assert.throws(() => j.start("a", H, H, "agent"), /DUPLICATE/);
    j.reconcileCost("a", "1.000001", H);
    assert.equal(j.report().runs[0].cost_usdc, "1.000001");
  } finally {
    j.close();
    fs.rmSync(d, { recursive: true });
  }
});
test("a second runner cannot acquire a live lease, but intervention time can be recorded", () => {
  const d = tmp(),
    j = new Journal(d, { now: () => 1000 });
  let reader;
  try {
    j.start("a", H, H, "agent");
    assert.throws(() => new Journal(d), /ALREADY_RUNNING/);
    reader = new Journal(d, { observer: true, now: () => 2000 });
    const timer = reader.intervention("a", "fix");
    reader.now = () => 4500;
    assert.equal(reader.intervention("a", "fix", timer), 3);
    assert.equal(j.report().recordedHumanSeconds, 3);
    assert.throws(() => reader.start("b", H, H, "agent"), /OBSERVER/);
  } finally {
    reader?.close();
    j.close();
    fs.rmSync(d, { recursive: true });
  }
});
test("a killed process leaves its reservation recorded and restart never replays it", () => {
  const d = tmp(),
    module = new URL("../workforce/core.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import {Journal} from ${JSON.stringify(module)};const j=new Journal(${JSON.stringify(d)});j.start('crash','${H}','${H}','agent');j.reserve('crash',{action:'type'},{maxActions:2});process.kill(process.pid,'SIGKILL');`,
  ]);
  assert.equal(child.signal, "SIGKILL");
  const j = new Journal(d);
  try {
    const r = j.report();
    assert.equal(r.runs[0].status, "interrupted");
    assert.equal(r.runs[0].actions, 1);
    assert.throws(() => j.start("crash", H, H, "agent"), /DUPLICATE/);
  } finally {
    j.close();
    fs.rmSync(d, { recursive: true });
  }
});
test("hash-chain alteration is detected on restart", () => {
  const d = tmp(),
    j = new Journal(d);
  j.start("a", H, H, "agent");
  j.db.prepare("UPDATE events SET payload='{}'").run();
  j.close();
  assert.throws(() => new Journal(d), /TAMPERED/);
  fs.rmSync(d, { recursive: true });
});
test("private directory traversal through a symlink is rejected", () => {
  const d = tmp();
  fs.symlinkSync(os.tmpdir(), path.join(d, "link"));
  assert.throws(() => privateDir(path.join(d, "link", "other")), /LINK/);
  fs.rmSync(d, { recursive: true });
});
function session({ now = () => 1000, fail = false } = {}) {
  const d = tmp(),
    j = new Journal(d, { now });
  j.start("a", H, H, "agent");
  const calls = [];
  let generation = "one";
  const g = {
    node: async () => ({
      computerUse: {
        provider: { generation },
        actions: [
          "screenshot",
          "left_click",
          "type",
          "key",
          "set_value",
          "get_window_state",
          "list_windows",
        ],
      },
    }),
    invoke: async (command, p, id) => {
      calls.push({ command, p, id });
      if (fail && p.action === "left_click") throw Error("lost response");
      if (command === "screen.snapshot")
        return {
          base64: "AA==",
          format: "png",
          width: 100,
          height: 100,
          displayFrameId: "f",
          screenIndex: 0,
        };
      if (p.action === "get_window_state")
        return {
          ok: true,
          observation: { observationId: "o", elements: [{ elementRef: "e" }] },
        };
      return { ok: true };
    },
  };
  const s = new NativeSession(g, j, "a", { maxActions: 20 }, { now });
  return {
    s,
    j,
    d,
    calls,
    generation: (x) => (generation = x),
    close: () => {
      j.close();
      fs.rmSync(d, { recursive: true });
    },
  };
}
test("native input uses the observed frame and consumes it before dispatch", async () => {
  const f = session();
  try {
    await assert.rejects(
      () => f.s.act("left_click", { x: 1, y: 1 }),
      /FRESH_SCREEN/,
    );
    await f.s.act("screenshot");
    await f.s.act("left_click", { x: 1, y: 1 });
    assert.equal(f.calls[1].p.displayFrameId, "f");
    assert.equal(f.calls[1].p.refWidth, 100);
    await assert.rejects(() => f.s.act("type", { text: "x" }), /FRESH_SCREEN/);
  } finally {
    f.close();
  }
});
test("native inputs reject coordinates outside the image and stale frames", async () => {
  let now = 1000;
  const f = session({ now: () => now });
  try {
    await f.s.act("screenshot");
    await assert.rejects(
      () => f.s.act("left_click", { x: 100, y: 1 }),
      /COORDINATES/,
    );
    now += 30001;
    await assert.rejects(() => f.s.act("type", { text: "x" }), /FRESH_SCREEN/);
  } finally {
    f.close();
  }
});
test("provider restart invalidates the whole execution", async () => {
  const f = session();
  try {
    await f.s.act("screenshot");
    f.generation("two");
    await assert.rejects(() => f.s.act("screenshot"), /PROVIDER_RESTARTED/);
  } finally {
    f.close();
  }
});
for (const broken of ["malformed", "disconnected"])
  test("failed screen refresh clears old authority: " + broken, async () => {
    const f = session();
    try {
      await f.s.act("screenshot");
      f.s.gateway.invoke = async () => {
        if (broken === "disconnected") throw Error("disconnected");
        return { displayFrameId: "", width: 100, height: 100, format: "png", base64: "AA==" };
      };
      await assert.rejects(() => f.s.act("screenshot"));
      await assert.rejects(() => f.s.act("left_click", { x: 1, y: 1 }), /FRESH_SCREEN/);
    } finally { f.close(); }
  });
test("failed element refresh cannot reuse an older window observation", async () => {
  const f = session();
  try {
    await f.s.act("get_window_state", { windowRef: "w" });
    f.s.gateway.invoke = async () => ({ ok: false });
    await assert.rejects(() => f.s.act("get_window_state", { windowRef: "w" }), /ACTION_REFUSED/);
    await assert.rejects(() => f.s.act("set_value", { elementRef: "e", value: "x" }), /STALE_ELEMENT/);
  } finally { f.close(); }
});
test("clock rollback requires a fresh screen and window observation", async () => {
  let now = 1000;
  const f = session({ now: () => now });
  try {
    await f.s.act("screenshot");
    await f.s.act("get_window_state", { windowRef: "w" });
    now = 999;
    await assert.rejects(() => f.s.act("type", { text: "x" }), /FRESH_SCREEN/);
    await assert.rejects(() => f.s.act("set_value", { elementRef: "e", value: "x" }), /STALE_ELEMENT/);
  } finally { f.close(); }
});
test("uncertain mutation is recorded once and is never retried by the transport", async () => {
  const f = session({ fail: true });
  try {
    await f.s.act("screenshot");
    await assert.rejects(
      () => f.s.act("left_click", { x: 1, y: 1 }),
      /lost response/,
    );
    assert.equal(f.calls.filter((x) => x.p.action === "left_click").length, 1);
    assert.equal(f.j.report().runs[0].actions, 2);
    await assert.rejects(
      () => f.s.act("left_click", { x: 1, y: 1 }),
      /FRESH_SCREEN/,
    );
  } finally {
    f.close();
  }
});
test("model cannot select another node, execution, shell or security escalation", async () => {
  const f = session();
  try {
    await assert.rejects(
      () => f.s.act("exec", { command: "x" }),
      /UNAVAILABLE/,
    );
    await assert.rejects(
      () => f.s.act("screenshot", { node: "other" }),
      /FIELDS/,
    );
    await assert.rejects(
      () => f.s.act("screenshot", { executionId: "other" }),
      /FIELDS/,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.close();
  }
});
test("window elements require their current observation and cannot be invented", async () => {
  const f = session();
  try {
    await f.s.act("get_window_state", { windowRef: "w" });
    await assert.rejects(
      () => f.s.act("set_value", { elementRef: "invented", value: "x" }),
      /STALE_ELEMENT/,
    );
    await f.s.act("set_value", { elementRef: "e", value: "x" });
    assert.equal(f.calls.at(-1).p.observationId, "o");
    assert.equal(f.calls.at(-1).p.windowRef, "w");
  } finally {
    f.close();
  }
});
test("a failed close remains retryable for explicit cleanup instead of being marked closed", async () => {
  const f = session();
  let n = 0;
  f.s.gateway.invoke = async () => {
    if (!n++) throw Error("offline");
    return { ok: true };
  };
  try {
    await assert.rejects(() => f.s.close());
    assert.equal(f.s.closed, false);
    await f.s.close();
    assert.equal(f.s.closed, true);
  } finally {
    f.close();
  }
});

import { fixture } from "./workforce-fixture.mjs";
test("signed grants bind exact scope, node, runtime, model, recipients and budget", () => {
  const d = tmp(),
    f = fixture(d);
  try {
    assert.equal(checkGrant(f.c, f.spec, f.packet.grant).mode, "pilot");
    for (const mutate of [
      (x) => (x.body.nodeId = "other"),
      (x) => (x.body.model = "other"),
      (x) => x.body.limits.maxActions++,
      (x) => (x.body.specSha256 = "b".repeat(64)),
      (x) => (x.body.recipientIds = []),
    ]) {
      const g = structuredClone(f.packet.grant);
      mutate(g);
      assert.throws(() => checkGrant(f.c, f.spec, g), /SIGNATURE/);
    }
    f.c.model = "changed";
    assert.throws(() => checkGrant(f.c, f.spec, f.packet.grant), /SCOPE/);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
test("a signed production grant cannot bypass missing operational qualification", () => {
  const d = tmp(),
    f = fixture(d);
  try {
    const g = signGrant(
      grantBody(f.c, f.spec, { mode: "production" }),
      f.operator.privateKey,
    );
    assert.throws(() => checkGrant(f.c, f.spec, g), /QUALIFICATION_REQUIRED/);
    f.c.qualificationPolicyFile = path.join(d, "old-policy.json");
    f.c.qualificationEvidenceFile = path.join(d, "old-evidence.json");
    fs.writeFileSync(f.c.qualificationPolicyFile, JSON.stringify({schema:"agi-workforce-policy/v1"}), {mode:0o600});
    fs.writeFileSync(f.c.qualificationEvidenceFile, "{}", {mode:0o600});
    assert.throws(() => checkGrant(f.c, f.spec, signGrant(grantBody(f.c, f.spec, {mode:"production"}), f.operator.privateKey)), /QUALIFICATION_OPERATING_POLICY_REQUIRED/);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
test("native packets verify immutable input bytes before any model call", () => {
  const d = tmp(),
    f = fixture(d);
  try {
    f.spec.inputs = [
      {
        name: "input.txt",
        mediaType: "text/plain",
        maxBytes: 100,
        uri: "https://example.org/input",
        sha256: digest("truth"),
      },
    ];
    f.packet.inputs = [
      { name: "input.txt", content: Buffer.from("false").toString("base64") },
    ];
    assert.throws(() => validatePacket(f.packet), /INPUT_HASH/);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
test("reviewers must cover every criterion and abstain on uncertainty", () => {
  const d = tmp(),
    f = fixture(d);
  try {
    const r = {
      safeToReview: true,
      checks: [
        {
          id: "value",
          status: "pass",
          method: "opened file",
          observed: "42",
          files: ["result.json"],
        },
      ],
    };
    assert.equal(reviewVerdict(f.spec, r), "approve");
    r.checks[0].status = "fail";
    assert.equal(reviewVerdict(f.spec, r), "reject");
    r.checks[0].status = "uncertain";
    assert.equal(reviewVerdict(f.spec, r), "abstain");
    r.checks[0].files = [];
    assert.throws(() => reviewVerdict(f.spec, r));
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});

import { reconcileExecutions } from "../workforce/runner.mjs";
test("restart closes the original desktop execution and never issues another input", async () => {
  const d = tmp();
  let j = new Journal(d);
  j.start("orphan", H, H, "agent");
  j.append("orphan", "execution", {
    executionId: "11111111-1111-4111-8111-111111111111",
    nodeId: "n",
  });
  j.close();
  j = new Journal(d);
  const calls = [];
  try {
    const g = {
      node: async () => ({}),
      invoke: async (command, params, id) => {
        calls.push({ command, params, id });
        return { ok: true };
      },
    };
    const result = await reconcileExecutions({ dataDir: d, nodeId: "n" }, j, g);
    assert.equal(result.replayedActions, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.action, "__close_execution");
    assert.equal(
      calls[0].params.executionId,
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(j.pendingExecutions().length, 0);
    assert.equal(j.report().runs[0].status, "interrupted");
  } finally {
    j.close();
    fs.rmSync(d, { recursive: true });
  }
});
test("recovery never retargets an orphaned action to a different Mac", async () => {
  const d = tmp(),
    j = new Journal(d);
  j.start("orphan", H, H, "agent");
  j.append("orphan", "execution", {
    executionId: "11111111-1111-4111-8111-111111111111",
    nodeId: "n",
  });
  try {
    await assert.rejects(
      () =>
        reconcileExecutions({ dataDir: d, nodeId: "other" }, j, {
          node: () => assert.fail("transport must not run"),
        }),
      /NODE_CHANGED/,
    );
  } finally {
    j.close();
    fs.rmSync(d, { recursive: true });
  }
});
test("daily limits include failed jobs and survive service restart", () => {
  const d = tmp();
  let j = new Journal(d);
  j.start("a", H, H, "agent", "pilot", 1);
  j.finish("a", "failed");
  j.close();
  j = new Journal(d);
  try {
    assert.throws(() => j.start("b", H, H, "agent", "pilot", 1), /DAILY_LIMIT/);
  } finally {
    j.close();
    fs.rmSync(d, { recursive: true });
  }
});
test("changing a Node delivery invalidates its previously signed grant", () => {
  const d = tmp(),
    f = fixture(d, 29501, "reviewer");
  try {
    const original = { value: 42 },
      g = signGrant(
        grantBody(f.c, f.spec, { delivery: original }),
        f.operator.privateKey,
      );
    checkGrant(f.c, f.spec, g, { delivery: original });
    assert.throws(
      () => checkGrant(f.c, f.spec, g, { delivery: { value: 43 } }),
      /GRANT_SCOPE/,
    );
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});

import { runNative } from "../workforce/runner.mjs";
test("daily monetary reservations retain failed work and use exact micro-USDC arithmetic", () => {
  const d = tmp(),
    j = new Journal(d);
  try {
    j.start("a", H, H, "agent", "pilot", 20, "0.100001", "0.200001");
    j.finish("a", "failed");
    assert.throws(
      () => j.start("b", H, H, "agent", "pilot", 20, "0.100001", "0.200001"),
      /DAILY_COST_LIMIT/,
    );
    assert.equal(j.report().runs[0].reserved_cost_usdc, "0.100001");
    j.reconcileCost("a", "0.200001", H);
    j.now = () => Date.now() + 86400001;
    assert.throws(
      () => j.start("b", H, H, "agent", "pilot", 20, "0.100001", "1"),
      /COST_RESERVE_UNDERESTIMATED/,
    );
  } finally {
    j.close();
    fs.rmSync(d, { recursive: true });
  }
});
test("a job whose cost allowance is below its complete reservation never calls a model", async () => {
  const d = tmp(),
    f = fixture(d);
  try {
    f.spec.budget.maxAgentCostUSDC = "0.01";
    f.resign();
    await assert.rejects(
      () =>
        runNative(f.c, f.packet, {
          allowTestPlatform: true,
          gatewayFactory: () =>
            assert.fail("No provider call before budget admission"),
        }),
      /JOB_COST_LIMIT/,
    );
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
