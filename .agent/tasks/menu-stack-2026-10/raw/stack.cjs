const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT || __dirname;
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
const stack = (page, rootSel) => page.evaluate((sel) => {
  const box = document.querySelector(sel);
  const place = box?.querySelector('[data-section-place]');
  if (!place) return null;
  const tabs = [...place.querySelectorAll('[data-place-tab] > a, [data-place-tab] > button')].map((el) => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { label: el.textContent.trim(), width: Math.round(r.width), top: Math.round(r.top), bg: s.backgroundColor, img: s.backgroundImage.slice(0, 60), color: s.color };
  });
  const card = place.querySelector('[data-place-card]');
  const head = card?.querySelector('[aria-current="location"]');
  const cs = card ? getComputedStyle(card) : null;
  return {
    tabs,
    card: card ? { width: Math.round(card.getBoundingClientRect().width), top: Math.round(card.getBoundingClientRect().top), border: cs.borderTopColor, bg: cs.backgroundColor, tone: card.getAttribute('data-tone'), head: head?.textContent.trim() } : null,
    backButtons: box.querySelectorAll('[data-back-to-main]').length,
  };
}, rootSel);
(async () => {
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU', reducedMotion: 'reduce' });
    await prepare(ctx, theme);
    const page = await login(ctx);
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    await page.mouse.move(900, 600);
    const steps = [['aside [data-nav-section="company"]', 'company', 'level1-company'], ['aside [data-menu-section="points"]', 'points', 'level2-points'], ['aside [data-menu-section="journals"]', 'journals', 'level3-journals']];
    for (const [sel, key, name] of steps) {
      await page.click(sel);
      await page.waitForSelector(`aside[data-app-sidebar][data-sidebar-section="${key}"]`, { timeout: 180000 });
      await settle(page);
      await page.mouse.move(900, 600);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, clip: { x: 0, y: 0, width: 256, height: 900 } });
      report[`${name}-${theme}`] = await stack(page, 'aside');
    }
    if (theme === 'light') {
      await page.click('aside [data-section-place] [data-place-section="company"]');
      await page.waitForSelector('aside[data-app-sidebar][data-sidebar-section="company"]', { timeout: 180000 });
      await settle(page);
      report.jumpToCompany = await page.evaluate(() => ({ url: location.pathname, focus: document.activeElement?.getAttribute('data-menu-section') ?? document.activeElement?.tagName }));
      await page.screenshot({ path: `${OUT}/jump-company-light.png`, clip: { x: 0, y: 0, width: 256, height: 900 } });
      await page.click('aside [data-section-place] [data-place-root]');
      await page.waitForSelector('aside[data-app-sidebar][data-sidebar-mode="main"]', { timeout: 180000 });
      await settle(page);
      report.jumpToMain = await page.evaluate(() => ({ url: location.pathname, focus: document.activeElement?.getAttribute('data-nav-section') ?? document.activeElement?.tagName }));
    }
    await ctx.close();
  }
  // Каскад входа и «уменьшить движение».
  for (const motion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', reducedMotion: motion });
    await prepare(ctx, 'light');
    const page = await login(ctx);
    await page.goto(BASE + '/journals', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    report[`cascade-${motion}`] = await page.evaluate(() => [...document.querySelectorAll('aside [data-nav-rise] [data-nav-row]')].slice(0, 7).map((el) => { const s = getComputedStyle(el); return `${el.textContent.trim().slice(0, 22)} | ${s.animationName} ${s.animationDelay}`; }));
    await ctx.close();
  }
  // Телефон: лист сайта и Mini App.
  for (const mode of ['site', 'mini']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await prepare(ctx, 'light');
    const page = await login(ctx);
    if (mode === 'mini') await ctx.addCookies([{ name: 'ws-shell', value: 'mini', url: BASE }]);
    await page.goto(BASE + '/journals', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await settle(page);
    await page.click(mode === 'site' ? '[data-nav-burger]' : '[data-section-menu-button]');
    await page.waitForTimeout(900);
    report[`sheet-${mode}`] = await stack(page, '[role="dialog"]');
    await page.screenshot({ path: `${OUT}/sheet-${mode}-level3.png` });
    await page.click('[role="dialog"] [data-place-section="company"]');
    await page.waitForTimeout(800);
    report[`sheet-${mode}-afterCompany`] = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].pop();
      return { url: location.pathname, tabs: [...d.querySelectorAll('[data-place-tab]')].map((li) => li.textContent.trim()), head: d.querySelector('[data-place-current]')?.textContent.trim(), focus: document.activeElement?.textContent.trim().slice(0, 30) };
    });
    await page.screenshot({ path: `${OUT}/sheet-${mode}-company.png` });
    // Вход глубже стрелкой ›: фокус на ближайшей вкладке.
    const deeper = await page.$('[role="dialog"] button[data-menu-section="points"]');
    if (deeper) {
      await deeper.click();
      await page.waitForTimeout(800);
      report[`sheet-${mode}-openPoints`] = await page.evaluate(() => ({ head: [...document.querySelectorAll('[role="dialog"]')].pop().querySelector('[data-place-current]')?.textContent.trim(), focus: document.activeElement?.textContent.trim().slice(0, 30), focusIsTab: Boolean(document.activeElement?.closest('[data-place-tab]')) }));
    }
    await page.click('[role="dialog"] [data-place-root]');
    await page.waitForTimeout(800);
    report[`sheet-${mode}-afterRoot`] = await page.evaluate(() => ({ place: Boolean([...document.querySelectorAll('[role="dialog"]')].pop().querySelector('[data-section-place]')), focus: document.activeElement?.textContent.trim().slice(0, 30) }));
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
