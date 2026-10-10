import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const root = fileURLToPath(new URL("..", import.meta.url)),
  home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-ui-qa-")),
  out =
    process.env.AGI_NODE_QA_OUT ??
    fs.mkdtempSync(path.join(os.tmpdir(), "agi-ui-results-"));
fs.mkdirSync(out, { recursive: true });
const child = spawn(
  process.execPath,
  ["src/launch.mjs", "--home", home, "--port", "0", "--no-open"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
const gateway = http.createServer(async (req, res) => {
  if(req.method === "GET" && req.url === "/health") { res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify({policyCurrent:true,protocol:"agi-compute/v2",role:"node",uid:(process.getuid?.() ?? 0)+1000,auth:"chatgpt-oauth",capabilities:["computer-review","desktop","files"],policyHash:"a".repeat(64),gatewayReady:true})); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, "openclaw/agi-node");
  assert.deepEqual(body.tools, []);
  const content =
    body.messages[0].content.includes("status") &&
    body.messages[0].content.includes("ready")
      ? { status: "ready" }
      : {
          summary:
            "Your node is stopped. Complete the deployment checks before starting.",
          attention: "check_node",
        };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(content) },
        },
      ],
    }),
  );
});
await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
try {
  const url = await new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/.exec(text);
      if (match) resolve(match[0]);
    });
    child.on("exit", (code) => reject(Error("App ended " + code)));
    setTimeout(() => reject(Error("Startup timeout")), 20000).unref();
  });
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--single-process",
    ],
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(
    () => !document.getElementById("connection-error").hidden === false,
  );
  await page.locator("#demo-toggle").click();
  await page.locator("#demo-banner").waitFor({ state: "visible" });
  assert.equal(await page.locator("#overview-jobs .job-row").count(), 5);
  await page.screenshot({
    path: out + "/v2-overview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: out + "/v2-overview-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator('nav [data-view="lab"]').click();
  await page.locator("#sample-json").click();
  await page.locator("#run-lab").click();
  await page
    .getByRole("heading", { name: "Acceptance checks passed", exact: true })
    .waitFor();
  assert.equal(await page.locator("#run-lab").isEnabled(), true);
  await page.locator("#sample-text").click();
  await page.locator("#lab-delivery").fill("TODO invalid");
  await page.locator("#run-lab").click();
  await page
    .getByRole("heading", { name: "Acceptance checks failed", exact: true })
    .waitFor();
  await page.screenshot({ path: out + "/v2-lab-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('nav [data-view="setup"]').click();
  const password = "Browser-fixture password 2026!";
  await page.locator("#vault-password").fill(password);
  await page.locator("#vault-repeat").fill(password);
  await page.locator("#vault-submit").click();
  await page.locator("#step-2").waitFor({ state: "visible" });
  await page
    .locator("#rpc-url")
    .fill("https://rpc.example.test/private-browser-fixture");
  await page.locator("#manager").fill("0x" + "1".repeat(40));
  await page.locator("#deployment-block").fill("10");
  await page
    .locator(
      '#connection-form button[type="submit"],#connection-form button.primary',
    )
    .last()
    .click();
  await page.locator("#step-3").waitFor({ state: "visible" });
  await page.locator("#walletCreate").click();
  await page.locator("#seedRecovery").waitFor({state:"visible"});
  await page.locator("#revealPassword").fill(password);
  await page.locator("#revealPhraseForm button").click();
  await page.locator("#phraseWords li").first().waitFor();
  const words=await page.locator("#phraseWords li").allTextContents();
  await page.locator("#phraseVerify").click();
  for(let i=0;i<3;i++) {
    const label=await page.locator("#recoveryAnswer"+i).locator("..").textContent();
    await page.locator("#recoveryAnswer"+i).fill(words[Number(label.match(/Word (\d+)/)[1])-1]);
  }
  await page.locator("#confirmPhraseForm button").click();
  await page.locator("#phraseDialog").waitFor({state:"hidden"});
  await page.locator("#seedRecovery").waitFor({ state: "visible" });
  await page.locator('[data-step="4"]').first().click();
  await page.locator("#buyers").fill("0x" + "2".repeat(40));
  await page.locator("#scope-form button.primary").click();
  await page.locator("#step-5").waitFor({ state: "visible" });
  await page.locator('nav [data-view="companion"]').click();
  await page.locator("#companion-ack").check();
  const kitDownload = page.waitForEvent("download");
  await page.locator("#companion-kit").click();
  const kit = await kitDownload;
  await kit.saveAs(out + "/fixture-openclaw-setup.json");
  const kitData = JSON.parse(
    fs.readFileSync(out + "/fixture-openclaw-setup.json", "utf8"),
  );
  assert.equal(kitData.openclawVersion, "2026.9.5");
  assert.equal(kitData.token.length, 64);
  await page.locator("#view-companion summary").first().click();
  await page.locator("#companion-port").fill(String(gateway.address().port));
  await page.locator("#companion-auto").check();
  await page.locator("#companion-save").click();
  await page
    .getByText("Preferences saved. Test the connection", { exact: false })
    .waitFor();
  await page.locator("#companion-test").click();
  await page
    .getByText("OpenClaw returned the expected response.", { exact: false })
    .waitFor();
  await page.locator("#companion-preview").click();
  await page.locator("#companion-payload").waitFor({ state: "visible" });
  const shared = await page.locator("#companion-payload").textContent();
  assert.ok(!shared.includes("private-browser-fixture"));
  assert.ok(!shared.includes(kitData.token));
  const feedDownload = page.waitForEvent("download");
  await page.locator("#companion-read").click();
  await (await feedDownload).saveAs(out + "/fixture-read-access.json");
  const access = JSON.parse(
    fs.readFileSync(out + "/fixture-read-access.json", "utf8"),
  );
  assert.equal(
    (
      await fetch(access.url, {
        headers: { Authorization: "Bearer " + access.token },
      })
    ).status,
    200,
  );
  await page.locator("#companion-revoke").click();
  await page
    .getByText("Read-only access revoked immediately.", { exact: true })
    .waitFor();
  assert.equal(
    (
      await fetch(access.url, {
        headers: { Authorization: "Bearer " + access.token },
      })
    ).status,
    401,
  );
  await page.waitForTimeout(31000); // Exercise the real minimum request interval.
  await page.locator("#companion-summarize").click();
  await page
    .locator("#companion-brief")
    .filter({ hasText: "Your node is stopped." })
    .waitFor();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: out + "/v21-companion-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: out + "/v21-companion-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('nav [data-view="wallet"]').click();
  await page.locator("#backup-password").fill(password);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#backup-form button").click();
  const backup = await downloadPromise;
  await backup.saveAs(out + "/fixture-backup.aginodebackup");
  await page.locator('#verifyBackupFile').setInputFiles(out + '/fixture-backup.aginodebackup');
  await page.locator('#verifyBackupPassword').fill(password);await page.locator('#verifyBackupForm button').click();
  await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').textContent.includes('ENCRYPTED BACKUP VERIFIED'));
  await page.locator("#backup-saved").click();
  await page
    .getByText("Backup confirmation saved.", { exact: false })
    .waitFor();
  assert.equal(await page.locator("#backup-password").inputValue(), "");
  await page.locator("#lock-top").click();
  await page.locator("#unlock-top").waitFor({ state: "visible" });
  await page.locator("#unlock-top").click();
  await page.locator("#unlock-password").fill(password);
  await page.locator("#unlock-form button.primary").click();
  await page.locator("#unlock-dialog").waitFor({ state: "hidden" });
  await page
    .locator("#backup-file")
    .setInputFiles(out + "/fixture-backup.aginodebackup");
  await page.locator("#restore-password").fill(password);
  await page.locator("#restore-ack").check();
  await page.locator("#restore-form button").click();
  await page.locator("#restore-check").waitFor({ state: "visible" });
  assert.equal(await page.locator("#restore-password").inputValue(), "");
  await page.reload();
  await page.locator("#connection-error").waitFor({ state: "hidden" });
  await page.locator('nav [data-view="lab"]').click();
  await page.locator("#run-lab").click();
  await page
    .getByRole("heading", { name: "Acceptance checks passed", exact: true })
    .waitFor();
  await page.screenshot({ path: out + "/v2-lab-desktop.png", fullPage: true });
  await page.goto("file://" + root + "/START_HERE.html");
  await page.screenshot({
    path: out + "/v2-guide-desktop.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/v2-guide-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        journeys: [
          "demo: five opportunities, 2 approvals / 1 rejection / 2 abstentions",
          "mobile overview and lab: no horizontal overflow",
          "CSV, JSON Schema and text lab checks",
          "create vault, encrypt RPC, create wallet, select buyers and budgets",
          "download encrypted backup, confirm, lock, unlock, restore with live disabled",
          "refresh authenticated session; no browser JavaScript errors",
          "OpenClaw setup download, encrypted connection save, model test and status explanation against local fixture, exact shared-data preview, read-only token rotation/revocation",
          "OpenClaw companion page at desktop and mobile widths; no horizontal overflow",
          "offline Start Here: desktop and mobile, no horizontal overflow",
        ],
        viewportWidths: [1440, 390],
        browser: await browser.version(),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => gateway.close(resolve));
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
  fs.rmSync(home, { recursive: true, force: true });
  for (const name of [
    "fixture-backup.aginodebackup",
    "fixture-openclaw-setup.json",
    "fixture-read-access.json",
  ])
    fs.rmSync(out + "/" + name, { force: true });
}
