import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const origin = 'http://127.0.0.1:4173';
const roles = ['Agent', 'Node', 'Moderator', 'Employer', 'Evidence', 'Recovery'];

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'));
});

for (const language of ['en', 'fr']) {
  const path = language === 'fr' ? '/fr.html' : '/index.html';

  test(`${language}: landing page reflows without clipped content or overlapping navigation`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(path);
    for (const scale of [1, 1.25, 2]) {
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale * 100}%`; }, scale);
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const layout = await page.evaluate(() => {
          const viewport = document.documentElement.clientWidth;
          const content = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
          const targets = [...document.querySelectorAll('header a, .hero-copy, .role-card, .satellite')];
          const clipped = targets.filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.left < -1 || rect.right > viewport + 1 || element.scrollWidth > element.clientWidth + 1;
          }).map(element => element.className || element.textContent);
          const links = [...document.querySelectorAll('header a')].map(element => element.getBoundingClientRect());
          const overlaps = links.some((rect, i) => links.slice(i + 1).some(other =>
            rect.left < other.right - 1 && rect.right > other.left + 1 &&
            rect.top < other.bottom - 1 && rect.bottom > other.top + 1));
          const labels = [...document.querySelectorAll('.satellite, .orbit-center strong, .orbit-center small, .orbit-star')];
          const diagramOverlaps = labels.flatMap((element, i) => labels.slice(i + 1).flatMap(other => {
            const a = element.getBoundingClientRect(), b = other.getBoundingClientRect();
            return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
              ? [`${element.className || element.tagName} / ${other.className || other.tagName}`] : [];
          }));
          return { viewport, content, clipped, overlaps, diagramOverlaps };
        });
        expect(layout, `${width}px, text scale ${scale}`).toEqual({
          viewport: width, content: width, clipped: [], overlaps: false, diagramOverlaps: []
        });
        if (scale === 1 && [320, 768, 1440].includes(width)) {
          const screenshot = testInfo.outputPath(`landing-${language}-${width}.png`);
          await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
          await testInfo.attach(`landing-${width}`, { path: screenshot, contentType: 'image/png' });
        }
      }
    }
    expect(errors).toEqual([]);
  });

  test(`${language}: landing page meets automated WCAG A/AA checks at desktop and mobile sizes`, async ({ page }) => {
    await page.goto(path);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
    }
  });

  test(`${language}: all role commands copy the displayed path and retain role-specific guidance`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText = text; } } });
    });
    await page.goto(path);
    const release = await (await page.request.get('/release.json')).json();
    for (const role of roles) {
      const button = page.locator(`[data-role="${role}"]`);
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-role][aria-pressed="true"]')).toHaveCount(1);
      const command = `/opt/agi-fleet-linux/AGI_Fleet_Linux_v${release.version}/packages/AGI_${role}/Launch.sh`;
      await expect(page.locator('#role-command')).toHaveText(command);
      await page.locator('[data-copy="role-command"]').click();
      await expect.poll(() => page.evaluate(() => window.copiedText)).toBe(command);
      if (role === 'Evidence') await expect(page.locator('#role-note')).toContainText(language === 'fr' ? 'sans portefeuille' : 'without a wallet');
      if (!['Agent', 'Node'].includes(role)) await expect(page.locator('#role-qualification')).toContainText('Qualify-Linux.sh');
    }
  });

  test(`${language}: guide search, clipboard fallback and planning checks remain useful`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('blocked'); } } });
    });
    await page.goto(path);
    const search = page.locator('#resource-search');
    await search.fill('màc');
    await expect(page.locator('.resource-card:visible').first()).toBeVisible();
    await expect(page.locator('#no-results')).toBeHidden();
    await search.fill('no-guide-matches-this-query');
    await expect(page.locator('.resource-card:visible')).toHaveCount(0);
    await expect(page.locator('#no-results')).toBeVisible();
    await search.fill('');
    await expect(page.locator('.resource-card:visible')).toHaveCount(await page.locator('.resource-card').count());
    await page.locator('[data-copy="role-command"]').click();
    await expect(page.locator('#copy-status')).toContainText(language === 'fr' ? 'manuellement' : 'manually');
    expect(await page.evaluate(() => window.getSelection().toString())).toBe(await page.locator('#role-command').textContent());
    const checks = page.locator('input[name="preflight"]');
    for (const check of await checks.all()) await check.check();
    await expect(page.locator('#checklist-status')).toContainText(language === 'fr' ? 'qualification reste' : 'qualification is still required');
  });

  test(`${language}: new project guides are discoverable without changing the stable Fleet download`, async ({ page }) => {
    const suffix = language === 'fr' ? '#français' : '';
    const base = 'https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/docs/local-skills/';
    const previewURL = `${base}DOWNLOAD_ALPHA_6.md${suffix}`;
    const journeyURL = `${base}FOUR_REPOSITORY_JOURNEY.md${suffix}`;
    await page.goto(path);
    const search = page.locator('#resource-search');
    await search.fill('alpha.6');
    const preview = page.locator('.resource-card:visible');
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('href', previewURL);
    await expect(preview).toContainText(language === 'fr' ? 'CANDIDAT SOURCE' : 'SOURCE CANDIDATE');
    await expect(preview).toContainText(language === 'fr' ? 'après publication' : 'after the named assets are published');
    await search.fill(language === 'fr' ? 'quatre dépôts' : 'four repositories');
    const journey = page.locator('.resource-card:visible');
    await expect(journey).toHaveCount(1);
    await expect(journey).toHaveAttribute('href', journeyURL);
    await expect(journey).toContainText(language === 'fr' ? 'non signées' : 'unsigned');
    await journey.focus();
    await expect(journey).toBeFocused();
    await search.fill('');
    await expect(page.locator(`.resource-card[href="${base}DOWNLOAD.md${suffix}"]`)).toContainText('alpha.4');
    await page.locator('.welcome-copy a').filter({ hasText: language === 'fr' ? 'Trouver ma prochaine étape' : 'Find my next step' }).click();
    const help = page.locator('#help');
    await expect(help.locator(`a[href="${journeyURL}"]`)).toBeVisible();
    await expect(help.locator(`a[href="${previewURL}"]`)).toBeVisible();
    await expect(help).toContainText(language === 'fr' ? 'qualification du paquet exact' : 'exact-package qualification');
    await expect(help).toContainText(language === 'fr' ? 'aucune exécution, aucun paiement ni accès au portefeuille' : 'no execution, payment or wallet access');
    const release = await (await page.request.get('/release.json')).json();
    await expect(page.locator('#release-link')).toHaveAttribute('href', `https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/${release.tag}`);
    await expect(page.locator('#download-link')).toHaveAttribute('href', `https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/${release.tag}/${release.name}`);
  });
}
