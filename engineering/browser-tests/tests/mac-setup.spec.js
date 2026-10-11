import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({context}) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort());
});

for (const language of ['en', 'fr']) {
  const file = `/install-mac${language === 'fr' ? '-fr' : ''}.html`;
  test(`${language}: companion preserves role and progress, marks only explicit observations and prints all steps`, async ({page}, testInfo) => {
    await page.goto(file + '?role=node');
    await expect(page.locator('#setup-role')).toHaveValue('node');
    await page.screenshot({path: testInfo.outputPath(`mac-companion-${language}-desktop.png`), fullPage: true});
    await expect(page.locator('[data-setup-step]:visible')).toHaveCount(1);
    for (let step = 1; step <= 8; step++) {
      await expect(page.locator(`#step-${step}`)).toBeVisible();
      if (step > 1) await expect(page.locator(`#title-${step}`)).toBeFocused();
      await page.locator('#setup-mark').click();
      await expect(page.locator('#setup-mark')).toHaveAttribute('aria-pressed', 'true');
      if (step < 8) await page.locator('#setup-next').click();
    }
    await expect(page.locator('#setup-next')).toBeDisabled();
    await page.reload();
    await expect(page.locator('#step-8')).toBeVisible();
    await expect(page.locator('#setup-progress')).toContainText(language === 'fr' ? '8 étapes' : '8 of 8');
    await page.locator('[data-step-link]').nth(5).click();
    await expect(page.locator('#step-6 [data-setup-role="node"]')).toBeVisible();
    await expect(page.locator('#step-6 [data-setup-role="agent"]')).toBeHidden();
    await page.emulateMedia({media: 'print'});
    await expect(page.locator('[data-setup-step]:visible')).toHaveCount(8);
    await page.emulateMedia({media: 'screen'});
    await page.locator('#setup-role').selectOption('agent');
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('#setup-progress')).toContainText(language === 'fr' ? '0 étapes' : '0 of 8');
    await page.locator('#setup-mark').click();
    await page.locator('#setup-reset').click();
    await expect(page.locator('#setup-mark')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#setup-size').click();
    await page.reload();
    await expect(page.locator('#setup-size')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({path: testInfo.outputPath(`mac-companion-${language}.png`), fullPage: true});
  });

  test(`${language}: mobile, large text, keyboard and WCAG checks on every step`, async ({page}, testInfo) => {
    await page.setViewportSize({width: 320, height: 812});
    await page.goto(file);
    await page.locator('#setup-size').click();
    for (let step = 0; step < 8; step++) {
      const link = page.locator('[data-step-link]').nth(step);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(`#title-${step + 1}`)).toBeFocused();
      const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations).toEqual([]);
    }
    await page.screenshot({path: testInfo.outputPath(`mac-companion-${language}-mobile.png`), fullPage: true});
  });

  test(`${language}: unavailable storage and JavaScript-disabled reading remain useful`, async ({browser}) => {
    const context = await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort());
    await context.addInitScript(() => { Object.defineProperty(window, 'localStorage', {get() {throw new Error('disabled');}}); });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173' + file);
    await expect(page.locator('#setup-status')).toContainText(language === 'fr' ? 'indisponible' : 'unavailable');
    await page.locator('#setup-next').click();
    await expect(page.locator('#step-2')).toBeVisible();
    await context.close();
    const plain = await browser.newContext({javaScriptEnabled:false});
    const staticPage = await plain.newPage();
    await staticPage.goto('http://127.0.0.1:4173' + file);
    await expect(staticPage.locator('[data-setup-step]:visible')).toHaveCount(8);
    await expect(staticPage.locator('#setup-next')).toBeHidden();
    await expect(staticPage.locator('#step-6 [data-setup-role]:visible')).toHaveCount(2);
    await plain.close();
  });
}
