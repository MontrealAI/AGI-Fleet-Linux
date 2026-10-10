import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Controller } from "../src/control/controller.mjs";
import { createControlServer } from "../src/control/server.mjs";
import { startMonitor } from "../fleet/monitor.mjs";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-ops-browser-")),
  fleetHome = fs.mkdtempSync(path.join(os.tmpdir(), "agi-fleet-browser-")),
  out = process.env.BROWSER_OUTPUT ?? home;
fs.mkdirSync(out, { recursive: true });
const c = new Controller(home);
await c.createVault("Fixture-only browser password!");
await c.wallet("create");
const role = c.config.agent ? "agent" : "node",
  app = await createControlServer(c, { port: 0 }),
  fleet = await startMonitor({
    home: fleetHome,
    port: 0,
    heartbeatFetch: async () => new Response("", { status: 200 }),
  });
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      acceptDownloads: true,
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.url);
  await page.waitForTimeout(1800);
  await page.click('[data-view="operations"]');
  await page.waitForFunction(
    () => document.getElementById("opsCase").options.length === 8,
  );
  await page.fill("#opsPrimary", "https://primary.example.test/FIXTURE_SECRET");
  await page.fill(
    "#opsWitness",
    "https://witness.other.test/VERIFICATION_SECRET",
  );
  await page.locator("#opsRPC button").click();
  await page.waitForFunction(
    () =>
      document.getElementById("opsRPCState").textContent ===
      "Verification connection saved.",
  );
  assert.equal(
    c.vault.get("verificationRPCURL"),
    "https://witness.other.test/VERIFICATION_SECRET",
  );
  const peer = {
    schema: "agi-actor-identity/v1",
    role: role === "agent" ? "node" : "agent",
    wallet: "0x" + "2".repeat(40),
  };
  await page.setInputFiles("#opsPeer", {
    name: "identity.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(peer)),
  });
  await page.click("#opsImportIdentity");
  await page.waitForFunction(
    () => document.getElementById("opsPeer").value === "",
  );
  assert.ok(c.config.excludedParties.includes(peer.wallet));
  await page.check("#opsIndependent");
  await page.locator("#opsIndependence button").click();
  await page.waitForFunction(
    () =>
      document.getElementById("opsIdentityState").textContent ===
      "Independence review recorded.",
  );
  await page.selectOption("#opsResult", "pass");
  await page.fill(
    "#opsEvidence",
    "Browser fixture only; not real Mac qualification.",
  );
  await page.locator("#opsCommission button").click();
  await page.waitForFunction(() =>
    document.getElementById("opsCases").textContent.includes("PASS"),
  );
  const evidenceDownload = page.waitForEvent("download");
  await page.click("#opsExportReport");
  const evidence = JSON.parse(
    fs.readFileSync(await (await evidenceDownload).path()),
  );
  assert.equal(evidence.schema, "agi-commissioning-evidence/v1");
  assert.equal(evidence.outstandingAttestationIds.length, 7);
  assert.match(evidence.qualification, /Not established/);
  assert.equal(evidence.configuredLimits.maxFinalizeGas, 2000000);
  assert.match(
    evidence.requiredExternalEvidence.soak,
    /seven days after submission/,
  );
  assert.ok(!JSON.stringify(evidence).includes("FIXTURE_SECRET"));
  assert.ok(!JSON.stringify(evidence).includes("VERIFICATION_SECRET"));
  assert.equal(await page.locator("#txGasUnits").inputValue(), "700000");
  assert.equal(await page.locator("#finalizeGasUnits").inputValue(), "2000000");
  await page.click('[data-view="setup"]');
  await page.click('.steps-nav [data-step="4"]');
  await page.fill("#buyers", "0x" + "4".repeat(40));
  await page.fill("#txGasUnits", "650000");
  await page.fill("#finalizeGasUnits", "1500000");
  const policySaved = page.waitForResponse(
    (r) => r.url().endsWith("/api/config") && r.request().method() === "POST",
  );
  await page
    .locator("#scope-form button[type=submit], #scope-form button:not([type])")
    .first()
    .click();
  assert.equal((await policySaved).status(), 200);
  assert.equal(c.config.limits.maxTxGas, 650000);
  assert.equal(c.config.limits.maxFinalizeGas, 1500000);
  assert.equal(c.config.limits.maxTxETH, "0.01");
  assert.equal(
    c.operations.evidenceReport().outstandingAttestationIds.length,
    8,
  );
  await page.click('[data-view="operations"]');
  await page.waitForFunction(
    () => document.getElementById("opsResult").value === "pending",
  );
  assert.equal(await page.inputValue("#opsEvidence"), "");
  // Disposable notebook enrollment fixture only; no chain/inference/payment is real.
  c.config.manager = "0x" + "3".repeat(40);
  c.pin = () => ({ notebookFixture: true });
  await page.fill("#pilotLabel", "Browser pilot fixture");
  await page.locator("#pilotStart button").click();
  await page.waitForFunction(
    () => !document.getElementById("pilotActive").hidden,
  );
  await page.locator("#pilotJob").locator("..").locator("summary").click();
  await page.fill("#pilotJobId", "1");
  await page.selectOption("#pilotOutcome", "settled-reviewed");
  await page.fill("#pilotReceipt", "0x" + "a".repeat(64));
  await page.fill(
    "#pilotTime",
    new Date()
      .toISOString()
      .slice(0, 23)
      .replace(/(\.[0-9]*?)0+$/, "$1")
      .replace(/\.$/, ""),
  );
  await page.fill("#pilotReceived", "1.000001");
  await page.fill(
    "#pilotJobEvidence",
    "Browser fixture only. No real inference, independence or payment is demonstrated.",
  );
  await page.check("#pilotAttest");
  await page.locator("#pilotJob button").click();
  await page.waitForFunction(() =>
    document
      .getElementById("pilotSummary")
      .textContent.includes("settlements: 1"),
  );
  await page
    .locator("#pilotIntervention")
    .locator("..")
    .locator("summary")
    .click();
  await page.fill("#pilotMinutes", "7");
  await page.fill(
    "#pilotInterventionEvidence",
    "Browser-only RPC recovery fixture",
  );
  await page.locator("#pilotIntervention button").click();
  await page.waitForFunction(() =>
    document.getElementById("pilotSummary").textContent.includes("7 minutes"),
  );
  await page.locator("#pilotCosts").locator("..").locator("summary").click();
  await page.fill("#pilotGas", "0.00001");
  await page.fill("#pilotLost", "0.250001");
  await page.fill("#pilotExternal", "0.20");
  await page.fill(
    "#pilotCostEvidence",
    "Synthetic test receipt and allocation",
  );
  await page.locator("#pilotCosts button").click();
  await page.waitForFunction(() =>
    document.getElementById("pilotSummary").textContent.includes("0.00001 ETH"),
  );
  const reportDownload = page.waitForEvent("download");
  await page.click("#pilotExport");
  const report = JSON.parse(
    fs.readFileSync(await (await reportDownload).path()),
  );
  assert.equal(report.schema, "agi-pilot-report/v1");
  assert.equal(report.runs[0].summary.counts["settled-reviewed"], 1);
  assert.equal(
    report.runs[0].summary.operatorReportedReviewedSettlementsPerDay,
    null,
  );
  assert.ok(!JSON.stringify(report).includes("FIXTURE_SECRET"));
  await page.click("#pilotFinish");
  await page.waitForFunction(() =>
    document.getElementById("pilotSummary").textContent.includes("finished"),
  );
  assert.equal(c.pilot.report().runs[0].summary.interventionMinutes, 7);
  const d = page.waitForEvent("download");
  await page.click("#opsMonitorAccess");
  const download = await d,
    conn = JSON.parse(fs.readFileSync(await download.path()));
  assert.equal(conn.schema, "agi-fleet-read-access/v1");
  assert.equal(conn.role, role);
  await page.screenshot({
    path: path.join(out, role + "-operations-desktop.png"),
    fullPage: true,
  });
  const fleetPage = await context.newPage();
  fleetPage.on("pageerror", (e) => errors.push(e.message));
  await fleetPage.goto(fleet.url);
  await fleetPage.waitForFunction(() =>
    document.getElementById("notice").textContent.startsWith("Updated"),
  );
  await fleetPage.fill(
    "#name",
    role === "agent" ? "Mac mini · Agent" : "MacBook Pro · Node",
  );
  await fleetPage.setInputFiles("#file", {
    name: "monitor.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(conn)),
  });
  await fleetPage.fill("#port", String(app.port));
  await fleetPage.locator("#add button").click();
  await fleet.poll();
  await fleetPage.waitForFunction(
    () => document.querySelector("#actors strong")?.textContent === "STOPPED",
    null,
    { timeout: 20000 },
  );
  assert.equal(fleet.report().actors[0].status.role, role);
  assert.ok(!JSON.stringify(fleet.report()).includes(conn.token));
  await fleetPage.fill(
    "#aliveURL",
    "https://heartbeat.example.org/alive-private-fixture",
  );
  await fleetPage.fill(
    "#healthyURL",
    "https://heartbeat.example.org/healthy-private-fixture",
  );
  await fleetPage.check("#watchdogConsent");
  await fleetPage.locator("#watchdogForm button[type=submit]").click();
  await fleetPage.waitForFunction(() =>
    document
      .getElementById("watchdogState")
      .textContent.includes("expected machines: 1"),
  );
  assert.equal(await fleetPage.inputValue("#aliveURL"), "");
  assert.equal(fleet.report().watchdog.enabled, true);
  assert.ok(!JSON.stringify(fleet.report()).includes("private-fixture"));
  await fleet.poll();
  await fleetPage.click("#disableWatchdog");
  await fleetPage.waitForFunction(() =>
    document
      .getElementById("watchdogState")
      .textContent.startsWith("External heartbeat checks are disabled"),
  );
  assert.equal(fleet.report().watchdog.enabled, false);
  await fleetPage.screenshot({
    path: path.join(out, role + "-fleet-desktop.png"),
    fullPage: true,
  });
  for (const [target, name] of [
    [page, role + "-operations-mobile"],
    [fleetPage, role + "-fleet-mobile"],
  ]) {
    await target.setViewportSize({ width: 390, height: 844 });
    await target.screenshot({
      path: path.join(out, name + ".png"),
      fullPage: true,
    });
    assert.equal(
      await target.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      name + " overflow",
    );
  }
  const revoked = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/companion/revoke") &&
      r.request().method() === "POST",
  );
  await page.click("#opsRevoke");
  assert.equal((await revoked).status(), 200);
  for (
    let i = 0;
    i < 100 && fleet.report().actors[0].state !== "offline";
    i++
  ) {
    await fleet.poll();
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(fleet.report().actors[0].state, "offline");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        role,
        browser: await browser.version(),
        passed: [
          "dual encrypted RPC setup",
          "peer exclusion import",
          "independence review",
          "scoped commissioning record and private evidence export; no automatic qualification",
          "gas limits save through the UI, preserve ETH caps and invalidate prior attestations",
          "pilot start, outcome, costs, intervention, finish and private export",
          "read-token download",
          "actual local fleet feed",
          "external heartbeat opt-in and disable; fixture transport only; endpoint redaction",
          "token revocation",
          "desktop and 390px layouts",
          "zero page errors",
        ],
        limitations:
          "No real SSH, Mac, RPC services, account inference or public IPFS tested.",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await fleet.close();
  await app.close();
  await c.close();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(fleetHome, { recursive: true, force: true });
}
