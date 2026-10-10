import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Controller } from "../src/control/controller.mjs";
import { createControlServer } from "../src/control/server.mjs";
const modulePath = process.env.PLAYWRIGHT_MODULE;
assert.ok(
  modulePath,
  "Set PLAYWRIGHT_MODULE to your installed Playwright module.",
);
const { chromium } = await import(pathToFileURL(modulePath));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-agent-browser-")),
  output = process.env.BROWSER_OUTPUT ?? path.join(home, "screenshots");
fs.mkdirSync(output, { recursive: true });
let clock = Date.now();
const controller = new Controller(home, {
  companion: {
    now: () => clock,
    fetchImpl: async (url, req) => {
      const b = JSON.parse(req.body);
      assert.equal(b.model, "openclaw/agi-agent");
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify(
                b.messages[0].content.includes('status":"ready')
                  ? { status: "ready" }
                  : {
                      summary:
                        "The agent is stopped. Complete deployment verification before starting work.",
                      attention: "check_node",
                    },
              ),
            },
          },
        ],
      });
    },
  },
});
const app = await createControlServer(controller, { port: 0 });
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      acceptDownloads: true,
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.url);
  await page.waitForFunction(
    () => document.getElementById("vaultState").textContent === "No vault yet.",
  );
  const go = async (id) => page.locator(`[data-view="${id}"]`).click();
  await go("help");
  await page.click("#demo");
  await page.waitForFunction(() =>
    document.getElementById("demoResult").textContent.includes("PASS"),
  );
  await go("setup");
  await page.fill("#password", "private browser test password 123");
  await page.click("#vaultAction");
  await page.waitForFunction(() =>
    document.getElementById("vaultState").textContent.includes("Unlocked"),
  );
  await page.click("#wallet");
  await page.waitForFunction(() =>
    document.getElementById("walletAddress").value.startsWith("0x"),
  );
  await page.locator("#deploymentDetails > summary").click();
  await page.fill("#rpc", "https://example.invalid/rpc");
  await page.locator("#rpcForm button").click();
  await page.waitForFunction(() =>
    document.getElementById("notice").textContent.includes("saved securely"),
  );
  await go("policy");
  await page.fill("#buyers", "0x1111111111111111111111111111111111111111");
  await page.locator("#policyForm > button").click();
  await page.waitForFunction(() =>
    document.getElementById("notice").textContent.includes("Policy saved"),
  );
  assert.equal(controller.config.trustedBuyers.length, 1);
  await go("intelligence");
  await page.check("#publicData");
  await page.check("#publicPublishing");
  await page.click("#saveConsent");
  await page.waitForFunction(() =>
    document.getElementById("notice").textContent.includes("choices are saved"),
  );
  await page.selectOption("#workMode", "bounded");
  await page.check("#kitConsent");
  const kitDownload = page.waitForEvent("download");
  await page.click("#kit");
  const kit = await kitDownload;
  assert.equal(kit.suggestedFilename(), "AGI-Agent-OpenClaw-Setup.json");
  await page.waitForFunction(
    () => document.getElementById("kit").disabled === false,
  );
  await page.click("#testAI");
  await page.waitForFunction(() =>
    document
      .getElementById("notice")
      .textContent.includes("valid model response"),
  );
  clock += 31000;
  await page.click("#brief");
  await page.waitForFunction(() =>
    document
      .getElementById("briefText")
      .textContent.includes("agent is stopped"),
  );
  await page.screenshot({
    path: path.join(output, "desktop-intelligence.png"),
    fullPage: true,
  });
  await go("recovery");
  await page.fill("#backupPassword", "private browser test password 123");
  const backupDownload = page.waitForEvent("download");
  await page.locator("#backupForm button").click();
  const backup = await backupDownload;
  const backupPath = path.join(home, "backup.json");
  await backup.saveAs(backupPath);
  await page.waitForFunction(
    () => document.querySelector("#backupForm button").disabled === false,
  );
  await page.locator('#verifyBackupFile').setInputFiles(backupPath);await page.locator('#verifyBackupPassword').fill('private browser test password 123');await page.locator('#verifyBackupForm button').click();
  await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').textContent.includes('ENCRYPTED BACKUP VERIFIED'));
  await page.click("#backupSaved");
  await page.waitForFunction(
    () => document.getElementById("notice").textContent === "Backup confirmed.",
  );
  assert.equal(controller.settings.backupSaved, true);
  await page.click("#lock");
  await page.waitForFunction(() =>
    document.getElementById("notice").textContent.includes("wallet locked"),
  );
  await go("setup");
  await page.fill("#password", "private browser test password 123");
  await page.click("#vaultAction");
  await page.waitForFunction(() =>
    document.getElementById("vaultState").textContent.includes("Unlocked"),
  );
  await go("recovery");
  await page.locator("#recovery summary").click();
  await page.setInputFiles("#backupFile", backupPath);
  await page.fill("#restorePassword", "private browser test password 123");
  await page.check("#restoreConsent");
  await page.locator("#restoreForm button").click();
  await page.waitForFunction(
    () =>
      document.getElementById("notice").textContent.includes("Backup restored"),
    { timeout: 30000 },
  );
  assert.equal(controller.settings.restored, true);
  assert.equal(controller.companion.config.enabled, false);
  await go("overview");
  await page.screenshot({
    path: path.join(output, "desktop-overview.png"),
    fullPage: true,
  });
  await page.reload();
  await page.waitForFunction(() =>
    document.getElementById("vaultState").textContent.includes("Unlocked"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of [
    "overview",
    "setup",
    "intelligence",
    "policy",
    "activity",
    "recovery",
    "help",
  ]) {
    await go(id);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "overflow " + id,
    );
  }
  await go("overview");
  await page.screenshot({
    path: path.join(output, "mobile-overview.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: await browser.version(),
        localExample: true,
        vaultWalletAndPolicy: true,
        publicConsent: true,
        openclawSetupDownload: true,
        mockedGatewayConnectionAndBrief: true,
        encryptedBackupAndRestore: true,
        sessionRefresh: true,
        mobileNoPageOverflow: true,
        javascriptErrors: errors,
        actualOAuth: false,
        actualMacIntegration: false,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await controller.close();
  await app.close();
  fs.rmSync(home, { recursive: true, force: true });
}
