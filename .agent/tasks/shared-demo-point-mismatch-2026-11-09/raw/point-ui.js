const { chromium } = require('playwright');
const DOC = 'cmw9p3lwz0000ad7dfil3qqsz', A = 'cmw9ovy6z0003vw7dre4hp4bf', B = 'cmw9ovy790004vw7dh6r3yoqo';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const base = 'http://localhost:3000';
  const kill = () => page.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach((n) => n.remove())).catch(() => {});
  const point = (id) => page.evaluate(async (buildingId) => {
    const res = await fetch('/api/me/active-building', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildingId }) });
    return res.status;
  }, id);
  await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 120000 });
  await page.fill('input[placeholder="name@company.com"]', 'owner-ui@example.test');
  await page.fill('input[placeholder="••••••••"]', 'Passw0rd!ui');
  await page.click('form button[type="submit"]');
  await page.waitForURL(/home|dashboard|journals|settings/, { timeout: 120000 });
  // Make sure we are at home, not in the demo.
  console.log('point A:', await point(A));
  const url = base + '/journals/hygiene/documents/' + DOC;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(4000); await kill();
  console.log('at A: notice=', await page.locator('[data-point-mismatch]').count(), 'title:', (await page.locator('h1').first().innerText().catch(() => '')).slice(0, 80));
  console.log('point B:', await point(B));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(4000); await kill();
  const notice = page.locator('[data-point-mismatch]');
  console.log('at B: notice=', await notice.count(), '|', (await notice.first().innerText().catch(() => '')).replace(/\n+/g, ' | '));
  await page.screenshot({ path: 'shots/point-mismatch.png' });
  // Primary button switches back to the document's point.
  await notice.locator('button').last().click();
  await page.waitForSelector('[data-point-mismatch]', { state: 'detached', timeout: 120000 });
  console.log('after switch: notice=', await page.locator('[data-point-mismatch]').count(), 'url same:', page.url() === url);
  // Whole organization view: document opens.
  console.log('org view:', await point('organization'));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(3000);
  console.log('org view: notice=', await page.locator('[data-point-mismatch]').count());
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message.slice(0, 600)); process.exit(1); });
