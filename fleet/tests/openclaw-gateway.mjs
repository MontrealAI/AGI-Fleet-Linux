// Actual pinned gateway + local synthetic model transport; no external inference.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { profileConfig, OPENCLAW_VERSION } from "../ops/openclaw.mjs";
import { modelReview } from "../ops/evidence.mjs";
import { Store } from "../ops/store.mjs";
import { temp, config } from "./helpers.mjs";
const binary = process.env.OPENCLAW_BIN;
assert.ok(binary, "Set OPENCLAW_BIN to the OpenClaw 2026.9.5 executable.");
const home = temp(),
  store = new Store(path.join(home, "service")),
  token = crypto.randomBytes(32).toString("hex");
const env = Object.fromEntries(
  [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "SHELL",
  ]
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
Object.assign(env, {
  OPENCLAW_STATE_DIR: path.join(home, "openclaw"),
  OPENCLAW_CONFIG_PATH: path.join(home, "openclaw.json"),
  OPENCLAW_SKIP_CHANNELS: "1",
});
let requests = 0,
  child,
  logs = "";
const model = http.createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  assert.ok(!body.tools?.length, "no model tools");
  requests++;
  const answer = '{"verdict":"consistent"}';
  if (body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choices of [
      [
        {
          index: 0,
          delta: { role: "assistant", content: answer },
          finish_reason: null,
        },
      ],
      [{ index: 0, delta: {}, finish_reason: "stop" }],
    ])
      res.write(
        "data: " +
          JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices,
          }) +
          "\n\n",
      );
    res.end("data: [DONE]\n\n");
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: "fixture",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: answer },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      }),
    );
  }
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const probe = net.createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
try {
  const version = spawnSync(binary, ["--version"], { env, encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.ok(version.stdout.includes(OPENCLAW_VERSION));
  const validated = [];
  for (const role of ["employer", "evidence", "moderator", "recovery"]) {
    const p = profileConfig(
      { role, model: "fixture/model", port, token },
      path.join(home, role),
    );
    fs.mkdirSync(p.agents.entries["agi-" + role].workspace);
    p.models = {
      mode: "replace",
      providers: {
        fixture: {
          baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
          apiKey: "local-fixture",
          api: "openai-completions",
          models: [
            {
              id: "model",
              name: "Local transport fixture",
              reasoning: false,
              input: ["text"],
              contextWindow: 32000,
              maxTokens: 1024,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    };
    fs.writeFileSync(env.OPENCLAW_CONFIG_PATH, JSON.stringify(p), {
      mode: 0o600,
    });
    const v = spawnSync(binary, ["config", "validate"], {
      env,
      encoding: "utf8",
    });
    assert.equal(v.status, 0, v.stderr);
    validated.push(role);
  }
  child = spawn(binary, ["gateway", "run", "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (v) => {
      logs = (logs + v).slice(-24000);
    });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let n = 0; n < 200; n++) {
    if (child.exitCode !== null)
      throw Error(logs.replaceAll(token, "REDACTED"));
    try {
      const r = await fetch(base + "/v1/models", {
        signal: AbortSignal.timeout(300),
      });
      if (r.status === 401) {
        ready = true;
        break;
      }
      await r.body?.cancel();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "Gateway not ready: " + logs.replaceAll(token, "REDACTED"));
  const result = await modelReview(
    config("recovery", { gatewayURL: base, gatewayAgent: "agi-recovery" }),
    token,
    { public: "fixture evidence", formalDecision: "approve" },
    store,
  );
  assert.equal(result.verdict, "consistent");
  assert.equal(requests, 1);
  const report = {
    passed: true,
    openclaw: OPENCLAW_VERSION,
    validatedRoles: validated,
    actualGateway: true,
    syntheticModelTransport: true,
    toolsOffered: 0,
    unauthenticatedRequestsRejected: true,
    realModelJudgmentTested: false,
  };
  fs.writeFileSync(
    new URL("../evidence/openclaw-gateway.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (e) {
  console.error(logs.replaceAll(token, "REDACTED"));
  throw e;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => child.once("exit", r)),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await new Promise((r) => model.close(r));
  store.close();
  fs.rmSync(home, { recursive: true, force: true });
}
