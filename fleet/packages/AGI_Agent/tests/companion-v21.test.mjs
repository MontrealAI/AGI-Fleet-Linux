import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Companion,
  COMPANION_DEFAULT,
  safeSnapshot,
  parseAnswer,
  validateCompanion,
} from "../src/control/companion.mjs";
import { Controller } from "../src/control/controller.mjs";
import { createControlServer } from "../src/control/server.mjs";
import { profileConfig } from "../src/control/openclaw-profile.mjs";
import { DECLARATION } from "../src/review.mjs";
import { DEFAULT, validateConfig, binding } from "../src/config.mjs";
import { sampleSpec, goodDelivery } from "./fixtures.mjs";
const token = "x".repeat(64),
  password = "Test-only private password 123!";
const answer = (value) =>
  Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(value) },
      },
    ],
  });
function harness(fetchImpl = async () => answer({ status: "ready" })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-companion-"));
  let now = 1800000000000,
    calls = [];
  const c = new Companion(dir, () => token, {
    now: () => now,
    fetchImpl: async (...args) => {
      calls.push(args);
      return fetchImpl(...args);
    },
  });
  const setup = () =>
    c.configure({ ...COMPANION_DEFAULT, enabled: true, acknowledged: true });
  return {
    c,
    dir,
    setup,
    calls,
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    close: async () => {
      await c.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("configuration round trip retains activation binding and rejects malformed AI settings", () => {
  const old = validateConfig(structuredClone(DEFAULT), "/tmp/agi-config-test");
  const b = binding(old, { manager: "fixture" });
  const roundtrip = validateConfig(
    JSON.parse(JSON.stringify(old)),
    "/tmp/agi-config-test",
  );
  assert.equal(binding(roundtrip, { manager: "fixture" }), b);
  assert.throws(
    () =>
      validateConfig({
        ...old,
        execution: { ...old.execution, publicDataOnly: "yes" },
      }),
    /CONFIG_EXECUTION/,
  );
  assert.throws(() =>
    validateCompanion({ ...COMPANION_DEFAULT, port: "18892" }),
  );
  assert.throws(() =>
    validateCompanion({ ...COMPANION_DEFAULT, agent: "../main" }),
  );
  assert.throws(() =>
    validateCompanion({ ...COMPANION_DEFAULT, url: "https://evil.test" }),
  );
});
test("status payload excludes all free text, identities, evidence, secrets and stale eligibility", () => {
  const secret = "PRIVATE_FIXTURE_DO_NOT_SHARE";
  const snapshot = safeSnapshot({
    config: { chainId: 1, validator: secret, manager: secret },
    mode: secret,
    unlocked: true,
    health: { checkedAt: "2000-01-01", eligible: true, usdc: secret },
    jobs: [{ review: secret }],
    runtime: { message: secret },
    incidents: [{ code: secret }],
    budgets: { gasUsedETH: secret, bondUsedUSDC: "2.0" },
    counts: [
      { status: secret, count: 1 },
      { status: "assigned", count: 8 },
    ],
  });
  assert.ok(!JSON.stringify(snapshot).includes(secret));
  assert.equal(snapshot.agentEligible, null);
  assert.equal(snapshot.counts.assigned, 8);
  assert.equal(snapshot.mode, "stopped");
  assert.equal(snapshot.budgets.gasUsedETH, null);
});
test("gateway uses a stateless dedicated agent, no client tools or provider overrides; quota and cache survive restart", async () => {
  const h = harness(async (url, req) => {
    const recorded = JSON.parse(fs.readFileSync(h.c.stateFile));
    assert.equal(
      recorded.calls.length,
      1,
      "quota must persist before dispatch",
    );
    assert.equal(url, "http://127.0.0.1:18892/v1/chat/completions");
    assert.equal(req.redirect, "error");
    assert.equal(req.headers.Authorization, "Bearer " + token);
    const body = JSON.parse(req.body);
    assert.equal(body.model, "openclaw/agi-agent");
    assert.equal(body.user, undefined);
    assert.deepEqual(body.tools, []);
    assert.equal(body.tool_choice, "none");
    assert.equal(req.headers["x-openclaw-model"], undefined);
    assert.ok(!req.body.includes(token));
    return answer({ summary: "The node is stopped.", attention: "check_node" });
  });
  try {
    await h.setup();
    const first = await h.c.request("brief", { mode: "stopped" });
    const next = await h.c.request("brief", { mode: "stopped" });
    assert.equal(first.cached, false);
    assert.equal(next.cached, true);
    assert.equal(h.calls.length, 1);
    const restarted = new Companion(h.dir, () => token, {
      now: h.now,
      fetchImpl: () => {
        throw Error("must be cached");
      },
    });
    assert.equal(
      (await restarted.request("brief", { mode: "stopped" })).cached,
      true,
    );
    assert.equal(restarted.status().calls24h, 1);
    assert.ok(!fs.readFileSync(h.c.stateFile, "utf8").includes(token));
  } finally {
    await h.close();
  }
});
test("duplicate requests coalesce, different concurrent work waits, and cancellation discards the response", async () => {
  let release;
  const h = harness(
    async () =>
      new Promise((resolve) => {
        release = () => resolve(answer({ status: "ready" }));
      }),
  );
  try {
    await h.setup();
    const one = h.c.request("test", {}),
      two = h.c.request("test", {});
    await assert.rejects(h.c.request("brief", {}), /COMPANION_BUSY/);
    release();
    await Promise.all([one, two]);
    assert.equal(h.calls.length, 1);
    h.advance(31000);
    const pending = h.c.request("test", { other: true });
    const cancelled = h.c.cancel();
    release();
    await assert.rejects(pending, /COMPANION_CANCELLED/);
    await cancelled;
    assert.equal(h.c.state.cache.length, 1);
  } finally {
    await h.close();
  }
});
test("rolling daily cap counts failures, survives restart and resists backwards clock changes", async () => {
  const h = harness();
  try {
    await h.c.configure({
      ...COMPANION_DEFAULT,
      enabled: true,
      acknowledged: true,
      maxCalls24h: 1,
    });
    await h.c.request("test", {});
    h.advance(31000);
    await assert.rejects(
      h.c.request("test", { new: true }),
      /COMPANION_DAILY_LIMIT/,
    );
    h.advance(-400000);
    await assert.rejects(h.c.request("test", {}), /COMPANION_CLOCK_CHANGED/);
    h.advance(86400000 + 400001);
    await h.c.request("test", { new: true });
    assert.equal(h.calls.length, 2);
  } finally {
    await h.close();
  }
});
test("429 retry-after persists and upstream secret-bearing errors never enter status or disk", async () => {
  const h = harness(
    async () =>
      new Response("SECRET_FROM_UPSTREAM", {
        status: 429,
        headers: { "Retry-After": "3600" },
      }),
  );
  try {
    await h.setup();
    await assert.rejects(h.c.request("test", {}), /COMPANION_RATE_LIMITED/);
    assert.equal(h.c.state.nextAt, h.now() + 3600000);
    assert.ok(!JSON.stringify(h.c.status()).includes("SECRET_FROM_UPSTREAM"));
    h.advance(60000);
    await assert.rejects(h.c.request("test", {}), /COMPANION_COOLDOWN/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.c.status().calls24h, 1);
  } finally {
    await h.close();
  }
});
test("malformed, duplicate-key, unknown-field and executable AI outputs cannot satisfy review", () => {
  for (const text of [
    '{"verdict":"approve"}',
    '{"verdict":"consistent","transfer":true}',
    '{"verdict":"concern","verdict":"consistent"}',
    '```json\n{"verdict":"consistent"}\n```',
    '{"verdict":null}',
  ])
    assert.throws(() => parseAnswer("review", text));
  assert.equal(
    parseAnswer("review", '{"verdict":"uncertain"}').verdict,
    "uncertain",
  );
});
test("tool calls, truncated responses, redirects and oversized payloads fail closed", async () => {
  for (const result of [
    {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: '{"status":"ready"}',
            tool_calls: [{ function: { name: "send_money" } }],
          },
        },
      ],
    },
    {
      choices: [
        {
          finish_reason: "length",
          message: { role: "assistant", content: '{"status":"ready"}' },
        },
      ],
    },
    {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: '{"status":"ready"}',
            function_call: { name: "exec" },
          },
        },
      ],
    },
    { padding: "a".repeat(66000) },
  ]) {
    const h = harness(async () => Response.json(result));
    try {
      await h.setup();
      await assert.rejects(h.c.request("test", {}), /COMPANION_/);
    } finally {
      await h.close();
    }
  }
  const h = harness(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.test" },
      }),
  );
  try {
    await h.setup();
    await assert.rejects(
      h.c.request("test", { text: "a".repeat(25000) }),
      /INPUT_LIMIT/,
    );
    assert.equal(h.calls.length, 0);
    await assert.rejects(h.c.request("test", {}), /UNAVAILABLE/);
  } finally {
    await h.close();
  }
});
test("timeout releases the single request slot and records backoff", async () => {
  const h = harness(
    async (_, req) =>
      new Promise((_, reject) =>
        req.signal.addEventListener(
          "abort",
          () => reject(Error("fixture timeout")),
          { once: true },
        ),
      ),
  );
  try {
    await h.c.configure({
      ...COMPANION_DEFAULT,
      enabled: true,
      acknowledged: true,
      timeoutMs: 1000,
    });
    await assert.rejects(h.c.request("test", {}), /UNAVAILABLE/);
    assert.equal(h.c.pending, null);
    assert.equal(h.c.state.calls.length, 1);
    assert.ok(h.c.state.nextAt > h.now());
  } finally {
    await h.close();
  }
});
test("corrupt AI state disables its connection without dropping or rewriting history", async () => {
  const h = harness();
  try {
    fs.writeFileSync(h.c.stateFile, "broken");
    const other = new Companion(h.dir, () => token);
    assert.equal(other.status().lastError, "COMPANION_STATE_INVALID");
    await assert.rejects(other.request("test", {}), /STATE_INVALID/);
    assert.equal(fs.readFileSync(h.c.stateFile, "utf8"), "broken");
  } finally {
    await h.close();
  }
});
test("generated OpenClaw profile denies all tools and has one named OAuth profile without model fallbacks", () => {
  const c = profileConfig(
    {
      schema: "agi-agent-openclaw-setup/v1",
      openclawVersion: "2026.9.5",
      token: "a".repeat(64),
      port: 18892,
      agent: "agi-agent",
      model: "openai/gpt-6-astra",
    },
    "/tmp/companion-workspace",
  );
  assert.deepEqual(c.tools.deny, ["*"]);
  assert.deepEqual(c.agents.entries["agi-agent"].tools.deny, ["*"]);
  assert.deepEqual(c.auth.order.openai, ["openai:agi-agent-pro"]);
  assert.equal(c.auth.profiles["openai:agi-agent-pro"].mode, "oauth");
  assert.deepEqual(c.agents.defaults.model.fallbacks, []);
  assert.equal(c.gateway.bind, "loopback");
  assert.deepEqual(c.plugins.allow, ["openai", "codex"]);
  assert.equal(c.plugins.slots.memory, "none");
});
test("encrypted backup preserves AI credentials and request accounting; restore disables AI and revokes read access", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-ai-backup-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "agi-ai-restore-"));
  const c = new Controller(dir, {
      companion: { fetchImpl: async () => answer({ status: "ready" }) },
    }),
    r = new Controller(target);
  try {
    await c.createVault(password);
    const kit = await c.companionKit({ acknowledge: true });
    await c.wallet("create");
    await c.companionTest();
    const access = c.createReadAccess();
    const backup = await c.backup(password);
    assert.ok(!JSON.stringify(backup).includes(kit.token));
    await r.restore(backup, password, true);
    assert.equal(r.vault.get("openclawToken"), kit.token);
    assert.equal(r.companion.status().calls24h, 1);
    assert.equal(r.companion.config.enabled, false);
    assert.equal(r.companion.config.autoBrief, false);
    assert.equal(r.companion.status().connected, false);
    assert.equal(r.companion.acceptsReadToken(access.token), false);
  } finally {
    await c.close();
    await r.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
test("controller encrypts gateway token; read-only credential cannot read operator status, launch or mutate", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agi-companion-controller-"),
  );
  const c = new Controller(dir),
    ui = await createControlServer(c, { port: 0 });
  const origin = `http://127.0.0.1:${ui.port}`;
  try {
    await c.createVault(password);
    const kit = await c.companionKit({ acknowledge: true });
    const status = JSON.stringify(c.status());
    assert.ok(!status.includes(kit.token));
    assert.ok(!fs.readFileSync(c.vault.file, "utf8").includes(kit.token));
    const access = c.createReadAccess();
    const headers = { Authorization: "Bearer " + access.token };
    assert.equal(
      (await fetch(origin + "/api/companion/status", { headers })).status,
      200,
    );
    assert.equal(
      (
        await fetch(origin + "/api/companion/status", {
          headers: { Authorization: "Bearer " + kit.token },
        })
      ).status,
      401,
    );
    assert.equal(
      (await fetch(origin + "/api/status", { headers })).status,
      401,
    );
    for (const route of [
      "/api/pause",
      "/api/start",
      "/api/unlock",
      "/api/launch",
    ]) {
      const r = await fetch(origin + route, {
        method: "POST",
        headers: {
          ...headers,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(r.status, 401);
    }
    assert.equal(
      (await fetch(origin + "/api/companion/status?token=" + access.token))
        .status,
      400,
    );
    const newer = c.createReadAccess();
    assert.notEqual(newer.token, access.token);
    assert.equal(
      (await fetch(origin + "/api/companion/status", { headers })).status,
      401,
    );
    c.revokeReadAccess();
    assert.equal(c.companion.acceptsReadToken(newer.token), false);
    await c.lock();
    await assert.rejects(c.companionBrief(), /NODE_LOCKED/);
  } finally {
    await c.close();
    await ui.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('general workstation response transports a native bundle larger than the legacy 10 MiB response cap',async()=>{
 const content='x'.repeat(11000000);
 const h=harness(async (url,options)=>url.endsWith('/health')?Response.json({policyCurrent:true,protocol:'agi-compute/v2',role:'agent',uid:(process.getuid?.()??0)+1001,tools:true,gatewayReady:true,auth:'chatgpt-oauth',policyHash:'a'.repeat(64),capabilities:['browser','desktop','files']}):answer(options.headers['x-agi-kind']==='test'?{status:'ready'}:{status:'complete',content}));
 try{await h.c.configure({...COMPANION_DEFAULT,enabled:true,acknowledged:true,mode:'workstation'});await h.c.request('test',{});h.advance(100000);const result=await h.c.request('generate',{specification:{},attempt:1});assert.equal(result.content.length,content.length);assert.equal(h.c.state.cache.some(x=>x.value.content===content),false);}finally{await h.close();}
});
