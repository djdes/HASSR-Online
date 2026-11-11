const { chromium, B, login, header, dismiss } = require('./pts-lib.js');
const RAW = '/home/user/HASSR-Online/.agent/tasks/nav-new-default-2026-11-11/raw';
const path = (page) => new URL(page.url()).pathname;
async function settle(page, ms = 2500) { await page.waitForTimeout(ms); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200); }
async function pick(page, name, expect) { await page.click('[data-current-point="switch"]'); await page.waitForTimeout(400); await page.locator('[data-point-option]', { hasText: name }).first().click(); if (expect) await page.waitForURL(expect, { timeout: 60000 }).catch(() => {}); await settle(page); }
const toasts = (page) => page.$$eval('[data-sonner-toast]', (t) => t.map((e) => e.textContent.trim()));
const hasBack = (page) => page.evaluate(() => !!document.querySelector('[data-new-nav-crumbs] a, [data-new-nav-crumbs] button'));
const crumbs = (page) => page.$$eval('[data-new-nav-crumbs] a, [data-new-nav-crumbs] [aria-current], [data-new-nav-crumbs] span', (e) => [...new Set(e.map((x) => x.textContent.trim()).filter((x) => x && x.length < 40))].slice(0, 6));
(async () => {
  const browser = await chromium.launch();
  const { page } = await login(browser, 'boss@pts.local');
  const steps = []; let n = 0;
  const rec = async (label, shot) => { n++; steps.push(`${n}. ${label} | ${path(page).slice(0, 36)} | ${JSON.stringify(await header(page))} | назад:${await hasBack(page)} | крошки:${JSON.stringify(await crumbs(page))} | ${JSON.stringify(await toasts(page))}`); if (shot) await page.screenshot({ path: `${RAW}/t2-${String(n).padStart(2, '0')}.png` }); };
  // warm compile
  for (const p of ['/settings/buildings', '/dashboard', '/settings/subscription', '/journals/hygiene']) { await page.goto(B + p, { waitUntil: 'networkidle' }).catch(() => {}); await dismiss(page); }
  await page.goto(B + '/home', { waitUntil: 'networkidle' }); await settle(page);
  await pick(page, 'Офис'); await page.goto(B + '/home', { waitUntil: 'networkidle' }); await settle(page);
  await rec('главная, офис');
  await pick(page, 'Школа №8', /settings\/buildings\//); await rec('с главной выбрали точку');
  await page.goto(B + '/dashboard', { waitUntil: 'networkidle' }); await settle(page); await rec('«Сегодня» точки');
  await page.locator('main a[href^="/journals/"]').first().click(); await page.waitForURL(/\/journals\//, { timeout: 60000 }).catch(() => {}); await settle(page); await rec('открыли журнал из «Сегодня»', true);
  // company section via sidebar, then page back arrow
  await page.goto(B + '/dashboard', { waitUntil: 'networkidle' }); await settle(page);
  await page.locator('[data-app-sidebar] a[href="/settings/subscription"]').first().click(); await page.waitForURL(/subscription/, { timeout: 60000 }).catch(() => {}); await settle(page, 1500); await rec('меню «Подписки» с точки', true);
  await page.goBack(); await settle(page); await rec('«назад» браузера → точка вернулась?');
  // toast action
  await page.locator('[data-app-sidebar] a[href="/settings/subscription"]').first().click(); await page.waitForURL(/subscription/, { timeout: 60000 }).catch(() => {}); await settle(page, 1200);
  const act = page.locator('[data-sonner-toast] button', { hasText: 'Вернуться' }).first();
  await rec('снова «Подписки», тост с кнопкой: ' + (await act.count()));
  if (await act.count()) { await act.click(); await settle(page); await rec('нажали «Вернуться на …»'); }
  // forward via menu after company section keeps office
  await page.locator('[data-app-sidebar] a[href="/settings/subscription"]').first().click(); await page.waitForURL(/subscription/, { timeout: 60000 }).catch(() => {}); await settle(page);
  await page.goto(B + '/settings/buildings', { waitUntil: 'networkidle' }); await settle(page);
  await page.locator('main a[href^="/settings/buildings/c"]').nth(2).click(); await page.waitForURL(/buildings\/c/, { timeout: 60000 }).catch(() => {}); await settle(page); await rec('из списка открыли 3-ю точку');
  const back = page.locator('[data-new-nav-crumbs] a, [data-new-nav-crumbs] button').first(); await back.click(); await settle(page); await rec('стрелка «назад» со страницы точки');
  for (const p of ['/monitoring', '/more', '/inspection', '/news', '/settings/users', '/settings/qr-posters', '/verifications', '/settings/sections/journals']) { await page.goto(B + p, { waitUntil: 'networkidle' }).catch(() => {}); await settle(page, 800); await rec('страница ' + p); }
  console.log(steps.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
