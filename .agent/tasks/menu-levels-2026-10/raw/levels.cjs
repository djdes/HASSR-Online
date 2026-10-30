const { chromium } = require('playwright');
const OUT = process.env.OUT || __dirname;
const BASE = process.env.BASE || 'http://localhost:3100';
const report = {};
async function prepare(ctx, theme) {
  await ctx.addCookies([{ name: 'wesetup-theme', value: theme, url: BASE }]);
  await ctx.addInitScript((t) => { try { localStorage.setItem('wesetup-app-theme', t); localStorage.setItem('wesetup-theme-mode', t); localStorage.setItem('wesetup-theme-auto-schedule', '0'); } catch {} }, theme);
  await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
}
async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.fill('#email', 'admin@haccp.local');
  await page.fill('#password', 'admin1234');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);
  return page;
}
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  for (let i = 0; i < 3; i++) { if (!(await page.$('[role="dialog"]'))) break; await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.waitForTimeout(900);
}
const place = (page) => page.evaluate(() => {
  const nav = document.querySelector('aside [data-section-place]');
  if (!nav) return null;
  return {
    steps: [...nav.querySelectorAll('li')].map((li) => li.textContent.trim()),
    current: nav.querySelector('[aria-current="location"]')?.textContent.trim(),
    tone: nav.getAttribute('data-tone'),
    bg: getComputedStyle(nav).backgroundColor,
  };
});
(async () => {
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU', reducedMotion: 'reduce' });
    await prepare(ctx, theme);
    const page = await login(ctx);
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    await page.mouse.move(900, 600);
    await page.screenshot({ path: `${OUT}/level0-main-${theme}.png`, clip: { x: 0, y: 0, width: 256, height: 900 } });
    const stackMain = await page.evaluate(() => getComputedStyle(document.querySelector('aside [data-nav-section="company"] [data-nav-chip]')).boxShadow);
    const steps = [['aside [data-nav-section="company"]', 'company', 'level1-company'], ['aside [data-menu-section="points"]', 'points', 'level2-points'], ['aside [data-menu-section="journals"]', 'journals', 'level3-journals']];
    for (const [sel, key, name] of steps) {
      await page.click(sel);
      await page.waitForSelector(`aside[data-app-sidebar][data-sidebar-section="${key}"]`, { timeout: 180000 });
      await settle(page);
      await page.mouse.move(900, 600);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, clip: { x: 0, y: 0, width: 256, height: 900 } });
      report[`${name}-${theme}`] = await place(page);
    }
    if (theme === 'light') {
      report.stackMainChip = stackMain;
      report.stackPointsRow = await page.evaluate(() => null);
      // С уровня 3 — сразу в «Мою компанию» ступенью карточки.
      await page.click('aside [data-section-place] [data-place-section="company"]');
      await page.waitForSelector('aside[data-app-sidebar][data-sidebar-section="company"]', { timeout: 180000 });
      await settle(page);
      report.jumpToCompany = await page.evaluate(() => ({ url: location.pathname, focus: document.activeElement?.getAttribute('data-menu-section') ?? document.activeElement?.tagName }));
      await page.screenshot({ path: `${OUT}/jump-company-light.png`, clip: { x: 0, y: 0, width: 256, height: 900 } });
      // «Главное меню» — главное меню и главная.
      await page.click('aside [data-section-place] [data-place-root]');
      await page.waitForSelector('aside[data-app-sidebar][data-sidebar-mode="main"]', { timeout: 180000 });
      await settle(page);
      report.jumpToMain = await page.evaluate(() => ({ url: location.pathname, focus: document.activeElement?.getAttribute('data-nav-section') ?? document.activeElement?.tagName }));
      // Стопка у пункта с меню, у страницы — нет.
      await page.click('aside [data-nav-section="company"]');
      await page.waitForSelector('aside[data-app-sidebar][data-sidebar-section="company"]', { timeout: 180000 });
      await settle(page);
      report.stack = await page.evaluate(() => ({
        pointsRow: getComputedStyle(document.querySelector('aside [data-menu-section="points"] [data-nav-chip]')).boxShadow,
        masterRow: getComputedStyle(document.querySelector('aside [data-menu-item="master"] [data-nav-chip]')).boxShadow,
      }));
    }
    await ctx.close();
  }
  // Телефон: лист меню.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await prepare(ctx, 'light');
    const page = await login(ctx);
    await page.goto(BASE + '/settings/equipment', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    await page.click('[data-nav-burger]');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/sheet-points-light.png` });
    report.sheetPoints = await page.evaluate(() => [...document.querySelectorAll('[data-sheet-menu] [data-section-place] li')].map((li) => li.textContent.trim()));
    await page.click('[data-sheet-menu] [data-section-place] [data-place-section="company"]');
    await page.waitForTimeout(700);
    report.sheetAfterJump = await page.evaluate(() => ({ url: location.pathname, steps: [...document.querySelectorAll('[data-sheet-menu] [data-section-place] li')].map((li) => li.textContent.trim()) }));
    await page.screenshot({ path: `${OUT}/sheet-company-light.png` });
    await ctx.close();
  }
  // Каскад входа: ступени карточки, затем пункты; «уменьшить движение» — без анимации.
  for (const motion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', reducedMotion: motion });
    await prepare(ctx, 'light');
    const page = await login(ctx);
    await page.goto(BASE + '/journals', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    report[`cascade-${motion}`] = await page.evaluate(() => [...document.querySelectorAll('aside [data-nav-rise] [data-nav-row]')].slice(0, 7).map((el) => {
      const s = getComputedStyle(el);
      return `${el.textContent.trim().slice(0, 24)} | ${s.animationName} ${s.animationDelay}`;
    }));
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
