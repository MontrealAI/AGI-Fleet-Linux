import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Wallet } from "ethers";
import { Store } from "../ops/store.mjs";
import { openBackup, sealBackup } from "../packages/AGI_Node/src/control/vault.mjs";
import { Controller } from "../ops/controller.mjs";
import { createServer } from "../ops/server.mjs";
import { profileConfig } from "../ops/openclaw.mjs";
import { launchAgent } from "../ops/os.mjs";
import { modelReview } from "../ops/evidence.mjs";
import { config, temp } from "./helpers.mjs";
test("transaction journal survives restart without duplicate nonce", () => {
  const home = temp();
  let s = new Store(home);
  try {
    s.set("initialNonce", 7);
    s.reserve({
      hash: "0xabc",
      raw: "signed",
      nonce: 7,
      action: "refund",
      job: "8",
      gas_budget: "100",
      created: 1,
      binding: "binding",
    });
    s.close();
    s = new Store(home);
    assert.equal(s.pending().nonce, 7);
    assert.throws(() => s.reserve({ hash: "second", nonce: 8 }), /PENDING/);
    assert.equal(s.meta("initialNonce"), 7);
  } finally {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test("loopback server rejects missing auth, foreign origin and hostile Host", async () => {
  const home = temp(),
    c = new Controller(home, "evidence"),
    p = await createServer(c);
  try {
    assert.equal((await fetch(p.origin + "/api/status")).status, 403);
    assert.equal(
      (
        await fetch(p.origin + "/api/status", {
          headers: {
            Authorization: "Bearer " + p.token,
            Origin: "https://attacker.invalid",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        const req = http.get(
          p.origin + "/api/status",
          {
            headers: {
              Authorization: "Bearer " + p.token,
              Host: "attacker.invalid",
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
      }),
      403,
    );
    assert.equal(
      (
        await fetch(p.origin + "/api/status", {
          headers: { Authorization: "Bearer " + p.token },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(p.origin + "/api/pause", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + p.token,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      400,
    );
  } finally {
    await c.close();
    await new Promise((r) => p.server.close(r));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test("backup roundtrip preserves journal and restores with authority revoked", async () => {
  const a = temp(),
    b = temp(),
    c = new Controller(a, "evidence"),
    d = new Controller(b, "evidence");
  try {
    await c.unlock("a sufficiently long test password");
    c.config = config("evidence");
    c.store.set("fixture", { answer: 42 });
    const legacy = await openBackup(await c.backup("a sufficiently long test password"), "a sufficiently long test password");
    delete legacy.vaultPasswordMatchesBackup;
    delete legacy.configured;
    const bundle = await sealBackup(legacy, "different backup password long");
    await d.restore(bundle, "different backup password long");
    assert.deepEqual(d.store.meta("fixture"), { answer: 42 });
    assert.equal(d.store.meta("activation"), null);
    assert.equal(d.snapshot().paused, true);
    assert.equal(d.vault.unlocked, false);
    await d.unlock("a sufficiently long test password");
    assert.equal(d.vault.unlocked, true);
  } finally {
    await c.close();
    await d.close();
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
test("OpenClaw profile has no tools, browser or wallet access", () => {
  const p = profileConfig(
    {
      role: "moderator",
      model: "provider/model",
      token: "a".repeat(64),
      port: 18942,
    },
    "/private/isolated-workspace",
  );
  assert.deepEqual(p.tools.deny, ["*"]);
  assert.equal(p.browser.enabled, false);
  assert.equal(p.gateway.bind, "loopback");
  assert.deepEqual(p.agents.entries["agi-moderator"].skills, []);
  assert.ok(!JSON.stringify(p).includes("privateKey"));
});
test("launchd arguments are XML escaped and include no secrets", () => {
  const p = launchAgent(
    "/Users/Test & Name/home",
    "moderator",
    "/path with spaces/node",
  );
  assert.ok(p.includes("Test &amp; Name"));
  assert.ok(p.includes("--background"));
  assert.ok(!p.includes("privateKey"));
});
test("model responses are bounded and requests are durably counted", async () => {
  const home = temp(),
    s = new Store(home),
    c = config();
  try {
    const fetcher = async url =>url.endsWith('/health')?Response.json({role:'moderator',policyHash:'a'.repeat(64),policyCurrent:true,gatewayReady:true,stopped:false,uid:(process.getuid()??0)+1}):
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"verdict":"consistent"}' },
              finish_reason: "stop",
            },
          ],
          usage: { total_tokens: 40 },
        }),
      );
    assert.equal(
      (await modelReview(c, "a".repeat(64), { public: "data" }, s, fetcher))
        .verdict,
      "consistent",
    );
    assert.equal(s.stats().modelRequests24h, 1);
    await assert.rejects(
      modelReview(
        { ...c, maxModelRequests24h: 1 },
        "a".repeat(64),
        {},
        s,
        fetcher,
      ),
      /LIMIT/,
    );
    const bad = async url =>url.endsWith('/health')?Response.json({role:'moderator',policyHash:'a'.repeat(64),policyCurrent:true,gatewayReady:true,stopped:false,uid:(process.getuid()??0)+1}):
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"verdict":"consistent","transfer":"all"}' },
              finish_reason: "stop",
            },
          ],
        }),
      );
    await assert.rejects(modelReview(c, "a".repeat(64), {}, s, bad), /SCHEMA/);
  } finally {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
