import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const [route,lang,home,other] of [['demos.html','en','index.html','demos-fr.html'],['demos-fr.html','fr','fr.html','demos.html']]) {
  test(`${lang} original demo directory preserves scope, local routes and responsive access`,async({page},testInfo)=>{
    await page.goto('/'+route);await expect(page.locator('html')).toHaveAttribute('lang',lang);await expect(page.locator('article')).toHaveCount(6);
    for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});for(const scale of [100,200]){await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}}
    await page.evaluate(()=>document.documentElement.style.fontSize='100%');expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    for(const href of [home,other,lang==='fr'?'successor-fr.html':'successor.html',lang==='fr'?'mac-fr.html':'mac.html'])expect((await page.request.get('/'+href)).status()).toBe(200);
    await page.screenshot({path:testInfo.outputPath('directory-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:900});
    await page.screenshot({path:testInfo.outputPath('directory-mobile.png'),fullPage:true});
    await page.locator('summary').first().focus();await page.keyboard.press('Enter');await expect(page.locator('details').first()).toHaveAttribute('open','');
    for(const href of await page.locator('a[href*="github.com"]').evaluateAll(nodes=>nodes.map(n=>n.href)))expect(href).toMatch(/\/(blob|commit)\/[0-9a-f]{40}(\/|$)/);
  });
  test(`${lang} directory remains useful without JavaScript`,async({browser})=>{const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('http://127.0.0.1:4173/'+route);await expect(page.locator('article')).toHaveCount(6);await page.locator('summary').first().click();await expect(page.locator('pre').first()).toBeVisible();await context.close();});
}
