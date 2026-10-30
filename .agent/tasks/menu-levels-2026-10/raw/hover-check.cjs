const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
// Цвет текста ступеней карточки «Вы здесь» до и при наведении — в светлой и тёмной теме.
(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
    await ctx.addCookies([{ name: 'wesetup-theme', value: theme, url: BASE }]);
    await ctx.addInitScript((t) => { try { localStorage.setItem('wesetup-app-theme', t); localStorage.setItem('wesetup-theme-mode', t); localStorage.setItem('wesetup-theme-auto-schedule', '0'); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(1500);
    await page.fill('#email', 'admin@haccp.local');
    await page.fill('#password', 'admin1234');
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);
    await page.goto(BASE + '/journals', { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(1200);
    const color = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).color, sel);
    const out = {};
    for (const [name, sel] of [['root', 'aside [data-place-root]'], ['company', 'aside [data-place-section="company"]']]) {
      await page.mouse.move(900, 600);
      await page.waitForTimeout(250);
      const idle = await color(sel);
      await page.hover(sel);
      await page.waitForTimeout(400);
      out[name] = { idle, hover: await color(sel) };
    }
    out.current = await color('aside [data-place-current]');
    report[theme] = out;
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
