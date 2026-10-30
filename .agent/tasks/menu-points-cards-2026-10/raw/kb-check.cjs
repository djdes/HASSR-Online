const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.fill('#email', 'admin@haccp.local'); await page.fill('#password', 'admin1234');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);
  await page.evaluate(() => fetch('/api/me/active-building', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildingId: 'loc-p12' }) }));
  await page.goto(BASE + '/journals/hygiene', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.click('[data-current-point="switch"]');
  await page.waitForSelector('[role="menu"]');
  await page.waitForTimeout(500);
  const vis = () => page.evaluate(() => {
    const vp = document.querySelector('[role="menu"] [data-radix-scroll-area-viewport]');
    const el = document.activeElement;
    const a = document.querySelector('[role="menu"] [data-active-option]');
    const box = (n) => n.getBoundingClientRect();
    const inView = (n) => n && box(n).top >= box(vp).top - 1 && box(n).bottom <= box(vp).bottom + 1;
    return { scrollTop: Math.round(vp.scrollTop), focused: el?.textContent?.trim().slice(0, 30), focusedVisible: inView(el), activeLabel: a?.textContent?.trim().slice(0, 30), activeVisible: inView(a) };
  });
  const open = await vis();
  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  const end = await vis();
  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  const home = await vis();
  const steps = [];
  for (let i = 0; i < 12; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120); const v = await vis(); steps.push(`${v.focused?.slice(0, 22)} | top ${v.scrollTop} | vis ${v.focusedVisible}`); }
  console.log(JSON.stringify({ home, steps }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
