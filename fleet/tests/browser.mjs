import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Controller } from "../ops/controller.mjs";
import { createServer } from "../ops/server.mjs";
import { config, temp } from "./helpers.mjs";
// Point these at your own Playwright install and Chromium executable.
const playwright = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const home = temp(),
  controller = new Controller(home, "evidence"),
  panel = await createServer(controller);
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_BIN
    ? { executablePath: process.env.CHROMIUM_BIN }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(panel.url);
  await page.waitForFunction(
    () =>
      document.querySelector("#title").textContent === "Your evidence machine.",
  );
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(await page.locator("#keylabel").isVisible(), false);
  assert.equal(await page.locator("#authority").isVisible(), false);
  await page.locator("#password").fill("test browser password only");
  await page.locator("#unlock").click();
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "ready",
  );
  const c = config("evidence");
  await page.locator("summary").filter({hasText:"Advanced limits and fleet partition"}).click();
  await page.locator("#advanced").fill(JSON.stringify(c));
  await page.locator("#useAdvanced").click();
  await page.locator("#maxClaimsPerCycle").fill("17");
  await page.locator("#modelVeto").check();
  await page.locator("#rpcURL").fill("http://127.0.0.1:18541");
  await page.locator("#verificationRPCURL").fill("http://127.0.0.1:18542");
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#rpcURL").value === "",
  );
  assert.equal(controller.config.manager, c.manager);
  assert.equal(controller.config.maxClaimsPerCycle, 17);
  assert.equal(controller.config.modelVeto, true);
  assert.equal(await page.locator("#wallet").isVisible(), false);
  assert.equal(await page.locator("#maxGas24hETH").isVisible(), false);
  assert.equal(await page.locator("#independenceConfirmed").isVisible(), false);
  const monitorPromise = page.waitForEvent("download");
  await page.locator("#monitor").click();
  const monitorDownload = await monitorPromise;
  assert.equal(monitorDownload.suggestedFilename(), "AGI-Fleet-Read-Only-Monitor.json");
  const monitor = JSON.parse(fs.readFileSync(await monitorDownload.path(), "utf8"));
  const monitorHeaders = {Authorization:"Bearer "+monitor.token};
  assert.equal((await fetch(monitor.url,{headers:monitorHeaders})).status, 200);
  assert.equal((await fetch(panel.origin+"/api/status",{headers:monitorHeaders})).status, 403);
  assert.equal((await fetch(panel.origin+"/api/workload",{headers:monitorHeaders})).status,403);
  assert.match(await page.locator("#workloadSummary").textContent(),/actual workload is unknown/);
  assert.equal(await page.locator("#claimRenewal").isVisible(),false);
  await page.locator("summary").filter({hasText:"Record human handling"}).click();
  await page.locator("#humanCategory").selectOption("maintenance");
  await page.locator("#humanMinutes").fill("25");
  await page.locator("#humanReference").fill("job:42");
  await page.locator("#recordHuman").click();
  await page.waitForFunction(()=>document.querySelector("#workloadSummary").textContent.includes("25 human minutes"));
  const workloadPromise=page.waitForEvent("download");
  await page.locator("#workloadExport").click();
  const workloadDownload=await workloadPromise;
  const workload=JSON.parse(fs.readFileSync(await workloadDownload.path(),"utf8"));
  assert.equal(workload.humanWork.minutesRecorded,25);
  assert.equal(workload.humanWork.measuredSavingsHours,null);
  await page.locator("#humanEntries button").click();
  await page.waitForFunction(()=>document.querySelector("#workloadSummary").textContent.includes("actual workload is unknown"));
  await page.locator("summary").filter({hasText:"Explore the historical labor model"}).click();
  await page.locator("#laborCase").selectOption("case4_conservative");
  assert.equal(await page.locator("#coverage-additionalEvidenceRequest").inputValue(),"0");
  await page.locator("#coverage-additionalEvidenceRequest").fill("100");
  await page.locator("#calculateLabor").click();
  await page.waitForFunction(()=>document.querySelector("#laborResult").textContent.includes("73.2 remaining"));
  assert.match(await page.locator("#laborResult").textContent(),/204 unpaid beneficiaries/);
  const estimatePromise=page.waitForEvent("download");
  await page.locator("#laborExport").click();
  const estimateDownload=await estimatePromise;
  const estimate=JSON.parse(fs.readFileSync(await estimateDownload.path(),"utf8"));
  assert.equal(estimate.estimatedRemainingMinutes,4390);
  await page.locator("#completion-moderatorRuling").fill("99");
  assert.equal(await page.locator("#laborExport").isDisabled(),true);
  for(let i=0;i<55;i++)controller.store.incident("job",String(i),"OPENCLAW_ABSTENTION");
  await page.locator("#refresh").click();
  await page.waitForFunction(()=>document.querySelector("#exceptionCount").textContent.includes("55 open exceptions"));
  await page.locator("#exceptionNext").click();
  await page.waitForFunction(()=>document.querySelector("#exceptionCount").textContent.includes("5 shown"));
  await page.locator("#exceptionFirst").click();
  for(let i=0;i<55;i++)controller.store.resolveIncident("job",String(i),"SYNTHETIC_BROWSER_FIXTURE_CLEARED");
  await page.locator("#refresh").click();
  await page.locator("#pause").click();
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "paused",
  );
  assert.equal(controller.snapshot().paused, true);
  await page.locator("#backupPassword").fill("browser backup password only");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#backup").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "AGI-Fleet-Encrypted-Backup.json");
  const data = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.ok(!JSON.stringify(data).includes("18541"));
  await page.screenshot({
    path: new URL("../evidence/control-panel-desktop.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.locator("#workloadPanel").screenshot({path:new URL("../evidence/workload-panel-desktop.png",import.meta.url).pathname});
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: new URL("../evidence/control-panel-mobile.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.locator("#workloadPanel").screenshot({path:new URL("../evidence/workload-panel-mobile.png",import.meta.url).pathname});
  await page.goto(new URL("../START_HERE.html",import.meta.url).href);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL("../evidence/start-here-mobile.png",import.meta.url).pathname,fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:new URL("../evidence/start-here-desktop.png",import.meta.url).pathname,fullPage:true});
  await page.locator('a[href="docs/LABOR_AND_EXCEPTIONS.html"]').click();
  assert.match(await page.locator("h1").textContent(),/Understand the work/);
  await page.goto(new URL("../docs/ADMISSION.html",import.meta.url).href);
  assert.match(await page.locator("h1").textContent(),/New paid work/);
  await page.screenshot({path:new URL("../evidence/current-v1.6.0/admission-guide.png",import.meta.url).pathname,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    actualLoopbackUI: true,
    vaultCreate: true,
    configurationSave: true,
    guidedModelAndClaimSettings: true,
    readOnlyMonitorDownload: true,
    pause: true,
    encryptedBackupDownload: true,
    evidenceNoSigningControls: true,
    desktop: true,
    mobileNoHorizontalOverflow: true,
    javascriptErrors: errors,
    humanTimeRecordAndVoid: true,
    workloadReportDownload: true,
    scenarioAssumptionsAndDownload: true,
    exceptionPagination: true,
    noMeasuredSavingsClaim: true,
    offlineStartGuide: true,
    qualifiedAdmissionGuide: true,
  };
  fs.writeFileSync(
    new URL("../evidence/browser.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await controller.close();
  await new Promise((r) => panel.server.close(r));
  fs.rmSync(home, { recursive: true, force: true });
}
