import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  profileConfig,
  OPENCLAW_VERSION,
} from "../src/control/openclaw-profile.mjs";
import {computeProfile} from "../compute/profile.mjs";
const binary = process.env.OPENCLAW_BIN;
assert.ok(
  binary,
  "Set OPENCLAW_BIN to an installed OpenClaw 2026.9.5 executable.",
);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-openclaw-actual-"));
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: home,
  OPENCLAW_CONFIG_PATH: path.join(home, "openclaw.json"),
  OPENCLAW_SKIP_CHANNELS: "1",
};
for (const k of [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_PASSWORD",
])
  delete env[k];
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const token = crypto.randomBytes(32).toString("hex");
const workspace=path.join(home,"workspace");fs.mkdirSync(workspace);fs.mkdirSync(path.join(workspace,"review"));
const config=computeProfile({token,port,model:"openai/gpt-6-astra",workspace,imageID:"sha256:"+"b".repeat(64),workstation:true,role:process.env.COMPUTE_ROLE??'agent',jobRoot:path.join(home,'jobs'),inputRoot:path.join(workspace,'job-input'),browserImageID:'sha256:'+'c'.repeat(64)});
fs.writeFileSync(env.OPENCLAW_CONFIG_PATH, JSON.stringify(config), {
  mode: 0o600,
});
let child,
  logs = "";
try {
  const version = spawnSync(binary, ["--version"], { env, encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.ok(version.stdout.includes(OPENCLAW_VERSION));
  const validated = spawnSync(binary, ["config", "validate"], {
    env,
    encoding: "utf8",
  });
  assert.equal(validated.status, 0, validated.stderr);
  const agent=(process.env.COMPUTE_ROLE??"agent")==="agent"?"agi-creator":"agi-reviewer",sessionKey=`agent:${agent}:agi-work-12345678-1234-1234-1234-123456789012`;
  const explained=spawnSync(binary,['sandbox','explain','--agent',agent,'--session',sessionKey,'--json'],{env,encoding:'utf8'});assert.equal(explained.status,0,explained.stderr);const policy=JSON.parse(explained.stdout);assert.equal(policy.sandbox.workspaceAccess,'none');assert.equal(policy.sandbox.sessionIsSandboxed,true);assert.equal(policy.sandbox.backend,'docker');assert.ok(policy.sandbox.effectiveHostWorkspaceRoot.startsWith(path.join(home,'jobs')+path.sep));
  child = spawn(binary, ["gateway", "run", "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (v) => {
    logs = (logs + v).slice(-30000);
  });
  child.stderr.on("data", (v) => {
    logs = (logs + v).slice(-30000);
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 900; i++) {
    if (child.exitCode !== null)
      throw Error(
        "OpenClaw exited before readiness: " +
          logs.replaceAll(token, "[redacted]"),
      );
    try {
      const r = await fetch(base + "/v1/models", {
        signal: AbortSignal.timeout(500),
      });
      if (r.status === 401) {
        ready = true;
        break;
      }
      await r.body?.cancel();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(
    ready,
    "OpenClaw did not become ready: " + logs.replaceAll(token, "[redacted]"),
  );
  const unauthorized = await fetch(base + "/v1/models");
  assert.equal(unauthorized.status, 401);
  await unauthorized.body.cancel();
  const response = await fetch(base + "/v1/models", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(response.status, 200);
  const models = await response.json();
  assert.equal(models.data.some((m) => m.id === "openclaw/agi-creator"),(process.env.COMPUTE_ROLE??"agent")==="agent");
  assert.ok(models.data.some((m) => m.id === "openclaw/agi-reviewer"));
  assert.ok(models.data.some((m) => m.id === "openclaw/agi-checker"));
  const missing = await fetch(base + "/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(missing.status, 401);
  await missing.body.cancel();
  // No authenticated inference request: this test uses no account or model credits.
  console.log(
    JSON.stringify(
      {
        openclaw: OPENCLAW_VERSION,
        configAccepted: true,
        actualGatewayStarted: true,
        unauthenticatedModelsRejected: true,
        authenticatedAgentCatalog: true,
        unauthenticatedInferenceRejected: true,
        nativeRuntimePinned: true,
        sandboxPolicyConfigured: true,
        actualSandboxExplainAccepted:true,
        role:process.env.COMPUTE_ROLE??"agent",
        actualSandboxExecution: false,
        liveOAuthTested: false,
        liveInferenceTested: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  fs.rmSync(home, { recursive: true, force: true });
}
