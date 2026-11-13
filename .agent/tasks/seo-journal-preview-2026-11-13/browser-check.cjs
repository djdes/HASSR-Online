// Real SEO landing, configuration, preview, assets and Tailwind CSS.
// Only unrelated public chrome, next/link and the email-download boundary are fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { chromium } = require('playwright');

const root = process.cwd();
const run = process.argv[2] || 'builder';
const output = path.join(__dirname, 'raw', run);
fs.mkdirSync(output, { recursive: true });
const inputs = ['src/components/landing/seo-journal-landing.tsx',
  'src/components/public/journal-screenshot.tsx', 'src/content/seo-landings.ts',
  'src/components/public/blank-download.tsx', 'src/components/public/blank-download-client.tsx',
  'src/app/globals.css', 'package-lock.json'];
const supported = new Set(['hygiene', 'health_check', 'climate_control',
  'cold_equipment_control', 'cleaning_ventilation_checklist', 'cleaning',
  'general_cleaning', 'uv_lamp_runtime', 'finished_product', 'perishable_rejection',
  'incoming_control', 'fryer_oil', 'med_books']);
const baselineRef='5a251168e8a6c30b2c39126d4fc4f816e2ea9f53';
const sha = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

async function bundle(baseline) {
  return (await build({
    stdin: { contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {SeoJournalLanding, SEO_LANDINGS} from '@/components/landing/seo-journal-landing';
      import {JournalScreenshot} from '@/components/public/journal-screenshot';
      const slug = location.pathname.slice(1);
      window.__configs = SEO_LANDINGS;
      const custom = location.search.includes('custom=1');
      const config = custom ? {...SEO_LANDINGS['zhurnal-uborki'], downloadHref:'/fixture-custom.pdf'} : SEO_LANDINGS[slug];
      createRoot(document.getElementById('root')).render(slug === 'journals-info/cleaning'
        ? <main className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6"><JournalScreenshot code="cleaning" label="Журнал уборки"/></main>
        : <SeoJournalLanding config={config}/>);`, loader: 'tsx', resolveDir: root },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"production"}' }, tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [{ name: 'bounded-framework-boundaries', setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
      b.onResolve({ filter: /^@\/components\/public\/public-chrome$/ }, () => ({ path: 'chrome', namespace: 'fixture' }));
      b.onResolve({ filter: /^@\/components\/public\/blank-download$/ }, () => ({ path: 'download', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path: name}) => ({loader: 'tsx', resolveDir:root, contents:
        name === 'link' ? `export default function Link({children,...props}){return <a {...props}>{children}</a>}` :
        name === 'chrome' ? `export const PublicHeader=()=> <header style={{height:80}}/>; export const PublicFooter=()=> <footer style={{height:120}}/>;` :
        `export function BlankDownloadButton({target,format,title,place,children,...props}){return <button data-download-target={JSON.stringify(target)} data-format={format} data-place={place} title={title} {...props}>{children}</button>}` }));
      if (baseline) b.onLoad({ filter: /[\\/](seo-journal-landing|journal-screenshot)\.tsx$/ }, ({path: file}) => ({
        contents: execFileSync('git', ['show', `${baselineRef}:${path.relative(root,file).replaceAll('\\','/')}`], {cwd:root,encoding:'utf8'}),
        loader: 'tsx', resolveDir: path.dirname(file),
      }));
    }}],
  })).outputFiles[0].text;
}

async function main() {
  const results = {run, fixture:'Actual landing/preview/config/assets/CSS; public chrome, next/link and download-dialog boundary stubbed; no server, database or authentication',
    head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    hashes:Object.fromEntries(inputs.map(file=>[file,sha(file)])), baseline:[], responsive:[], landings:[], card:[], errors:[]};
  const cssSource = fs.readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);') +
    inputs.filter(file=>/\.tsx$/.test(file)).map(file=>`\n@source "${path.join(root,file).replaceAll('\\','/')}";`).join('') +
    `\n@source "${path.join(root,'src/components/public/public-breadcrumbs.tsx').replaceAll('\\','/')}";`;
  const css = (await postcss([tailwind({base:root})]).process(cssSource,{from:path.join(root,'src/app/globals.css')})).css;
  const scripts = {baseline:await bundle(true),fixed:await bundle(false)};
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
    ignoreDefaultArgs:['--hide-scrollbars'],args:['--disable-features=OverlayScrollbar']});
  async function open(mode,width,slug) {
    const context = await browser.newContext({viewport:{width,height:950},hasTouch:width<600});
    const page = await context.newPage();
    page.on('pageerror',error=>{results.errors.push(error.message);console.error('Browser:',error.message);});
    await page.route('http://journal.test/**',async route=>{
      const pathname = new URL(route.request().url()).pathname;
      if(pathname==='/app.js')return route.fulfill({contentType:'application/javascript',body:scripts[mode]});
      if(pathname==='/app.css')return route.fulfill({contentType:'text/css',body:css});
      if(pathname.startsWith('/journal-samples/')) {
        const file = path.join(root,'public',pathname);
        assert.ok(fs.existsSync(file),`Missing public sample ${pathname}`);
        return route.fulfill({contentType:pathname.endsWith('.webp')?'image/webp':'image/png',body:fs.readFileSync(file)});
      }
      return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`});
    });
    await page.goto(`http://journal.test/${slug}`);
    await page.locator(slug.startsWith('journals-info')?'table':'h1').waitFor();
    return {page,context};
  }
  async function scrollMatrix(page) {
    const region = page.locator('[data-testid="journal-ui-preview-cleaning"] table').locator('..');
    await region.scrollIntoViewIfNeeded();
    const box = await region.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    const before = await region.evaluate(el=>el.scrollLeft);
    await page.mouse.wheel(240,0);
    await page.waitForTimeout(180);
    const after = await region.evaluate(el=>el.scrollLeft);
    return {region,before,after};
  }
  try {
    // Prove the original omission and the input-blocking decorative wrapper.
    let opened = await open('baseline',1440,'zhurnal-uborki');
    assert.equal(await opened.page.locator('#journal-preview-heading').count(),0);
    results.baseline.push({scenario:'original cleaning landing',previewCount:0});
    await opened.context.close();
    opened = await open('baseline',375,'journals-info/cleaning');
    const old = await scrollMatrix(opened.page);
    assert.equal(old.after,old.before);
    results.baseline.push({scenario:'original cleaning card matrix wheel',before:old.before,after:old.after});
    await opened.context.close();

    for(const width of [320,375,768,1440]) {
      const {page,context} = await open('fixed',width,'zhurnal-uborki');
      const section = page.locator('section[aria-labelledby="journal-preview-heading"]');
      await section.waitFor({state:'visible'});
      assert.match(await section.innerText(),/демонстрационные данные/);
      const layout = await page.evaluate(()=>{
        const preview = document.querySelector('section[aria-labelledby="journal-preview-heading"]');
        const sections = [...document.querySelectorAll('section')];
        const table = preview.querySelector('table');
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,
          order:sections.indexOf(preview),beforeTitle:sections[0].querySelector('h1').textContent,
          afterTitle:preview.nextElementSibling.querySelector('h2').textContent,
          rows:table.tBodies[0].rows.length,columns:table.tHead.rows[0].cells.length,
          scrollerWidth:table.parentElement.clientWidth,tableWidth:table.scrollWidth};
      });
      assert.equal(layout.order,1);
      assert.match(layout.afterTitle,/Обязательные поля/);
      assert.equal(layout.rows,6); // Four rooms plus responsible-person and controller rows.
      assert.equal(layout.columns,16);
      assert.ok(layout.documentWidth<=layout.clientWidth,JSON.stringify(layout));
      for(const room of ['Горячий цех','Холодный цех','Моечная','Склад сухих продуктов'])assert.ok((await section.innerText()).includes(room));
      assert.match(await section.innerText(),/Т — текущая уборка/);
      assert.match(await section.innerText(),/Г — генеральная уборка/);
      const download = page.locator('[data-download-target]');
      assert.deepEqual(JSON.parse(await download.getAttribute('data-download-target')),{kind:'code',code:'cleaning'});
      assert.equal(await download.getAttribute('data-format'),'pdf');
      assert.equal(await download.getAttribute('data-place'),'seo:zhurnal-uborki');
      assert.equal(await page.getByRole('link',{name:'Вести этот журнал бесплатно'}).getAttribute('href'),'/register');
      if(width<768) {
        const {region,before,after} = await scrollMatrix(page);
        assert.ok(after>before,'Horizontal wheel must scroll the matrix');
        await region.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(160);
        const keyboard = await region.evaluate(el=>el.scrollLeft);
        assert.ok(keyboard>after,'Keyboard must scroll the matrix');
        const yBefore=await page.evaluate(()=>scrollY);
        await page.mouse.wheel(0,160);
        await page.waitForTimeout(180);
        const yAfter=await page.evaluate(()=>scrollY);
        assert.ok(yAfter>yBefore,'Page must still scroll vertically');
        layout.input={wheelBefore:before,wheelAfter:after,keyboardAfter:keyboard,yBefore,yAfter};
      }
      await section.locator('table').locator('..').evaluate(el=>el.scrollLeft=0);
      await page.evaluate(()=>document.activeElement.blur());
      await section.screenshot({path:path.join(output,`cleaning-${width}.png`)});
      results.responsive.push(layout);
      await context.close();
    }

    // Every configuration on both desktop and mobile, including public asset decoding.
    for(const width of [375,1440]) {
      const {page,context}=await open('fixed',width,'zhurnal-uborki');
      const configs=await page.evaluate(()=>Object.values(window.__configs).map(({slug,relatedCode})=>({slug,relatedCode})));
      for(const {slug,relatedCode} of configs) {
        await page.goto(`http://journal.test/${slug}`);
        await page.locator('h1').waitFor();
        const section=page.locator('section[aria-labelledby="journal-preview-heading"]');
        const expected=supported.has(relatedCode);
        assert.equal(await section.count(),expected?1:0,slug);
        const entry={slug,width,relatedCode,preview:expected};
        if(expected && relatedCode!=='cleaning') {
          const img=section.locator('img');
          await img.scrollIntoViewIfNeeded();
          await img.evaluate(el=>el.decode());
          entry.image=await img.evaluate(el=>({src:el.currentSrc,width:el.naturalWidth,height:el.naturalHeight}));
          assert.ok(entry.image.width>0);
          assert.ok(new URL(entry.image.src).pathname.startsWith(`/journal-samples/${relatedCode}.`));
        }
        if(!expected)assert.equal(await page.locator('section').first().getByRole('link',{name:'Печатные формы PDF'}).getAttribute('href'),'/blanki');
        results.landings.push(entry);
      }
      // A custom download URL keeps priority even when a preview is available.
      await page.goto('http://journal.test/zhurnal-uborki?custom=1');
      await page.locator('h1').waitFor();
      assert.equal(await page.getByRole('link',{name:'Скачать заполненный образец'}).getAttribute('href'),'/fixture-custom.pdf');
      assert.equal(await page.locator('[data-download-target]').count(),0);
      assert.equal(await page.locator('#journal-preview-heading').count(),1);
      await context.close();
    }
    const {page,context}=await open('fixed',375,'journals-info/cleaning');
    const card=await scrollMatrix(page);
    assert.ok(card.after>card.before);
    results.card.push({width:375,before:card.before,after:card.after});
    await context.close();
    assert.deepEqual(results.errors,[]);
    results.verdict='PASS';
    fs.writeFileSync(path.join(output,'browser.json'),JSON.stringify(results,null,2)+'\n');
    console.log(`PASS: original omission reproduced; ${results.responsive.length} responsive widths; ${results.landings.length} landing cases; existing card scroll; custom downloads; no browser errors.`);
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
