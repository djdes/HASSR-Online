// Съёмка экранов кабинета для слайдера на главной (демо-база, не прод).
// node capture-screens.cjs <id> <path> [desktopScroll] [mobileScroll|selector] [storageState]
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3456';
const OUT = process.env.OUT;
const HIDE = `nextjs-portal, [data-bug-report-ignore], [data-fab-dock], [data-testid="today-next-sticky"] { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }`;
(async () => {
  const [id, route, desktopScroll = '0', mobileScroll = '0', state] = process.argv.slice(2);
  const browser = await chromium.launch();
  for (const [variant, opts] of [
    ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
    ['mobile', { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    const ctx = await browser.newContext({ ...opts, storageState: state, reducedMotion: 'reduce', locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    const page = await ctx.newPage();
    await page.goto(BASE + route, { waitUntil: 'load', timeout: 300000 });
    await page.waitForTimeout(4000);
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(() => {
      for (const a of document.querySelectorAll('header a')) {
        const label = (a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent || '').trim();
        if (label === 'MAX') a.style.display = 'none';
      }
    });
    const scroll = variant === 'desktop' ? desktopScroll : mobileScroll;
    if (/^\d+$/.test(scroll)) await page.evaluate((y) => window.scrollTo(0, y), Number(scroll));
    else await page.evaluate((target) => {
      // «text:Журналы» — первый элемент с таким текстом; иначе CSS-селектор.
      const el = target.startsWith('text:')
        ? [...document.querySelectorAll('main *')].find((node) => node.childElementCount === 0 && node.textContent.trim() === target.slice(5))
        : document.querySelector(target);
      const header = document.querySelector('header');
      const offset = header && getComputedStyle(header).position !== 'static' ? header.getBoundingClientRect().height : 0;
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset - 20);
    }, scroll);
    await page.waitForTimeout(1200);
    const file = path.join(OUT, `${id}-${variant}.png`);
    await page.screenshot({ path: file });
    console.log(file, page.url().replace(BASE, ''));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
