// Real Chromium checks. Test tooling stays outside the repo; no app dependencies.
// LEGAL_TEST_MODULES=/path/to/node_modules node e2e/legal-pages.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.LEGAL_TEST_MODULES}/package.json`);
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const base = process.env.LEGAL_TEST_URL || 'http://localhost:8354';
const output = new URL('../docs/legal-pages/', import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const normalize = path => path.replace(/\/$/, '') || '/';
const report = { base, pages: [], clicks: [] };
const titles = { '/': 'Ship screenshots that get the tap.', '/news/': 'News', '/changelog/': 'Changelog',
  '/terms': 'Terms of Service', '/privacy': 'Privacy Policy', '/support': 'Support' };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    // Navigation tests never submit the waitlist or send email.
    for (const route of Object.keys(titles)) {
      const response = await page.goto(base + route);
      assert.equal(response.status(), 200, route);
      await page.locator('h1').waitFor();
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('h1').innerText(), titles[route]);
      assert.equal(await page.locator('footer a[href="/terms"]').count(), 1);
      assert.equal(await page.locator('footer a[href="/privacy"]').count(), 1);
      assert.equal(await page.locator('footer a[href="/support"]').count(), 1);
      assert.equal(await page.locator('footer a[href="/support#remove-email"]').count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflow ${width}`);
      const legal = ['/terms', '/privacy', '/support'].includes(route);
      if (legal) {
        assert.equal(await page.locator('script').count(), 0);
        assert.match(await page.locator('main').innerText(), /8063 Madison Ave, PMB 576, Indianapolis, IN 46227/);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to content');
        assert.equal(await page.locator('.skip').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
        await page.keyboard.press('Enter');
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.length })), [], `${route} axe ${width}`);
        await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
        await page.screenshot({ path: new URL(`${route.slice(1)}-${width}.png`, output).pathname, fullPage: true });
        report.pages.push({ route, width, status: 200, h1: titles[route], axeViolations: 0, overflow: false });
      }
      // Click every link on the legal pages and every footer link on existing pages.
      // Also cover the notices adjacent to both signup forms.
      const selector = legal ? 'a' : route === '/' ? 'footer a, .fine a' : 'footer a';
      const links = await page.locator(selector).evaluateAll(els => els.map(el => el.getAttribute('href')));
      for (let index = 0; index < links.length; index++) {
        await page.goto(base + route);
        const link = page.locator(selector).nth(index);
        const href = await link.getAttribute('href');
        assert.equal(href, links[index]);
        if (href === '#main') await link.focus();
        if (href.startsWith('mailto:')) {
          let intercepted = false;
          await page.evaluate(() => document.addEventListener('click', event => {
            const anchor = event.target.closest('a');
            if (anchor?.href.startsWith('mailto:')) { event.preventDefault(); window.mailClick = anchor.href; }
          }));
          await link.click();
          intercepted = await page.evaluate(() => window.mailClick === 'mailto:support@appcaptures.com');
          assert.ok(intercepted, href);
          report.clicks.push({ from: route, width, href, result: 'PASS: mailto click; no message sent' });
        } else {
          const responsePromise = href.startsWith('#') ? null : page.waitForEvent('response', {
            predicate: r => r.request().isNavigationRequest(), timeout: 20000,
          }).catch(() => null);
          await link.click();
          const response = await responsePromise;
          const url = new URL(page.url());
          if (href.startsWith('http')) {
            assert.ok(response && response.status() < 400, `${href}: ${response?.status()}`);
            report.clicks.push({ from: route, width, href, result: `PASS: external ${response.status()}`, finalURL: page.url() });
          } else {
            const target = new URL(href, base + route);
            assert.equal(normalize(url.pathname), normalize(target.pathname));
            assert.equal(url.hash, target.hash);
            if (url.hash) assert.equal(await page.locator(url.hash).count(), 1);
            assert.equal(await page.locator('h1').innerText(), Object.entries(titles).find(([path]) => normalize(path) === normalize(url.pathname))[1]);
            report.clicks.push({ from: route, width, href, result: 'PASS: target content and anchor verified' });
          }
        }
      }
    }
    await context.close();
  }
  writeFileSync(new URL('browser-results.json', output), `{\n"base":${JSON.stringify(base)},\n"pages":[\n${report.pages.map(row => JSON.stringify(row)).join(',\n')}\n],\n"clicks":[\n${report.clicks.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`);
  console.log(`legal-pages: ${report.pages.length} screenshots; zero axe violations; ${report.clicks.length} link clicks PASS`);
} finally {
  await browser.close();
}
