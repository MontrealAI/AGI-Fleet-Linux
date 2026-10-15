import {expect} from '@playwright/test';

// Uses only local Builder work. No provider, wallet, grant or live dispatch.
export async function verifyReplacementHandoff(page) {
  await page.locator('#public-consent').check();
  await page.locator('#run').click();
  await expect(page.locator('#keep-version')).toBeEnabled();
  await page.locator('#keep-version').click();
  await expect(page.locator('#keep-version')).toBeDisabled();
  await page.locator('#budget').evaluate(el => el.closest('details').open = true);
  async function prepare(budget) {
    await page.locator('#budget').fill(budget);
    await page.locator('#prepare-job').click();
  }
  async function revoked() {
    await expect(page.locator('#job-results')).toBeHidden();
    await expect(page.locator('#handoff-consent')).not.toBeChecked();
    await expect(page.locator('#replace-consent')).not.toBeChecked();
    await expect(page.locator('#console-link')).toBeEmpty();
  }
  await prepare('100');
  await expect(page.locator('#job-results')).toBeVisible();
  await page.locator('#handoff-consent').check();
  await prepare('');
  await expect(page.locator('#error')).toContainText('USDC_PRICE_REQUIRED');
  await revoked();
  await page.locator('#fleet-export').click();
  await expect(page.locator('#error')).toContainText('FLEET_PLAN_REQUIRED');
  await prepare('100');
  await expect(page.locator('#job-results')).toBeVisible();
  await page.locator('#handoff-consent').check();
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    window.__nativeHandoffWorker = NativeWorker;
    window.Worker = class extends NativeWorker {
      set onmessage(callback) {
        super.onmessage = event => { window.__lateHandoffPlan = () => callback(event); };
      }
    };
  });
  await prepare('200');
  await page.waitForFunction(() => typeof window.__lateHandoffPlan === 'function');
  await revoked();
  await page.locator('#stop').click();
  await expect(page.locator('#error')).toContainText('STOPPED');
  await page.evaluate(() => {
    window.__lateHandoffPlan(); delete window.__lateHandoffPlan;
    window.Worker = window.__nativeHandoffWorker;
  });
  await revoked();
  await page.locator('#fleet-export').click();
  await expect(page.locator('#error')).toContainText('FLEET_PLAN_REQUIRED');
  await prepare('200');
  await expect(page.locator('#job-results')).toBeVisible();
  await expect(page.locator('#handoff-consent')).not.toBeChecked();
}
