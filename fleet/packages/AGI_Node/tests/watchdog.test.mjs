import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Watchdog, heartbeatURL } from "../fleet/watchdog.mjs";
import { plans } from "../fleet/supervised.mjs";
import { startMonitor } from "../fleet/monitor.mjs";
const ids = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
];
const cfg = {
  aliveURL: "https://heartbeat.example.org/PRIVATE_ALIVE_TOKEN",
  healthyURL: "https://heartbeat.example.org/PRIVATE_HEALTH_TOKEN",
  consent: true,
};
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-watchdog-")),
    calls = [];
  const w = new Watchdog(home, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response("ok");
    },
  });
  const report = () => ({
    actors: ids.map((id) => ({
      id,
      state: "healthy",
      checkedAt: new Date().toISOString(),
      status: { secret: "NEVER_SEND" },
    })),
    storageError: false,
  });
  return {
    home,
    w,
    calls,
    report,
    close: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}
test("external heartbeat setup is opt-in, HTTPS only, two distinct checks and a nonempty expected roster", () => {
  const x = fixture();
  try {
    assert.throws(() =>
      x.w.configure({ ...cfg, consent: false }, x.report().actors),
    );
    assert.throws(() => x.w.configure(cfg, []));
    assert.throws(() =>
      x.w.configure({ ...cfg, healthyURL: cfg.aliveURL }, x.report().actors),
    );
    for (const url of [
      "http://example.org/a",
      "https://127.0.0.1/a",
      "https://localhost/a",
      "https://host.local/a",
      "https://u:p@example.org/a",
      "https://example.org/a#fragment",
    ])
      assert.throws(() => heartbeatURL(url));
    x.w.configure(cfg, x.report().actors);
    assert.equal(x.w.summary(x.report().actors).enabled, true);
  } finally {
    x.close();
  }
});
test("healthy fleet sends empty heartbeats without browser, financial data, read tokens or redirect following", async () => {
  const x = fixture();
  try {
    x.w.configure(cfg, x.report().actors);
    await x.w.tick(x.report());
    assert.equal(x.calls.length, 2);
    for (const { options } of x.calls) {
      assert.equal(options.body, "");
      assert.equal(options.redirect, "error");
      assert.equal(options.method, "POST");
      assert.ok(!JSON.stringify(options).includes("NEVER_SEND"));
    }
    assert.equal(x.w.summary(x.report().actors).state, "accepted");
    assert.ok(
      !JSON.stringify(x.w.summary(x.report().actors)).includes("PRIVATE_"),
    );
    await x.w.tick(x.report());
    assert.equal(x.calls.length, 2);
    if (process.platform !== "win32")
      assert.equal(fs.statSync(x.w.file).mode & 0o777, 0o600);
    assert.equal(new Watchdog(x.home).summary(x.report().actors).enabled, true);
  } finally {
    x.close();
  }
});
test("unhealthy, stale, storage-failed and removed actors cannot send a healthy heartbeat", async () => {
  for (const mutate of [
    (r) => (r.actors[0].state = "offline"),
    (r) => (r.actors[0].checkedAt = "2000-01-01"),
    (r) => (r.storageError = true),
    (r) => r.actors.pop(),
    (r) => (r.actors = []),
  ]) {
    const x = fixture();
    try {
      x.w.configure(cfg, x.report().actors);
      const r = x.report();
      mutate(r);
      await x.w.tick(r);
      assert.deepEqual(
        x.calls.map((c) => c.url),
        [cfg.aliveURL],
      );
      assert.equal(x.w.summary(r.actors).healthyAcceptedAt, null);
    } finally {
      x.close();
    }
  }
});
test("failed heartbeat delivery is visible and disabling stops transmission", async () => {
  const x = fixture();
  try {
    x.w.configure(cfg, x.report().actors);
    x.w.fetch = async () => {
      throw Error("secret endpoint");
    };
    await x.w.tick(x.report());
    assert.equal(x.w.summary(x.report().actors).state, "delivery-failed");
    assert.equal(x.w.summary().aliveAcceptedAt, null);
    x.w.disable();
    x.w.fetch = async () => {
      throw Error("must not call");
    };
    await x.w.tick(x.report());
    assert.equal(x.w.summary().enabled, false);
  } finally {
    x.close();
  }
});
test("supervised plan uses fixed read-only ports, strict host keys, noninteractive SSH and escaped paths without a shell", () => {
  const p = plans({
    home: "/Users/monitor/private",
    root: "/Users/monitor/AGI & Ops/fleet",
    node: "/opt/homebrew/bin/node",
    key: "/Users/monitor/.ssh/id_monitor",
    agentHost: "mini.local",
    nodeHost: "node.local",
  });
  assert.equal(p.length, 3);
  assert.ok(p[0].args.includes("--service"));
  assert.match(p[0].plist, /AGI &amp; Ops/);
  for (const t of p.slice(1))
    for (const o of [
      "BatchMode=yes",
      "IdentitiesOnly=yes",
      "IdentityAgent=none",
      "StrictHostKeyChecking=yes",
      "ExitOnForwardFailure=yes",
    ])
      assert.ok(t.args.includes(o));
  assert.ok(p[1].args.includes("127.0.0.1:18788:127.0.0.1:8788"));
  assert.ok(p[2].args.includes("127.0.0.1:18787:127.0.0.1:8787"));
  assert.ok(
    p.every(
      (x) =>
        !x.args.includes("sh") &&
        x.plist.includes("<key>KeepAlive</key><true/>"),
    ),
  );
  assert.throws(() =>
    plans({
      home: "/tmp",
      root: "/tmp",
      node: "/node",
      key: "/key",
      agentHost: "a;touch /tmp/b",
      nodeHost: "node.local",
    }),
  );
});
test("background monitor reopens only with local launch secret; read token cannot manage alert endpoints", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-reopen-")),
    app = await startMonitor({ home, port: 0 });
  try {
    const origin = `http://127.0.0.1:${app.port}`,
      post = (route, body, token) =>
        fetch(origin + route, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(body),
        });
    assert.notEqual((await post("/api/reopen", {}, "wrong")).status, 200);
    assert.notEqual(
      (await post("/api/watchdog", cfg, "a".repeat(64))).status,
      200,
    );
    const opened = await (
      await post("/api/reopen", {}, app.launchSecret)
    ).json();
    assert.ok(opened.url.startsWith(origin + "/#"));
    assert.notEqual(
      (await post("/api/session", { token: app.url.split("#")[1] })).status,
      200,
    );
    const login = await post("/api/session", {
      token: opened.url.split("#")[1],
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const report = await (
      await fetch(origin + "/api/report", {
        headers: { Authorization: "Bearer " + token },
      })
    ).json();
    assert.ok(!JSON.stringify(report).includes(app.launchSecret));
    assert.equal(report.watchdog.enabled, false);
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
