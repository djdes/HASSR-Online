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
  await ctx.addCookies([{ name: 'ws-shell', value: 'mini', url: BASE }]);
  await page.goto(BASE + '/journals', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1500);
  const state = () => page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role=dialog]')].pop();
    const active = document.activeElement;
    return {
      url: location.pathname,
      button: document.querySelector('[data-section-menu-button]')?.getAttribute('data-section-menu-button') ?? null,
      title: dialog?.querySelector('h2, [data-sheet-title]')?.textContent?.trim() ?? null,
      steps: [...(dialog?.querySelectorAll('[data-section-place] li') || [])].map((li) => (li.hasAttribute('data-current') ? '*' : '') + li.textContent.trim()),
      stacked: [...(dialog?.querySelectorAll('[data-has-menu]') || [])].map((el) => el.textContent.trim().slice(0, 30)),
      focus: active ? active.textContent.trim().slice(0, 40) : null,
    };
  });
  const report = { before: await state() };
  await page.click('[data-section-menu-button]');
  await page.waitForTimeout(900);
  report.open = await state();
  await page.screenshot({ path: OUT + '/mini-level3.png' });
  await page.click('[role=dialog] [data-place-section="points"]');
  await page.waitForTimeout(900);
  report.afterPoints = await state();
  await page.screenshot({ path: OUT + '/mini-after-points.png' });
  await page.click('[role=dialog] [data-place-root]');
  await page.waitForTimeout(900);
  report.afterRoot = await state();
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
