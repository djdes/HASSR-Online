const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT;
const report = {};
(async () => {
  const browser = await chromium.launch();
  for (const [width, suffix] of [[1440, 'desktop'], [390, 'mobile']]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(1200);
    await page.fill('#email', 'admin@haccp.local'); await page.fill('#password', 'admin1234');
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);
    // Скрыть баннер cookie, чтобы не перекрывал список.
    await page.evaluate(() => { try { localStorage.setItem('cookie-consent', '1'); } catch {} });
    for (const [name, path] of [
      ['labels-7d', '/settings/print-agent/labels?period=7d'],
      ['labels-attention', '/settings/print-agent/labels?period=7d&attention=1'],
      ['labels-today', '/settings/print-agent/labels'],
    ]) {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 180000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${name}-${suffix}.png`, fullPage: true });
      report[`${name}-${suffix}`] = await page.evaluate(() => ({
        items: [...document.querySelectorAll('[data-label-log] li')].map((li) => li.dataset.labelStatus + ' | ' + li.textContent.replace(/\s+/g, ' ').trim().slice(0, 160)),
        empty: document.querySelector('[data-label-log]') ? null : document.body.innerText.includes('этикеток нет') || document.body.innerText.includes('Истекающих'),
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      }));
    }
    await page.goto(BASE + '/settings/print-agent', { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(800);
    const card = await page.$('[data-label-log-summary]');
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${OUT}/summary-${suffix}.png` });
    report[`summary-${suffix}`] = await card.evaluate((el) => el.textContent.replace(/\s+/g, ' ').trim());
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
