import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dashboard } from "../src/dashboard.mjs";
import { Store } from "../src/store.mjs";
import { DEFAULT, validateConfig, rpcURL, binding } from "../src/config.mjs";
test("configuration refuses missing scope, unknown fields, unsafe RPC and unbounded policy", () => {
  const c = structuredClone(DEFAULT);
  validateConfig(c);
  assert.throws(
    () => validateConfig(c, process.cwd(), { ready: true }),
    /SETUP_INCOMPLETE/,
  );
  assert.throws(
    () => validateConfig({ ...c, executeAnything: true }),
    /CONFIG_UNKNOWN_FIELD/,
  );
  assert.throws(
    () => validateConfig({ ...c, confirmations: 1 }),
    /CONFIRMATIONS/,
  );
  assert.throws(() =>
    validateConfig({ ...c, limits: { ...c.limits, maxBondUSDC: "Infinity" } }),
  );
  const env = "AGI_NODE_TEST_RPC";
  process.env[env] = "http://example.com/key";
  assert.throws(() => rpcURL({ ...c, rpcEnv: env }), /RPC_REQUIRES/);
  delete process.env[env];
  assert.notEqual(binding(c, {}), binding({ ...c, port: 9999 }, {}));
});
test("private dashboard requires bearer token and rejects foreign host/origin/method", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-ui-")),
    s = new Store(dir);
  let ui;
  try {
    ui = await dashboard(s, 18787);
    const u = new URL(ui.url),
      base = u.origin,
      token = u.hash.slice(1),
      auth = { Authorization: "Bearer " + token };
    assert.equal((await fetch(base + "/api/status")).status, 401);
    assert.equal(
      (await fetch(base + "/api/status", { headers: auth })).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/status", {
          headers: { ...auth, Origin: "https://attacker.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        const req = http.get(
          base + "/api/status",
          { headers: { ...auth, Host: "attacker.example:18787" } },
          (r) => {
            r.resume();
            resolve(r.statusCode);
          },
        );
        req.on("error", reject);
      }),
      403,
    );
    assert.equal(
      (await fetch(base + "/api/status", { method: "POST", headers: auth }))
        .status,
      403,
    );
    const page = await fetch(base);
    assert.match(
      page.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal((await fetch(base + "/node.config.json")).status, 404);
    assert.equal(
      JSON.stringify(
        await (await fetch(base + "/api/status", { headers: auth })).json(),
      ).includes("raw"),
      false,
    );
  } finally {
    await new Promise((resolve) => (ui ? ui.server.close(resolve) : resolve()));
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
