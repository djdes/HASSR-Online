const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT || __dirname;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.fill('#email', 'admin@haccp.local'); await page.fill('#password', 'admin1234');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);
  const state = () => page.evaluate(() => {
    const sheet = document.querySelector('[data-sheet-menu]');
    const active = document.activeElement;
    return {
      url: location.pathname,
      mode: sheet?.getAttribute('data-mobile-nav-mode'),
      section: sheet?.getAttribute('data-mobile-nav-section'),
      steps: [...(sheet?.querySelectorAll('[data-section-place] li') || [])].map((li) => (li.hasAttribute('data-current') ? '*' : '') + li.textContent.trim()),
      focus: active ? (active.getAttribute('data-nav-key') || active.getAttribute('data-section-key') || active.textContent.trim().slice(0, 40)) : null,
    };
  });
  const report = {};
  // Level 3: a page inside Журналы (company → points → journals).
  await page.goto(BASE + '/journals', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.click('[data-nav-burger]');
  await page.waitForTimeout(900);
  report.open = await state();
  await page.screenshot({ path: OUT + '/sheet-level3.png' });
  await page.click('[data-sheet-menu] [data-place-section="company"]');
  await page.waitForTimeout(900);
  report.afterCompany = await state();
  await page.screenshot({ path: OUT + '/sheet-after-company.png' });
  await page.click('[data-sheet-menu] [data-place-root]');
  await page.waitForTimeout(900);
  report.afterRoot = await state();
  await page.screenshot({ path: OUT + '/sheet-after-root.png' });
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
