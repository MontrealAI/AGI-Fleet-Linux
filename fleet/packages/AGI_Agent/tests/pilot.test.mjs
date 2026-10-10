import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pilot } from "../src/control/pilot.mjs";
import { supportedRuntime, VERSION } from "../src/version.mjs";
import { createControlServer } from "../src/control/server.mjs";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-pilot-"));
  let now = 1800000000000,
    scope = "fixture-scope";
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE txs(kind TEXT,status INTEGER,state TEXT,accounted INTEGER)",
  );
  const c = {
    home,
    vault: { unlocked: true },
    config: {
      chainId: 11155111,
      manager: "0x" + "1".repeat(40),
      agent: "0x" + "2".repeat(40),
    },
    pin: () => ({}),
    operations: { scope: () => scope },
    dbRead: (fn) => fn(db),
    companion: { acceptsReadToken: (t) => t === "r".repeat(64) },
    mutate: async (_label, work) => work(),
  };
  const pilot = (c.pilot = new Pilot(c, "agent", VERSION, () => now));
  const start = () => pilot.start({ label: "Sepolia fixture only" });
  const job = (id = "1", status = "settled-reviewed") => ({
    jobId: id,
    status,
    receipt: "0x" + "a".repeat(64),
    receivedUSDC: "1.000001",
    settledAt: now,
    evidence:
      "Fixture attestation: unrelated validator; payment and deferred claim checked.",
    attest: true,
  });
  return {
    c,
    pilot,
    db,
    home,
    start,
    job,
    advance: (ms) => (now += ms),
    scope: (s) => (scope = s),
    close() {
      db.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
test("runtime floor matches declared range rather than accepting any Node 24", () => {
  for (const v of ["24.19.0", "24.20.0"])
    assert.equal(supportedRuntime(v), true);
  for (const v of [
    "24.11.1",
    "24.18.9",
    "25.0.0",
    "26.1.0",
    "23.99.0",
    "24.19",
    "24.NaN.0",
  ])
    assert.equal(supportedRuntime(v), false);
});
test("pilot keeps paid-independent and buyer-only settlement separate and deduplicates corrections", () => {
  const x = fixture();
  try {
    x.start();
    x.advance(10000);
    x.pilot.job(x.job());
    x.pilot.job(x.job());
    x.pilot.job(x.job("2", "settled-other"));
    x.pilot.job(x.job("3", "failed"));
    const report = x.pilot.report(),
      run = report.runs[0];
    assert.equal(run.summary.outcomesRecorded, 3);
    assert.equal(run.summary.counts["settled-reviewed"], 1);
    assert.equal(run.summary.counts["settled-other"], 1);
    assert.equal(run.summary.receivedUSDC, "2.000002");
    assert.equal(run.jobs[0].revision, 2);
    assert.equal(run.summary.operatorReportedReviewedSettlementsPerDay, null);
    assert.match(report.qualification, /not an independent audit/);
  } finally {
    x.close();
  }
});
test("pilot rejects unsubstantiated, duplicate-shaped, old and future settlement records", () => {
  const x = fixture();
  try {
    x.start();
    x.advance(1000);
    for (const change of [
      { attest: false },
      { receipt: "0x" + "0".repeat(64) },
      { receipt: "no" },
      { receivedUSDC: "1e6" },
      { receivedUSDC: "0.0000001" },
      { receivedUSDC: "-1" },
      { jobId: "01" },
      { jobId: (2n ** 256n).toString() },
      { settledAt: 1 },
      { settledAt: 9999999999999 },
      { evidence: "too short" },
    ]) {
      assert.throws(() => x.pilot.job({ ...x.job(), ...change }), /PILOT_/);
    }
    assert.equal(x.pilot.report().runs[0].jobs.length, 0);
  } finally {
    x.close();
  }
});
test("pilot scope changes prevent mixed results without preventing closure and export", () => {
  const x = fixture();
  try {
    x.start();
    x.scope("new-scope");
    assert.throws(() => x.pilot.job(x.job()), /PILOT_SCOPE_CHANGED/);
    const report = x.pilot.finish();
    assert.equal(report.runs[0].scopeMatchedAtClose, false);
    assert.equal(report.runs[0].journal, null);
    x.start();
    assert.equal(x.pilot.report().runs.length, 2);
    assert.equal(x.pilot.report().runs[0].scopeMatches, false);
    assert.equal(x.pilot.report().runs[1].scopeMatches, true);
  } finally {
    x.close();
  }
});
test("pilot rate uses elapsed time including downtime, freezes at finish and never declares soak success", () => {
  const x = fixture();
  try {
    x.start();
    x.advance(3 * 86400000);
    x.pilot.job(x.job());
    const report = x.pilot.finish();
    assert.equal(report.runs[0].summary.elapsedSeconds, 259200);
    assert.equal(
      report.runs[0].summary.operatorReportedReviewedSettlementsPerDay,
      0.333,
    );
    x.advance(86400000);
    assert.deepEqual(x.pilot.report().runs[0].summary, report.runs[0].summary);
    assert.match(report.qualification, /does not prove continuous operation/);
    assert.throws(() => x.pilot.job(x.job()), /PILOT_START_FIRST/);
    assert.equal(fs.existsSync(path.join(x.home, "commissioning.json")), false);
  } finally {
    x.close();
  }
});
test("pilot unknown costs remain unknown; actual costs and intervention time are separate units", () => {
  const x = fixture();
  try {
    x.start();
    assert.equal(x.pilot.report().runs[0].summary.costs.gasETH, null);
    x.pilot.costs({
      gasETH: "0.000000000000000001",
      externalUSD: "0.00",
      lostUSDC: "0.250001",
      evidence: "Fixture invoice allocation only",
    });
    x.pilot.intervention({ minutes: 7, evidence: "Fixture RPC recovery" });
    const s = x.pilot.report().runs[0].summary;
    assert.equal(s.interventions, 1);
    assert.equal(s.interventionMinutes, 7);
    assert.equal(s.costs.gasETH, "0.000000000000000001");
    assert.equal(s.costs.externalUSD, "0.00");
    assert.equal(s.costs.lostUSDC, "0.250001");
    assert.throws(
      () =>
        x.pilot.intervention({ minutes: 0, evidence: "Fixture RPC recovery" }),
      /PILOT_INTERVENTION_INVALID/,
    );
    assert.throws(
      () =>
        x.pilot.costs({
          gasETH: "1",
          externalUSD: "0.001",
          evidence: "Fixture invoice allocation only",
        }),
      /PILOT_AMOUNT_INVALID/,
    );
  } finally {
    x.close();
  }
});
test("pilot journal aggregates finalized success and reverts without calling them completed jobs or leaking signed bytes", () => {
  const x = fixture();
  try {
    x.start();
    x.advance(10000);
    const insert = x.db.prepare("INSERT INTO txs VALUES(?,?,?,?)");
    insert.run("submit", 1, "confirmed", 1800000001);
    insert.run("apply", 0, "confirmed", 1800000002);
    insert.run("claim", null, "pending", 1800000003);
    insert.run("submit", 1, "confirmed", 1799999999);
    const run = x.pilot.report().runs[0];
    assert.equal(
      run.journal.confirmedTransactions.reduce((n, t) => n + t.count, 0),
      2,
    );
    assert.equal(run.journal.pendingTransactionsNow, 1);
    assert.equal(run.summary.counts["settled-reviewed"], 0);
    assert.match(run.journal.basis, /not completed jobs/);
    x.c.dbRead = () => null;
    assert.equal(x.pilot.report().runs[0].journal, null);
  } finally {
    x.close();
  }
});
test("pilot persists restart, denies mutations while locked, catches backward clocks and protects file permissions", () => {
  const x = fixture();
  try {
    x.start();
    x.pilot.job(x.job());
    const restored = new Pilot(x.c, "agent", VERSION);
    assert.equal(restored.read().runs[0].jobs.length, 1);
    if (process.platform !== "win32")
      assert.equal(fs.statSync(x.pilot.file).mode & 0o777, 0o600);
    x.c.vault.unlocked = false;
    assert.throws(() => x.pilot.job(x.job()), /NODE_LOCKED/);
    assert.equal(x.pilot.report().runs[0].scopeMatches, null);
    x.c.vault.unlocked = true;
    x.advance(-1000);
    assert.throws(() => x.pilot.finish(), /PILOT_CLOCK_CHANGED/);
    assert.equal(x.pilot.report().runs[0].summary.clockValid, false);
    fs.writeFileSync(x.pilot.file, "not JSON");
    assert.throws(() => x.pilot.report(), /PILOT_HISTORY_DAMAGED/);
  } finally {
    x.close();
  }
});
test("pilot routes require operator session, same origin and CSRF; monitor tokens cannot read or write the notebook", async () => {
  const x = fixture(),
    app = await createControlServer(x.c, { port: 0 });
  try {
    const origin = `http://127.0.0.1:${app.port}`;
    for (const route of ["/api/pilot", "/api/pilot/start"]) {
      const r = await fetch(origin + route, {
        method: route.endsWith("start") ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + "r".repeat(64),
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(route.endsWith("start")
          ? { body: '{"label":"unauthorized"}' }
          : {}),
      });
      assert.equal(r.status, 401);
    }
    const login = await fetch(origin + "/api/session", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token: app.url.split("#")[1] }),
    });
    const { csrf } = await login.json(),
      cookie = login.headers.get("set-cookie").split(";")[0];
    const post = (headers) =>
      fetch(origin + "/api/pilot/start", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ label: "API fixture only" }),
      });
    assert.notEqual((await post({ Origin: origin })).status, 200);
    assert.notEqual(
      (await post({ Origin: "http://evil.test", "X-AGI-CSRF": csrf })).status,
      200,
    );
    assert.equal(
      (await post({ Origin: origin, "X-AGI-CSRF": csrf })).status,
      200,
    );
    const result = await fetch(origin + "/api/pilot", {
      headers: { Cookie: cookie },
    });
    assert.equal((await result.json()).runs.length, 1);
  } finally {
    await app.close();
    x.close();
  }
});
