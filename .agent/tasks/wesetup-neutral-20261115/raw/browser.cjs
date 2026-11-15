const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('package.json'));
const esbuild = req('esbuild');
const { chromium } = req('playwright');
const postcss = req('postcss');
const tailwind = req('@tailwindcss/postcss');
const raw = __dirname;

(async()=>{
  req('tsx/cjs');
  const qr = await req(path.resolve('src/components/landing/qr-player/qr-matrix.ts')).buildQrMatrix('https://wesetup.ru');
  fs.writeFileSync(path.join(raw,'qr.json'),JSON.stringify(qr));
  const bundle=await esbuild.build({entryPoints:[path.join(raw,'browser-fixture.tsx')],absWorkingDir:process.cwd(),tsconfig:path.resolve('tsconfig.json'),
    bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.json':'json'},
    alias:{'next/link':path.join(raw,'next-link.tsx'),'next/navigation':path.join(raw,'next-navigation.ts'),
      ...Object.fromEntries(['react','react-dom','next-intl','sonner'].map(n=>[n,path.resolve('node_modules',n)]))},
    nodePaths:[path.resolve('node_modules')],define:{'process.env.NODE_ENV':'"production"','process.env':'{}','process.platform':'"browser"'}});
  const cssSource=fs.readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";',`@import "${path.resolve('node_modules/tailwindcss/index.css').replaceAll('\\','/')}" source(none);`)
    +`\n@source "${path.resolve('src').replaceAll('\\','/')}";\n@source "${raw.replaceAll('\\','/')}";`;
  const css=await postcss([tailwind({base:process.cwd()})]).process(cssSource,{from:path.resolve('src/app/globals.css')});
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}body{margin:0;background:#fafbff;font-family:Arial,sans-serif}</style><div id="app"></div><script>${bundle.outputFiles[0].text}</script></html>`;
  const server=http.createServer((request,response)=>{
    const name=new URL(request.url,'http://localhost').pathname;
    if(name.startsWith('/brand/') || name.startsWith('/landing/places/')){
      const file=path.resolve('public','.'+name);
      if(fs.existsSync(file)){response.setHeader('content-type',name.endsWith('.webp')?'image/webp':'image/png');return response.end(fs.readFileSync(file));}
    }
    response.setHeader('content-type','text/html;charset=utf-8');response.end(html);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE:',e.message)});
  page.on('console',message=>{if(message.type()==='error') console.error('CONSOLE:',message.text())});
  const checks=[];
  await page.route('**/api/**',route=>route.fulfill({json:{items:[],requests:[]}}));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const locale of ['ru','en','uz']){
      for(const [size,width,height] of [['desktop',1440,900],['mobile',390,800]]){
        await page.setViewportSize({width,height});
        await page.goto(`${base}?locale=${locale}&mode=staff`);
        await page.getByRole('heading',{name:{ru:'Сотрудники',en:'Employees',uz:'Xodimlar'}[locale],exact:true}).waitFor();
        await page.evaluate(()=>document.fonts.ready);
        const text=await page.locator('main').innerText();
        if(/повар|chef|cook|oshpaz/i.test(text)) throw new Error(`Food role in shared staff example: ${locale}`);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        if(overflow) throw new Error(`Staff overflow ${locale}/${size}`);
        const shot=await page.screenshot({path:path.join(raw,`staff-${locale}-${size}.png`)});
        if(locale==='ru' && process.env.CAPTURE_ASSETS==='1'){
          await req('sharp')(shot).webp({quality:88}).toFile(path.resolve(`public/landing/screens/staff-neutral-${size}.webp`));
        }
        checks.push(`staff ${locale}/${size}: neutral roles, no overflow`);
        await page.goto(`${base}?locale=${locale}&mode=schedule`);
        await page.getByRole('heading',{name:{ru:'График смен',en:'Shift schedule',uz:'Smenalar jadvali'}[locale],exact:true}).waitFor();
        const scheduleText=await page.locator('main').innerText();
        if(/повар|chef|cook|oshpaz/i.test(scheduleText)) throw new Error(`Food role in schedule ${locale}`);
        await page.screenshot({path:path.join(raw,`schedule-${locale}-${size}.png`),fullPage:true});
        checks.push(`schedule ${locale}/${size}: neutral intro and actual editor`);
        await page.goto(`${base}?locale=${locale}&mode=login`);
        await page.getByRole('button',{name:{ru:'Войти',en:'Sign in',uz:'Kirish'}[locale],exact:true}).waitFor();
        if(size==='desktop'){
          await page.getByRole('heading',{name:{ru:'Электронные журналы для вашей организации',en:'Electronic logs for your organisation',uz:'Tashkilotingiz uchun elektron jurnallar'}[locale],exact:true}).waitFor();
          await page.getByText({ru:'Медцентры',en:'Medical centres',uz:'Tibbiyot markazlari'}[locale],{exact:true}).waitFor();
        }
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error(`Login overflow ${locale}/${size}`);
        await page.screenshot({path:path.join(raw,`login-${locale}-${size}.png`),fullPage:true});
        checks.push(`login ${locale}/${size}: shared auth imagery and copy`);
      }
      await page.setViewportSize({width:1440,height:900});
      for(const time of ['1.5','4.8']){
        await page.goto(`${base}?locale=${locale}&mode=qr&time=${time}`);
        await page.getByText('WeSetup Demo',{exact:true}).first().waitFor();
        const text=await page.locator('#app').innerText();
        if(/повар|шеф|chef|cook|oshpaz/i.test(text))throw new Error(`Food role in shared QR demo ${locale}`);
        await page.screenshot({path:path.join(raw,`qr-${locale}-${time}.png`)});
        checks.push(`QR ${locale}/${time}: neutral staff`);
      }
    }
    if(errors.length)throw new Error(errors.join('\n'));
    fs.writeFileSync(path.join(raw,'browser-result.json'),JSON.stringify({status:'PASS',checks,errors,syntheticData:true,liveDataMutations:false},null,2));
    console.log(`PASS: ${checks.length} browser checks`);
  }catch(error){fs.writeFileSync(path.join(raw,'browser-failure.txt'),await page.locator('body').innerText());throw error;}
  finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
