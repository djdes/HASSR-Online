const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const base = 'http://localhost:3000';
  await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 120000 });
  await page.fill('input[placeholder="name@company.com"]', 'owner-ui@example.test');
  await page.fill('input[placeholder="••••••••"]', 'Passw0rd!ui');
  await page.click('form button[type="submit"]');
  await page.waitForURL(/home|dashboard|journals|settings/, { timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  console.log('logged in', page.url());
  // Open the shared demo through the API the dialog calls (same cookies).
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/organizations/demo', { method: 'POST' });
    return { status: res.status, body: await res.json() };
  });
  console.log('open demo', JSON.stringify(r));
  await page.goto(base + '/dashboard?welcome-demo=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-testid="demo-org-banner"]', { timeout: 120000 });
  console.log('banner:', (await page.innerText('[data-testid="demo-org-banner"]')).replace(/\n+/g, ' | '));
  await page.screenshot({ path: 'shots/demo-banner.png' });
  await page.waitForTimeout(3000); await page.screenshot({ path: 'shots/demo-banner.png' }); console.log('overlay:', (await page.locator('div.fixed.inset-0').first().innerText().catch(()=>'none')).slice(0,300).replace(/\n+/g,' | '));
  // Leave.
  await page.click('[data-testid="demo-org-banner"] button');
  await page.waitForSelector('[data-testid="demo-org-banner"]', { state: 'detached', timeout: 120000 });
  console.log('left demo, banner gone');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
