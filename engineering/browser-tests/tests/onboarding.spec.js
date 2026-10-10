import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const origin = 'http://127.0.0.1:4173';
const languages = [
  { code: 'en', name: 'Linux EN', os: 'ubuntu', path: '/start.html', home: '/index.html', employer: 'https://montrealai.github.io/AGIJobManager/employers/' },
  { code: 'fr', name: 'Linux FR', os: 'ubuntu', path: '/start-fr.html', home: '/fr.html', employer: 'https://montrealai.github.io/AGIJobManager/fr/employers/' },
  { code: 'en', name: 'Mac EN', os: 'macos', path: '/mac.html', home: '/index.html', employer: 'https://montrealai.github.io/AGIJobManager/employers/' },
  { code: 'fr', name: 'Mac FR', os: 'macos', path: '/mac-fr.html', home: '/fr.html', employer: 'https://montrealai.github.io/AGIJobManager/fr/employers/' }
];

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort('blockedbyclient');
  });
});

async function openGuide(page, language = languages[0], hash = '') {
  await page.goto(`${language.path}${hash}`);
  await expect(page.locator('html')).toHaveAttribute('lang', language.code);
  await expect(page.locator('#text-size')).toBeVisible();
}

async function expectPanel(page, panel, focused = true, allowBareWelcome = !focused && panel === 'welcome') {
  await expect(page.locator('[data-panel]:visible')).toHaveCount(1);
  await expect(page.locator(`#${panel}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(allowBareWelcome ? '\\/(?:start|mac)(?:-fr)?\\.html(?:#welcome)?$' : `#${panel}$`));
  if (focused) await expect(page.locator(`#${panel} h2`).first()).toBeFocused();
}

async function makePlan(page, role = 'agent') {
  await page.locator('#welcome [data-go="computer"]').click();
  await expectPanel(page, 'computer');
  const os = (await page.locator('html').getAttribute('data-platform')) === 'macos' ? 'macos' : 'ubuntu';
  await page.locator(`#computer [data-os="${os}"]`).click();
  await expectPanel(page, 'role');
  await page.locator(`#role [data-role="${role}"]`).click();
  await expectPanel(page, 'plan');
}

async function expectNoOverflow(page, label) {
  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  }));
  expect(size.content, `${label}: content ${size.content}px exceeds viewport ${size.viewport}px`).toBeLessThanOrEqual(size.viewport + 1);
}

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const language of languages) {
  test(`${language.name}: all goals lead to a useful next step and both roles make accurate plans`, async ({ page }, testInfo) => {
    await openGuide(page, language);
    await expectPanel(page, 'welcome', false);
    await page.locator('#welcome [data-go="hire"]').click();
    await expectPanel(page, 'hire');
    await expect(page.locator(`#hire a[href="${language.employer}"]`)).toBeVisible();
    await page.locator('#hire [data-back="welcome"]').click();
    await page.locator('#welcome [data-go="explore"]').click();
    await expectPanel(page, 'explore');
    await expect(page.locator('#explore')).toContainText('AGIJobManager');
    await page.locator('#explore [data-back="welcome"]').click();
    await makePlan(page);
    await expect(page.locator('#plan-title')).toContainText('Agent');
    await expect(page.locator('#role-login')).toContainText('Creator');
    await expect(page.locator('#installation-guide')).toHaveAttribute('href', /\/docs\/FRESH_INSTALL\.md$/);
    await page.locator('#plan [data-back="role"]').click();
    await page.locator('#role [data-role="node"]').click();
    await expectPanel(page, 'plan');
    await expect(page.locator('#plan-title')).toContainText('Node');
    await expect(page.locator('#role-login')).toContainText(language.os === 'macos' ? 'AGI_Node' : 'packages/AGI_Node');
    await expect(page.locator('#role-login')).not.toContainText('Creator');
    await screenshot(page, testInfo, `${language.name.replaceAll(' ', '-')}-desktop-node-plan`);
  });

  test(`${language.name}: unsupported or unknown computers stay on the help route`, async ({ page }) => {
    await openGuide(page, language);
    await page.locator('#welcome [data-go="computer"]').click();
    for (const os of ['other', 'unsure']) {
      await page.locator(`#computer [data-os="${os}"]`).click();
      await expectPanel(page, 'device');
      await expect(page.locator('#plan')).toBeHidden();
      await expect(page.locator('#device a[href*="/releases/download/"]')).toHaveCount(0);
      await page.goto(`${language.path}#plan`);
      await expectPanel(page, 'computer', false);
      await expect(page.locator('#plan')).toBeHidden();
    }
  });

  test(`${language.name}: the complete guide stays useful with JavaScript disabled`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    try {
      await page.goto(`${origin}${language.path}`);
      await expect(page.locator('noscript .fallback-note')).toBeVisible();
      await expect(page.locator('[data-panel]:visible')).toHaveCount(7);
      await expect(page.locator('#text-size')).toBeHidden();
      for (const panel of ['hire', 'computer', 'role', 'device', 'plan', 'explore']) {
        await page.goto(`${origin}${language.path}#${panel}`);
        await expect(page.locator(`#${panel} h2`).first()).toBeVisible();
        await expect(page.locator(`#${panel} a[href]`).first()).toBeVisible();
      }
      const staticPlan = page.locator('#plan noscript .note');
      await expect(staticPlan).toBeVisible();
      await expect(staticPlan).toContainText('Agent');
      await expect(staticPlan).toContainText('Node');
      await expect(page.locator('#installation-guide')).toBeVisible();
      const details = page.locator('#plan details[data-print-open]');
      expect(await details.count()).toBeGreaterThan(0);
      for (const detail of await details.all()) await expect(detail).toHaveAttribute('open', '');
      await expectNoOverflow(page, `${language.code} no JavaScript`);
    } finally {
      await context.close();
    }
  });

  test(`${language.name}: welcome and chosen plan have no automated WCAG A or AA violations`, async ({ page }) => {
    await openGuide(page, language);
    for (const panel of ['welcome', 'plan']) {
      if (panel === 'plan') await makePlan(page, 'node');
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(result.violations, `${language.name} ${panel}: ${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
    }
  });

  test(`${language.name}: welcome and plan reflow on small screens and with larger text`, async ({ page }, testInfo) => {
    await openGuide(page, language);
    for (const panel of ['welcome', 'plan']) {
      if (panel === 'plan') await makePlan(page, 'node');
      for (const largeText of [false, true]) {
        if ((await page.locator('#text-size').getAttribute('aria-pressed')) !== String(largeText)) await page.locator('#text-size').click();
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
          await expectNoOverflow(page, `${language.name} ${panel}, ${width}px, larger text=${largeText}`);
          if (width === 390 && largeText) await screenshot(page, testInfo, `${language.name.replaceAll(' ', '-')}-mobile-${panel}-large-text`);
        }
      }
    }
  });
}

test('the browser Back and Forward buttons follow the choices and preserve their meaning', async ({ page }) => {
  await openGuide(page);
  await makePlan(page, 'node');
  for (const panel of ['role', 'computer', 'welcome']) {
    await page.goBack();
    await expectPanel(page, panel, true, panel === 'welcome');
  }
  for (const panel of ['computer', 'role', 'plan']) {
    await page.goForward();
    await expectPanel(page, panel);
  }
  await expect(page.locator('#plan-title')).toContainText('Node');
});

test('reloading and switching language preserve the selected role, step and larger text', async ({ page }) => {
  await openGuide(page);
  await page.locator('#text-size').click();
  await makePlan(page, 'node');
  await page.reload();
  await expectPanel(page, 'plan', false);
  await expect(page.locator('#text-size')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('header a[hreflang="fr"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expectPanel(page, 'plan', false);
  await expect(page.locator('#plan-title')).toContainText('Node');
  await expect(page.locator('#text-size')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('header a[hreflang="en"]').click();
  await expectPanel(page, 'plan', false);
  await expect(page.locator('#plan-title')).toContainText('Node');
});

test('starting again clears the journey while keeping the larger-text preference', async ({ page }) => {
  await openGuide(page);
  await page.locator('#text-size').click();
  await makePlan(page, 'node');
  await page.locator('#reset-choices').click();
  await expectPanel(page, 'welcome');
  await expect(page.locator('#text-size')).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expectPanel(page, 'welcome');
  await expect(page.locator('#text-size')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expectPanel(page, 'welcome', false);
  await expect(page.locator('html')).toHaveClass(/large-text/);
  await page.goto('/start.html#plan');
  await expect(page.locator('#plan')).toBeHidden();
  await expectPanel(page, 'computer', false);
});

test('a direct plan link cannot skip the computer and role choices', async ({ page }) => {
  await openGuide(page, languages[0], '#plan');
  await expectPanel(page, 'computer', false);
  await page.locator('#computer [data-os="ubuntu"]').click();
  await page.goto('/start.html#plan');
  await expectPanel(page, 'role', false);
  await expect(page.locator('#plan')).toBeHidden();
});

test('blocked browser storage leaves every route and larger text usable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openGuide(page);
  await expect(page.locator('#save-status')).toContainText(/cannot save/i);
  await page.locator('#text-size').click();
  await makePlan(page, 'agent');
  await expect(page.locator('#plan-title')).toContainText('Agent');
  await page.locator('#reset-choices').click();
  await expectPanel(page, 'welcome');
  await expect(page.locator('html')).toHaveClass(/large-text/);
  expect(errors).toEqual([]);
});

test('printing includes the selected plan and closed details, then restores the screen', async ({ page }) => {
  await openGuide(page);
  await makePlan(page, 'node');
  const details = page.locator('#plan details[data-print-open]');
  expect(await details.count()).toBeGreaterThan(0);
  const initial = await details.evaluateAll(elements => elements.map(element => element.open));
  expect(initial).toContain(false);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  for (const detail of await details.all()) await expect(detail).toHaveAttribute('open', '');
  await expect(page.locator('#plan-title')).toBeVisible();
  await expect(page.locator('#plan-title')).toContainText('Node');
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#role-login')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expectPanel(page, 'plan');
  expect(await details.evaluateAll(elements => elements.map(element => element.open))).toEqual(initial);
});

test('a denied clipboard offers a labelled, read-only, selectable helper plan', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  });
  await openGuide(page);
  await makePlan(page, 'node');
  await page.locator('#copy-plan').click();
  const fallback = page.locator('textarea#plan-copy-text');
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute('readonly', '');
  await expect(fallback).toHaveAccessibleName(/.+/);
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveValue(/Node/);
  await expect(fallback).toHaveValue(/Ubuntu Desktop 24\.04 LTS/);
  await expect(fallback).toHaveValue(/v\d+\.\d+\.\d+/);
  await expect(fallback).toHaveValue(/8\s*GB/);
  await expect(fallback).toHaveValue(/Checker/);
  await expect(fallback).toHaveValue(/Reviewer/);
  await expect(fallback).toHaveValue(/packages\/AGI_Node/);
  await expect(fallback).not.toHaveValue(/Creator/);
  await expect(fallback).toHaveValue(/https:\/\/github\.com\/MontrealAI\/AGI-Fleet-Linux\/blob\/main\/docs\/FRESH_INSTALL\.md/);
  const selection = await fallback.evaluate(element => ({ start: element.selectionStart, end: element.selectionEnd, length: element.value.length }));
  expect(selection.start).toBe(0);
  expect(selection.end).toBe(selection.length);
  await expect(page.locator('#copy-status')).not.toBeEmpty();
});

test('a keyboard user can enter the guide, choose a path and return with visible focus', async ({ page }) => {
  await openGuide(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('a.skip')).toBeFocused();
  await page.keyboard.press('Enter');
  const choice = page.locator('#welcome [data-go="computer"]');
  for (let presses = 0; presses < 12; presses++) {
    if (await choice.evaluate(element => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(choice).toBeFocused();
  await page.keyboard.press('Enter');
  await expectPanel(page, 'computer');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#computer [data-back="welcome"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expectPanel(page, 'welcome');
  await page.keyboard.press('Tab');
  await expect(page.locator('#welcome [data-go="hire"]')).toBeFocused();
  const outline = await page.locator(':focus').evaluate(element => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('both mobile homepages prominently offer Linux and Mac guided welcomes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const language of languages) {
    await page.goto(language.home);
    const primary = page.locator(`.hero a[href^="${language.path.slice(1)}"]`).first();
    await expect(primary).toBeVisible();
    await expectNoOverflow(page, `${language.code} mobile homepage`);
    await screenshot(page, testInfo, `${language.name.replaceAll(' ', '-')}-mobile-homepage`);
    await primary.click();
    await expect(page.locator('html')).toHaveAttribute('lang', language.code);
    await expectPanel(page, 'welcome', false);
  }
});


test('Mac and Linux choices stay separate across language changes, reloads and browser history', async ({ page }) => {
  await openGuide(page);
  await makePlan(page, 'agent');
  await page.goto('/mac.html');
  await expectPanel(page, 'welcome', false);
  await page.locator('#text-size').click();
  await makePlan(page, 'node');
  await page.goBack();
  await expectPanel(page, 'role');
  await page.goForward();
  await expectPanel(page, 'plan');
  await page.locator('header a[hreflang="fr"]').click();
  await expectPanel(page, 'plan', false);
  await expect(page.locator('#plan-title')).toContainText('Node');
  await expect(page.locator('#text-size')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#plan-title')).toContainText('Node');
  await page.goto('/start-fr.html');
  await expectPanel(page, 'plan', false);
  await expect(page.locator('#plan-title')).toContainText('Agent');
  await expect(page.locator('#text-size')).toHaveAttribute('aria-pressed', 'false');
  await page.goto('/mac-fr.html');
  await expectPanel(page, 'plan', false);
  await page.locator('#reset-choices').click();
  await expectPanel(page, 'welcome');
  await expect(page.locator('#text-size')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/mac.html#plan');
  await expectPanel(page, 'computer', false);
});

test('Mac guide refuses a Linux or Intel choice injected into its saved plan', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agi-fleet-macos-onboarding-v1', JSON.stringify({version: 1, path: 'worker', os: 'ubuntu', role: 'agent', panel: 'plan'}));
  });
  await openGuide(page, languages[2], '#plan');
  await expectPanel(page, 'computer', false);
  await expect(page.locator('#plan')).toBeHidden();
  await page.locator('#computer [data-os="other"]').click();
  await expect(page.locator('#device-description')).toContainText('Intel');
  await expect(page.locator('#device a[href*="/releases/download/"]')).toHaveCount(0);
});

test('Mac plan can be copied manually and printed with its native setup and honest readiness', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  });
  await openGuide(page, languages[2]);
  await makePlan(page, 'node');
  await page.locator('#copy-plan').click();
  const summary = page.locator('#plan-copy-text');
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(summary).toHaveValue(/AGI Fleet for Mac/);
  await expect(summary).toHaveValue(/macOS 15/);
  await expect(summary).toHaveValue(/Standard/);
  await expect(summary).toHaveValue(/16 GB/);
  await expect(summary).toHaveValue(/8 GB.*not been qualified/);
  await expect(summary).toHaveValue(/unsigned and unnotarized/);
  await expect(summary).toHaveValue(/macos\/docs\/FRESH_INSTALL.md/);
  await expect(summary).not.toHaveValue(/Ubuntu|packages\/AGI_Node|Creator/);
  const details = page.locator('#plan details[data-print-open]');
  const initial = await details.evaluateAll(items => items.map(item => item.open));
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({media: 'print'});
  for (const detail of await details.all()) await expect(detail).toHaveAttribute('open', '');
  await expect(page.locator('#plan .timeline')).toContainText('Install.command');
  await expect(page.locator('#role-login')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({media: 'screen'});
  expect(await details.evaluateAll(items => items.map(item => item.open))).toEqual(initial);
});

test('Linux computer choices link directly to the matching Mac setup guide', async ({ page }) => {
  for (const language of languages.filter(item => item.os === 'ubuntu')) {
    await openGuide(page, language, '#computer');
    const target = language.code === 'fr' ? 'mac-fr.html#computer' : 'mac.html#computer';
    await page.locator(`#computer a[href="${target}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-platform', 'macos');
    await expect(page.locator('html')).toHaveAttribute('lang', language.code);
    await expectPanel(page, 'computer', false);
  }
});
