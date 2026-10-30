const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT || __dirname;
const PHASE = process.env.PHASE || 'after';
const report = {};
async function prepare(ctx, theme) {
  await ctx.addCookies([{ name: 'wesetup-theme', value: theme, url: BASE }]);
  await ctx.addInitScript((t) => { try { localStorage.setItem('wesetup-app-theme', t); localStorage.setItem('wesetup-theme-mode', t); localStorage.setItem('wesetup-theme-auto-schedule', '0'); localStorage.setItem('journal-automation-staff-v1', 'collapsed'); } catch {} }, theme);
  await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
}
async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.fill('#email', 'admin@haccp.local');
  await page.fill('#password', 'admin1234');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);
  // Активная точка — «д/с №68» (на ней документы гигиенического журнала).
  await page.evaluate(() => fetch('/api/me/active-building', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildingId: 'loc-p01' }) }));
  return page;
}
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  for (let i = 0; i < 3; i++) { if (!(await page.$('[role="dialog"]'))) break; await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.waitForTimeout(900);
}
const listInfo = (page, root) => page.evaluate((rootSel) => {
  const root = document.querySelector(rootSel);
  if (!root) return null;
  const options = root.querySelectorAll('[data-point-option], [data-location-option]');
  const viewport = root.querySelector('[data-radix-scroll-area-viewport]');
  const bar = root.querySelector('[data-scroll-list-bar]');
  const manage = [...root.querySelectorAll('a')].find((a) => a.getAttribute('href')?.includes('/settings/buildings'));
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
  return {
    options: options.length,
    rootRect: rect(root),
    listHeight: viewport ? Math.round(viewport.getBoundingClientRect().height) : null,
    listScrollHeight: viewport ? viewport.scrollHeight : null,
    scrollbar: bar ? { visible: getComputedStyle(bar).display !== 'none', rect: rect(bar), width: Math.round(bar.getBoundingClientRect().width) } : null,
    manage: manage ? { rect: rect(manage), inViewport: manage.getBoundingClientRect().bottom <= innerHeight } : null,
    activeRow: (() => { const a = root.querySelector('[data-active-option]'); if (!a) return null; const label = a.querySelector('.truncate'); const check = a.querySelector('svg:last-of-type'); const r = a.getBoundingClientRect(); return { rowRight: Math.round(r.right), labelOverflow: label ? label.scrollWidth > label.clientWidth : null, labelRight: label ? Math.round(label.getBoundingClientRect().right) : null, checkRight: check ? Math.round(check.getBoundingClientRect().right) : null, barLeft: (() => { const b = root.querySelector('[data-scroll-list-bar]'); return b ? Math.round(b.getBoundingClientRect().left) : null; })() }; })(),
    captions: [...root.querySelectorAll('div,span')].filter((el) => el.children.length === 0 && el.textContent.trim().toUpperCase() === 'ТОЧКИ' && getComputedStyle(el).textTransform === 'uppercase').length,
  };
}, root);
(async () => {
  const browser = await chromium.launch();
  // ПК: выпадающий список точек.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU', reducedMotion: 'reduce' });
    await prepare(ctx, 'light');
    const page = await login(ctx);
    await page.goto(BASE + '/journals/hygiene', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    await page.screenshot({ path: `${OUT}/${PHASE}-docs-pc-light.png`, clip: { x: 256, y: 0, width: 1184, height: 640 } });
    await page.click('[data-current-point="switch"]');
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(500);
    report.pcDropdown = await listInfo(page, '[role="menu"]');
    await page.screenshot({ path: `${OUT}/${PHASE}-points-pc.png`, clip: { x: 400, y: 0, width: 800, height: 900 } });
    await ctx.close();
  }
  // ПК, тёмная тема: список документов.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU', reducedMotion: 'reduce' });
    await prepare(ctx, 'dark');
    const page = await login(ctx);
    await page.goto(BASE + '/journals/hygiene', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    await page.screenshot({ path: `${OUT}/${PHASE}-docs-pc-dark.png`, clip: { x: 256, y: 0, width: 1184, height: 640 } });
    await ctx.close();
  }
  // Телефон.
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await prepare(ctx, theme);
    const page = await login(ctx);
    await page.goto(BASE + '/journals/hygiene', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    await page.screenshot({ path: `${OUT}/${PHASE}-docs-phone-${theme}.png`, fullPage: false });
    // Стык двух карточек: первая карточка вверху экрана.
    await page.evaluate(() => { const card = document.querySelector('[data-tour="document-card"]'); if (card) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 140); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${PHASE}-docs-phone-${theme}-cards.png`, fullPage: false });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    if (theme === 'dark') { await ctx.close(); continue; }
    report.cards = await page.evaluate(() => [...document.querySelectorAll('[data-tour="document-card"]')].slice(0, 2).map((el) => { const s = getComputedStyle(el); const before = getComputedStyle(el, '::before'); return { border: s.borderTopColor, shadow: s.boxShadow.slice(0, 90), accent: before.content !== 'none' && before.content !== 'normal' ? before.backgroundColor : null, rect: [Math.round(el.getBoundingClientRect().top), Math.round(el.getBoundingClientRect().bottom)] }; }));
    // Лист «Точки».
    await page.click('[data-current-point="switch"]');
    await page.waitForTimeout(900);
    report.phoneSheet = await listInfo(page, '[role="dialog"]');
    await page.screenshot({ path: `${OUT}/${PHASE}-points-phone.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    // Меню (бургер).
    await page.click('[data-nav-burger]');
    await page.waitForTimeout(900);
    const burger = () => page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
      const nav = dialog?.querySelector('[data-sheet-menu]');
      const logout = [...(dialog?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === 'Выйти');
      const r = logout?.getBoundingClientRect();
      return {
        mode: nav?.getAttribute('data-mobile-nav-mode'),
        pointsInMenu: [...(dialog?.querySelectorAll('button') || [])].filter((b) => /Одинцов/.test(b.textContent)).length,
        logoutInsideMenu: Boolean(logout && nav?.contains(logout)),
        logoutRect: r ? [Math.round(r.top), Math.round(r.bottom)] : null,
      };
    });
    if (await page.$('[data-sheet-menu] [data-place-root]')) {
      await page.click('[data-sheet-menu] [data-place-root]');
      await page.waitForTimeout(700);
    }
    report.burgerOpen = await burger();
    await page.screenshot({ path: `${OUT}/${PHASE}-burger-phone.png` });
    await page.evaluate(() => { const body = [...document.querySelectorAll('[role="dialog"]')].pop()?.querySelector('.overflow-y-auto'); if (body) body.scrollTop = body.scrollHeight; });
    await page.waitForTimeout(500);
    report.burgerScrolled = await burger();
    await page.screenshot({ path: `${OUT}/${PHASE}-burger-phone-bottom.png` });
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
