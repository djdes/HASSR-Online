const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT || __dirname;
const CODE = process.env.CODE;
const PREFIX = process.env.PREFIX || '';
const report = {};
(async () => {
  const browser = await chromium.launch();
  // Публичные страницы — без входа.
  for (const [name, path, width] of [
    ['public-network-390', `/b/${CODE}`, 390],
    ['public-point-390', `/b/${CODE}?point=loc-p01`, 390],
    ['public-point-1280', `/b/${CODE}?point=loc-p01`, 1280],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU' });
    const page = await ctx.newPage();
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${PREFIX}${name}.png`, fullPage: true });
    report[name] = await page.evaluate(() => ({
      status: document.title,
      h1: document.querySelector('h1')?.textContent,
      audience: document.querySelector('[data-badge-today] div')?.textContent,
      facts: [...document.querySelectorAll('[data-badge-facts] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
      dishes: [...document.querySelectorAll('[data-badge-dishes] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
      dishesBlock: document.querySelector('[data-badge-dishes]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? null,
      points: document.querySelectorAll('[data-badge-points] li').length,
      leaks: /Секретно|Иванова|inspector/i.test(document.body.innerText),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }));
    report[name].httpStatus = res.status();
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' });
    const page = await ctx.newPage();
    const res = await page.goto(BASE + `/b/${CODE}?point=unknown-point`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    report.unknownPoint = res.status();
    await ctx.close();
  }
  if (!process.env.SKIP_ADMIN) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(1500);
    await page.fill('#email', 'admin@haccp.local'); await page.fill('#password', 'admin1234');
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);
    await page.goto(BASE + '/settings/organization', { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(1200);
    const card = await page.$('[data-testid="badge-card"]');
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await card.screenshot({ path: `${OUT}/${PREFIX}settings-badge-card.png` });
    report.card = await page.evaluate(() => ({
      todaySwitch: document.querySelector('[data-testid="badge-today-switch"]')?.getAttribute('aria-checked'),
      items: [...document.querySelectorAll('[data-testid="badge-today-items"] li')].map((li) => li.textContent.trim()),
      points: document.querySelectorAll('[data-testid="badge-sign-point"] option').length,
      signHref: document.querySelector('[data-testid="badge-sign-open"]')?.getAttribute('href'),
    }));
    await page.goto(BASE + '/settings/organization/badge-sign?point=loc-p01', { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${PREFIX}sign-screen.png`, fullPage: true });
    await page.pdf({ path: `${OUT}/${PREFIX}sign.pdf`, format: 'A4', printBackground: true });
    report.sign = await page.evaluate(() => ({
      title: document.querySelector('[data-badge-sign] h1')?.textContent,
      qr: Boolean(document.querySelector('[data-badge-sign] svg')),
      url: document.querySelector('[data-badge-sign] [role="img"]')?.getAttribute('aria-label'),
      warning: document.querySelector('[data-badge-sign-warning]')?.textContent ?? null,
    }));
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
