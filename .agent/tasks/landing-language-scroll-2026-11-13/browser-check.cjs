// Bounded browser regression fixture: real LanguageSwitch, Radix, intl, and
// repository CSS/header classes. Only Next routing and landing body are fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { chromium } = require('playwright');

const root = process.cwd();
const task = __dirname;
const run = process.argv[2] || 'builder';
const output = path.join(task, 'raw', run);
fs.mkdirSync(output, { recursive: true });
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const switchFile = 'src/components/i18n/language-switch.tsx';
const source = read(switchFile);
const landing = read('src/app/page.tsx');
const navClass = landing.match(/className="(landing-nav[^"]+)"/)[1];
const innerClass = landing.match(/<nav className="([^"]+)"/)[1];
const messages = JSON.parse(read('src/i18n/messages/ru.json')).language;
const inputs = [switchFile, 'src/components/ui/dropdown-menu.tsx',
  'src/components/ui/menu-styles.ts', 'src/app/globals.css', 'src/app/page.tsx',
  'package.json', 'package-lock.json'];
const hashes = Object.fromEntries(inputs.map(file => [file,
  crypto.createHash('sha256').update(read(file)).digest('hex')]));

async function bundle(baseline) {
  const entry = `import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SiteLocaleProvider } from '@/components/i18n/site-locale-provider';
    import { LanguageSwitch } from '@/components/i18n/language-switch';
    createRoot(document.getElementById('root')).render(
      <SiteLocaleProvider locale="ru" messages={${JSON.stringify({ language: messages })}} timeZone="Europe/Moscow">
        <div className="landing-page min-h-screen bg-white text-[#0b1024]">
          <div className=${JSON.stringify(navClass)}><nav className=${JSON.stringify(innerClass)}>
            <a href="/" id="brand">WeSetup</a><LanguageSwitch />
          </nav></div>
          <main id="body-content" style={{height: 5000, padding: 24}}>
            <h1>Landing scroll regression fixture</h1>
            <button id="outside" style={{marginTop: 80}}>Outside action</button>
          </main>
        </div>
      </SiteLocaleProvider>);`;
  const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [{ name: 'fixture-boundaries', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'routing', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
        `export const usePathname = () => location.pathname;
         export const useSearchParams = () => new URLSearchParams(location.search);` }));
      if (baseline) builder.onLoad({ filter: /[\\/]i18n[\\/]language-switch\.tsx$/ }, () => ({
        contents: source.replace('<DropdownMenu modal={false}>', '<DropdownMenu>'), loader: 'tsx',
        resolveDir: path.join(root, 'src/components/i18n'),
      }));
    }}] });
  return result.outputFiles[0].text;
}

async function main() {
  const lock = JSON.parse(read('package-lock.json'));
  const versions = {};
  for (const name of ['react', 'react-dom', 'radix-ui', 'next-intl', 'lucide-react', 'playwright', 'tailwindcss']) {
    versions[name] = JSON.parse(read(`node_modules/${name}/package.json`)).version;
    assert.equal(versions[name], lock.packages[`node_modules/${name}`].version, `${name} must match current lockfile`);
  }
  const cssSource = read('src/app/globals.css').replace('@import "tailwindcss";',
    '@import "tailwindcss" source(none);') + inputs.filter(f => /\.(tsx|ts)$/.test(f))
    .map(file => `\n@source "${path.join(root, file).replaceAll('\\', '/')}";`).join('');
  const css = (await postcss([tailwind({ base: root })]).process(cssSource,
    { from: path.join(root, 'src/app/globals.css') })).css;
  const bundles = { baseline: await bundle(true), fixed: await bundle(false) };
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-features=OverlayScrollbar'] });
  const results = { run, hashes, versions, fixture: 'Real component/intl/Radix/CSS; bounded landing and Next routing fixture', scenarios: [] };
  try {
    for (const mode of ['baseline', 'fixed']) {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('http://landing.test/**', async route => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: bundles[mode] });
          if (pathname === '/app.css') return route.fulfill({ contentType: 'text/css', body: css });
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ru"><head>
            <meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css">
            </head><body class="overflow-x-clip"><div id="root"></div><script src="/app.js"></script></body></html>` });
        });
        await page.goto('http://landing.test/?campaign=test#pricing');
        const trigger = page.getByRole('button', { name: /Русский/ });
        await trigger.waitFor();
        // Wait for the actual header's entrance animation to finish.
        await page.locator('.landing-nav').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
        const metrics = () => page.evaluate(() => {
          const rect = element => { const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
          return { scrollY, clientWidth: document.documentElement.clientWidth,
            bodyWidth: document.body.getBoundingClientRect().width,
            bodyOverflowY: getComputedStyle(document.body).overflowY,
            locked: document.body.hasAttribute('data-scroll-locked'),
            header: rect(document.querySelector('.landing-nav')),
            body: rect(document.querySelector('#body-content')),
            trigger: rect(document.querySelector('[data-slot="dropdown-menu-trigger"]')),
            menu: document.querySelector('[role="menu"]') ? rect(document.querySelector('[role="menu"]')) : null };
        });
        const row = { mode, viewport, positions: [] };
        results.scenarios.push(row);
        for (const offset of [0, 900]) {
          await page.evaluate(y => scrollTo(0, y), offset);
          await page.waitForFunction(y => Math.abs(scrollY - y) < 1, offset);
          const before = await metrics();
          await trigger.click();
          await page.getByRole('menu').waitFor();
          await page.getByRole('menu').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
          const opened = await metrics();
          if (mode === 'fixed') {
            assert.equal(opened.scrollY, before.scrollY, 'open scroll offset');
            assert.equal(opened.clientWidth, before.clientWidth, 'viewport width');
            assert.equal(opened.body.x, before.body.x, 'horizontal content position');
            assert.equal(opened.bodyWidth, before.bodyWidth, 'body width');
            assert.equal(opened.locked, false, 'no body lock');
            assert.notEqual(opened.bodyOverflowY, 'hidden', 'scrollable body');
            assert.equal(opened.header.y, before.header.y, 'sticky header position');
            assert.ok(opened.header.y >= 0 && opened.header.bottom > 0, 'visible header');
            assert.ok(Math.abs(opened.menu.y - opened.trigger.bottom - 6) < 2, `menu anchored: ${JSON.stringify(opened)}`);
          }
          await page.mouse.move(viewport.width / 2, viewport.height / 2);
          await page.mouse.wheel(0, 320);
          if (mode === 'fixed') await page.waitForFunction(y => scrollY > y + 100, opened.scrollY);
          else await page.waitForTimeout(200);
          const wheeled = await metrics();
          if (mode === 'fixed') {
            assert.ok(wheeled.header.bottom > 0 && wheeled.header.y >= 0, 'header after wheel');
            assert.ok(Math.abs(wheeled.menu.y - wheeled.trigger.bottom - 6) < 2, 'menu follows header');
          }
          await page.keyboard.press('Escape');
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          const closed = await metrics();
          if (mode === 'fixed') {
            assert.equal(closed.scrollY, wheeled.scrollY, 'close scroll offset');
            assert.equal(closed.clientWidth, before.clientWidth, 'close viewport width');
            assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'focus returns');
          }
          row.positions.push({ offset, before, opened, wheeled, closed });
        }
        if (mode === 'fixed') {
          await trigger.focus();
          await page.keyboard.press('ArrowDown');
          await page.getByRole('menu').waitFor();
          const items = page.getByRole('menuitem');
          assert.equal(await items.count(), 2);
          await page.keyboard.press('ArrowDown');
          assert.equal(await items.nth(1).evaluate(el => el === document.activeElement), true);
          assert.equal(await items.nth(1).getAttribute('href'), '/en?campaign=test');
          await page.keyboard.press('Escape');
          await trigger.click();
          await page.mouse.click(30, viewport.height / 2);
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          await trigger.click();
          await page.getByRole('menuitem', { name: 'English' }).click();
          await page.waitForURL('http://landing.test/en?campaign=test#pricing');
          const cookies = await context.cookies();
          for (const name of ['wesetup.site-locale', 'wesetup.pending-locale']) {
            assert.equal(cookies.find(c => c.name === name)?.value, 'en', name);
          }
          row.keyboardAndDismissal = 'PASS';
          row.navigationAndCookies = 'PASS';
        }
        assert.deepEqual(errors, [], 'no browser errors');
        await context.close();
      }
    }
    // The negative control must expose the actual regression.
    for (const row of results.scenarios.filter(r => r.mode === 'baseline')) {
      assert.ok(row.positions.every(p => p.opened.bodyWidth !== p.before.bodyWidth), 'baseline layout width shift reproduced');
      assert.ok(row.positions.every(p => p.opened.locked), 'baseline scroll lock reproduced');
      assert.ok(row.positions.every(p => p.wheeled.scrollY === p.opened.scrollY), 'baseline wheel blocked');
      assert.ok(row.positions.find(p => p.offset === 900).opened.header.bottom < 0, 'baseline header disappears');
    }
    results.status = 'PASS';
    console.log(JSON.stringify({ status: results.status, scenarios: results.scenarios.length, hashes }, null, 2));
  } finally {
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2) + '\n');
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
