import { test, expect } from '@playwright/test';

for (const language of ['en', 'fr']) {
  test(`${language}: ecosystem wayfinding works without scripts and keeps protocol boundaries visible`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4173/${language === 'fr' ? 'fr' : 'index'}.html#ecosystem`);
    const map = page.locator('#ecosystem');
    await expect(map.locator('h2')).toBeVisible();
    const links = map.locator('.ecosystem-card a');
    await expect(links).toHaveCount(4);
    const destinations = ['AGI-Alpha-Agent-v0/', 'AGIJobsv0/', 'AGIJobManager/', `AGI-Fleet-Linux/start${language === 'fr' ? '-fr' : ''}.html`];
    for (const [index, destination] of destinations.entries()) {
      await expect(links.nth(index)).toHaveAttribute('href', `https://montrealai.github.io/${destination}`);
      await links.nth(index).focus();
      await expect(links.nth(index)).toBeFocused();
      const box = await links.nth(index).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await expect(map.locator('.ecosystem-boundary')).toContainText('JobRegistry');
    await expect(map.locator('.ecosystem-boundary')).toContainText('USDC');
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await map.screenshot({ path: testInfo.outputPath(`ecosystem-${language}-${width}.png`), animations: 'disabled' });
    }
    await context.close();
  });
}
