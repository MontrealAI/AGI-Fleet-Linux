import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fixture } from "./workforce-fixture.mjs";
import { atomic, digest, Journal, createIdentity } from "../workforce/core.mjs";
import {
  nativeRuntime,
  grantBody,
  signGrant,
  runNative,
} from "../workforce/runner.mjs";
import {
  signAuthority,
  checkAuthority,
  checkNativePermission,
  verifyReceipt,
} from "../workforce/authority.mjs";
import { recipientId } from "../workforce/envelope.mjs";
import core from "../workforce/core/computer-work.cjs";
import { nativeV3 } from "./workforce-v3-fixture.mjs";
function gateway(f, plan, actions) {
  return () => ({
    hello: { server: { version: "2026.9.5" } },
    connect: async () => {},
    close() {},
    node: async () => ({
      computerUse: {
        provider: { generation: "one" },
        actions: ["screenshot", "type"],
      },
    }),
    invoke: async (cmd, p) => {
      actions.push(p.action ?? "screenshot");
      return cmd === "screen.snapshot"
        ? {
            displayFrameId: crypto.randomUUID(),
            width: 100,
            height: 100,
            base64: Buffer.from("fixture").toString("base64"),
            format: "png",
          }
        : { ok: true };
    },
    plan,
  });
}
test("v3 resumes a committed encrypted checkpoint without resetting calls, actions, cost or start time", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-resume-")),
    f = nativeV3(dir),
    abort = new AbortController(),
    actions = [];
  let calls = 0;
  try {
    await assert.rejects(
      runNative(f.c, f.packet, {
        allowTestPlatform: true,
        resumeKey: f.recipient.privateKey,
        signal: abort.signal,
        gatewayFactory: gateway(
          f,
          async () => {
            if (++calls === 1)
              return { answer: { action: "type", args: { text: "fixture" } } };
            abort.abort();
            abort.signal.throwIfAborted();
          },
          actions,
        ),
      }),
    );
    const run = "job-" + digest(f.packet.grant.body);
    let j = new Journal(f.c.dataDir, { observer: true }),
      prior = j.row(run);
    assert.equal(prior.status, "interrupted");
    assert.equal(prior.model_calls, 2);
    j.close();
    const result = await runNative(f.c, f.packet, {
      allowTestPlatform: true,
      resumeKey: f.recipient.privateKey,
      gatewayFactory: gateway(
        f,
        async (messages) => {
          assert(
            messages.some(
              (m) =>
                typeof m.content === "string" &&
                m.content.includes("resumed execution"),
            ),
          );
          const job = JSON.parse(messages[1].content);
          atomic(path.join(job.outputDirectory, "result.json"), '{"value":42}');
          return { answer: { finished: true, review: null } };
        },
        actions,
      ),
    });
    assert.equal(result.status, "complete");
    assert.equal(actions.filter((x) => x === "type").length, 1);
    j = new Journal(f.c.dataDir, { observer: true });
    const after = j.row(run);
    assert.equal(after.started, prior.started);
    assert.equal(after.reserved_cost_usdc, prior.reserved_cost_usdc);
    assert.equal(after.model_calls, 3);
    assert.equal(after.actions, 3);
    j.close();
    verifyReceipt(f.c, result.receipt, {
      grantSha256: digest(f.packet.grant.body),
      specSha256: core.digest(f.spec),
      runtimeSha256: core.digest(nativeRuntime(f.c)),
      encryptedSha256: result.encryptedSha256,
    });
    const forged = structuredClone(result.receipt);
    forged.body.encryptedSha256 = "0".repeat(64);
    assert.throws(() => verifyReceipt(f.c, forged, {}), /SIGNED_RECORD/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("an unresolved desktop mutation cannot resume or reset its reserved allowance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-resume-"));
  try {
    const j = new Journal(dir);
    j.start(
      "run",
      "a".repeat(64),
      "b".repeat(64),
      "agent",
      "pilot",
      10,
      "1",
      "10",
    );
    j.checkpoint("run", "c".repeat(64));
    j.reserve("run", { action: "type" }, { maxActions: 2 });
    j.finish("run", "interrupted");
    assert.throws(
      () => j.resume("run", "a".repeat(64), "b".repeat(64), "agent", 2),
      /UNRECONCILED_INPUT/,
    );
    assert.equal(j.row("run").actions, 1);
    j.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("signed revocation interrupts an outstanding model call before any later input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-revoke-")),
    f = nativeV3(dir),
    actions = [];
  try {
    const started = Date.now();
    await assert.rejects(
      runNative(f.c, f.packet, {
        allowTestPlatform: true,
        resumeKey: f.recipient.privateKey,
        gatewayFactory: gateway(
          f,
          async (m, signal) => {
            atomic(
              f.c.revocationFile,
              signAuthority(
                { ...f.authority, sequence: 2, disabled: true },
                f.operator.privateKey,
              ),
            );
            return await new Promise((resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              }),
            );
          },
          actions,
        ),
      }),
      /REVOKED/,
    );
    assert(Date.now() - started < 2000);
    assert(!actions.includes("type"));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("revocation rollback, private provider mismatch, and unsupported fine-grained authority fail closed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-authority-")),
    f = nativeV3(dir);
  try {
    const j = new Journal(f.c.dataDir);
    checkAuthority(f.c, f.packet.grant.body, j);
    atomic(
      f.c.revocationFile,
      signAuthority({ ...f.authority, sequence: 0 }, f.operator.privateKey),
    );
    assert.throws(
      () => checkAuthority(f.c, f.packet.grant.body, j),
      /ROLLBACK/,
    );
    j.close();
    f.spec.permissions.agent.enforcement = "broker-scoped";
    assert.throws(
      () => checkNativePermission(f.spec, "agent", "type"),
      /BROKER/,
    );
    f.spec.permissions.agent.enforcement = "observe-only";
    assert.throws(
      () => checkNativePermission(f.spec, "agent", "type"),
      /READ_ONLY/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("changing an enrolled application invalidates the already signed runtime before a provider request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-app-pin-")),
    f = nativeV3(dir);
  try {
    f.c.applications = [
      {
        bundleId: "com.example.Editor",
        path: "/Applications/Editor.app",
        installationSha256: "a".repeat(64),
      },
    ];
    await assert.rejects(
      runNative(f.c, f.packet, {
        allowTestPlatform: true,
        gatewayFactory: () => assert.fail("changed runtime cannot connect"),
      }),
      /RUNTIME_CHANGED/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("drag validates both ends against the observed display before a mutation", async () => {
  const { NativeSession } = await import("../workforce/native.mjs");
  const s = new NativeSession({}, {}, "run", {});
  s.frame = { width: 100, height: 100, at: Date.now() };
  assert.throws(
    () =>
      s.validate(
        "left_click_drag",
        { fromX: 101, fromY: 10, x: 50, y: 50, durationMs: 500 },
        { actions: ["left_click_drag"] },
      ),
    /COORDINATES/,
  );
  assert.equal(
    s.validate(
      "left_click_drag",
      { fromX: 10, fromY: 10, x: 50, y: 50, durationMs: 500 },
      { actions: ["left_click_drag"] },
    ).x,
    50,
  );
});
