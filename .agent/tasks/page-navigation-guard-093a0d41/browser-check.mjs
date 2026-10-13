import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const raw = fileURLToPath(new URL('./raw/', import.meta.url));
const base = process.env.NAVIGATION_FIXTURE_URL;
assert.ok(base);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { framework: 'Next.js 16.1.6 production fixture importing actual repository proxy', cases: [], responses: [] };
let ip = 10;
async function context(extra = {}) {
  return browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', extraHTTPHeaders: { 'x-real-ip': `198.51.100.${++ip}` }, ...extra });
}
async function fill(ctx) {
  for (let i = 0; i < 25; i++) {
    const response = await ctx.request.get(`${base}/probe/collect-${i}`);
    if (response.status() === 429) return;
    assert.equal(response.status(), 200);
  }
  assert.fail('server did not enforce its page budget');
}
try {
  const ctx = await context({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let prefetched = 0;
  page.on('response', response => {
    const req = response.request();
    if (req.headers()['next-router-prefetch'] || req.headers()['next-router-segment-prefetch']) prefetched++;
    if (response.status() === 429) report.responses.push({ status: 429, resource: req.resourceType(), rsc: req.headers().rsc ?? null, prefetch: req.headers()['next-router-prefetch'] ?? null, segment: req.headers()['next-router-segment-prefetch'] ?? null, path: new URL(req.url()).pathname });
  });
  assert.equal((await page.goto(`${base}/probe/start`)).status(), 200);
  await page.waitForFunction(() => Array.from(document.scripts).some(x => x.src.includes('/_next/static/')));
  await page.waitForTimeout(2000);
  assert.ok(prefetched > 0, 'actual Next Link prefetch observed');
  await page.locator('#next-page').click();
  await page.waitForURL('**/probe/start-next?kept=yes');
  await page.getByRole('heading', { name: 'Fixture page start-next', exact: true }).waitFor();
  report.cases.push({ name: 'normal Next client navigation and real Link prefetch', pass: true, prefetchResponses: prefetched });
  await fill(ctx);
  await page.locator('#next-page').click();
  await page.getByRole('heading', { name: 'Слишком много переходов' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/probe/start-next-next');
  assert.equal(new URL(page.url()).searchParams.get('kept'), 'yes');
  assert.ok(report.responses.some(x => x.rsc === '1'), 'real RSC response was throttled');
  assert.ok(report.responses.some(x => x.resource === 'document'), 'Next fell back to the document wait page');
  assert.equal(await page.locator('#retry').isDisabled(), true);
  const first = Number(await page.locator('#seconds').textContent());
  await page.waitForTimeout(1100);
  assert.ok(Number(await page.locator('#seconds').textContent()) < first);
  await page.screenshot({ path: raw + 'wait-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: raw + 'wait-320.png', fullPage: true });
  report.cases.push({ name: 'RSC 429 to document, same URL/query, countdown, desktop and 320px', pass: true });

  // Enabling the button in devtools must not defeat server enforcement.
  await page.locator('#retry').evaluate(button => { button.disabled = false; });
  const premature = page.waitForResponse(r => r.request().resourceType() === 'document');
  await page.locator('#retry').click();
  assert.equal((await premature).status(), 429);
  await page.getByRole('heading', { name: 'Слишком много переходов' }).waitFor();
  const seconds = Number(await page.locator('#seconds').textContent());
  assert.ok(seconds <= first && seconds > 0);
  assert.equal(await page.locator('#retry').isDisabled(), true);
  const asset = await ctx.request.get(`${base}/_next/static/definitely-missing.js`);
  assert.notEqual(asset.status(), 429, 'assets do not get a wait screen');
  report.cases.push({ name: 'premature retry is server-blocked; asset request is excluded', pass: true });
  await page.waitForFunction(() => !document.getElementById('retry').disabled, undefined, { timeout: 35_000 });
  const sameUrl = page.url();
  const recovered = page.waitForResponse(r => r.request().resourceType() === 'document');
  await page.locator('#retry').click();
  assert.equal((await recovered).status(), 200);
  await page.getByRole('heading', { name: 'Fixture page start-next-next', exact: true }).waitFor();
  assert.equal(page.url(), sameUrl);
  report.cases.push({ name: 'real 30-second server cooldown expires; enabled retry restores same URL', pass: true });
  await ctx.close();

  const nojs = await context({ javaScriptEnabled: false, viewport: { width: 320, height: 700 } });
  await fill(nojs);
  const plain = await nojs.newPage();
  const blocked = await plain.goto(`${base}/probe/nojs`);
  assert.equal(blocked.status(), 429);
  assert.match(blocked.headers()['cache-control'], /no-store/);
  assert.equal(blocked.headers()['x-robots-tag'], 'noindex, nofollow');
  assert.ok(Number(blocked.headers()['retry-after']) > 0);
  await plain.getByText('Если отсчёт не меняется', { exact: false }).waitFor();
  await plain.screenshot({ path: raw + 'wait-nojs.png', fullPage: true });
  report.cases.push({ name: 'no-JavaScript explanation, document 429 and response headers', pass: true });
  await nojs.close();
  const rsc = await context();
  for (let batch = 0; batch < 60; batch++) {
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => rsc.request.get(`${base}/probe/rsc-${batch}-${i}`, { headers: { rsc: '1', 'sec-fetch-dest': 'empty' } })));
    for (const result of results) assert.equal(result.status(), 200);
  }
  assert.equal((await rsc.request.get(`${base}/probe/rsc-overflow`, { headers: { rsc: '1', 'sec-fetch-dest': 'empty' } })).status(), 429);
  assert.equal((await rsc.request.get(`${base}/probe/shared-cooldown`)).status(), 429);
  report.cases.push({ name: 'actual Next server enforces markerless RSC budget at 241 and shares document cooldown', pass: true });
  await rsc.close();
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await fs.writeFile(raw + 'browser-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await browser.close();
}
