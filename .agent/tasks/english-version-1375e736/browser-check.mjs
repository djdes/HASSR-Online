import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { encode } from 'next-auth/jwt';
const base=process.env.ENGLISH_FIXTURE_URL;
const raw=new URL('./raw/',import.meta.url);
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={framework:'Actual Next.js 16 production build, isolated checkout and dummy database; API responses mocked in browser',cases:[],errors:[]};
let peer=150;
const captchaScript=`(()=>{const widgets=[];window.grecaptcha={render(el,opts){const b=document.createElement('button');b.type='button';b.dataset.testCaptcha='1';b.textContent='Complete test verification';b.onclick=()=>opts.callback('fixture-token');el.appendChild(b);widgets.push(b);return widgets.length-1},reset(){}};window.wesetupRecaptchaReady()})();`;
async function context(extra={}){
  const ctx=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',extraHTTPHeaders:{'x-real-ip':`198.51.100.${++peer}`},...extra});
  await ctx.route('https://mc.yandex.ru/**',r=>r.abort());
  await ctx.route('**/api/auth/registration-challenge',r=>r.fulfill({json:{siteKey:'fixture-site-key'}}));
  await ctx.route('https://www.recaptcha.net/recaptcha/api.js?**',r=>r.fulfill({contentType:'application/javascript',body:captchaScript}));
  await ctx.route('**/api/public/email-domain-check?**',r=>r.fulfill({json:{ok:true}}));
  await ctx.route('**/api/public/support-chat**',r=>r.fulfill({json:{messages:[],unread:0}}));
  const page=await ctx.newPage();
  await page.exposeFunction('captureError',e=>report.errors.push(e));
  await page.addInitScript(()=>window.addEventListener('error',e=>window.captureError({url:location.href,filename:e.filename,line:e.lineno,column:e.colno,message:e.message})));
  return {ctx,page};
}
async function noRussian(page){
  const text=await page.locator('body').innerText();
  const russian=text.split('\n').filter(s=>/[А-Яа-яЁё]/.test(s));
  assert.deepEqual(russian,[]);
}
async function check(name,fn){try{await fn();report.cases.push({name,pass:true})}catch(e){report.cases.push({name,pass:false,error:e.stack});process.exitCode=1}}
try{
  await check('English SSR, canonical, hreflang and language switch without JavaScript',async()=>{
    const {ctx,page}=await context({javaScriptEnabled:false});
    const response=await page.goto(base+'/en?proof=seo',{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200);
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.title(),'Digital SanPiN and HACCP logs online — WeSetup');
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://wesetup.ru/en');
    assert.equal(new URL(await page.locator('link[hreflang=ru]').getAttribute('href')).href,'https://wesetup.ru/');
    await noRussian(page);
    await page.getByRole('link',{name:'Switch to Russian'}).click();
    assert.equal(await page.locator('html').getAttribute('lang'),'ru');
    assert.equal(new URL(page.url()).search,'?proof=seo');
    await ctx.close();
  });
  await check('Mobile language switching preserves query and hash, with no overflow',async()=>{
    const {ctx,page}=await context({viewport:{width:320,height:780}});
    await page.goto(base+'/en?utm_source=proof#pricing');
    await page.getByRole('link',{name:'Switch to Russian'}).click();
    await page.waitForURL('**/?utm_source=proof#pricing');
    await page.getByRole('link',{name:'Switch to English'}).click();
    await page.waitForURL('**/en?utm_source=proof#pricing');
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.ok((await ctx.cookies()).some(c=>c.name==='wesetup.site-locale'&&c.value==='en'));
    await page.evaluate(()=>scrollTo(0,0));
    for(const width of [320,400,640,768,1024]){
      await page.setViewportSize({width,height:780});
      for(const y of [0,1800]){
        await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(250);
        for(const control of await page.locator('.landing-nav a:visible, .landing-nav button:visible').all()){
          const box=await control.boundingBox();
          assert.ok(box&&box.x>=0&&box.x+box.width<=width+1,`${width}px: ${await control.innerText()}`);
        }
      }
    }
    await page.setViewportSize({width:320,height:780});await page.evaluate(()=>scrollTo(0,0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:new URL('english-mobile.png',raw).pathname.replace(/^\/(\w:)/,'$1')});
    await ctx.close();
  });
  await check('Leaving translated routes reloads the Russian root locale',async()=>{
    const {ctx,page}=await context();await page.goto(base+'/en');
    await page.evaluate(()=>window.localeNavigationMarker='english-document');
    await page.locator('.landing-nav').getByRole('link',{name:'Blog',exact:true}).click();
    await page.waitForURL('**/blog');
    assert.equal(await page.locator('html').getAttribute('lang'),'ru');
    assert.equal(await page.evaluate(()=>window.localeNavigationMarker),undefined);
    await ctx.close();
  });
  await check('All six QR chapters and equipment controls use English',async()=>{
    const {ctx,page}=await context();await page.goto(base+'/en');
    const chapters=page.getByRole('navigation',{name:'Video chapters'}).getByRole('button');
    assert.equal(await chapters.count(),6);
    for(let i=0;i<6;i++){await chapters.nth(i).click();await page.waitForTimeout(150);await noRussian(page)}
    await page.getByRole('button',{name:'Choose equipment',exact:true}).click();
    await page.getByRole('button',{name:'Choose individual items',exact:true}).click();
    await page.getByRole('button',{name:'Add one item',exact:true}).first().click();
    await noRussian(page);
    await ctx.close();
  });
  await check('Signup still requires CAPTCHA and consent, translates rate limits and preserves payload',async()=>{
    const {ctx,page}=await context();let submitted=[];let scriptLanguage='';
    page.on('request',r=>{if(r.url().includes('recaptcha/api.js'))scriptLanguage=new URL(r.url()).searchParams.get('hl')});
    await ctx.route('**/api/auth/instant-register',r=>{submitted.push(r.request().postDataJSON());return r.fulfill({status:429,json:{error:'Слишком часто. Попробуйте через несколько минут'}})});
    await page.goto(base+'/en/register?email=proof%40example.com');
    await page.locator('[data-test-captcha]').waitFor();
    const submit=page.getByRole('button',{name:'Create account',exact:true});
    assert.equal(await submit.isDisabled(),true);
    await page.locator('[data-test-captcha]').click();await submit.click();
    await page.getByText('Please accept the documents to create an account',{exact:true}).waitFor();
    assert.equal(submitted.length,0);
    await page.getByTestId('legal-consent').check();await submit.click();
    await page.getByText('Too many attempts. Please try again in a few minutes',{exact:true}).waitFor();
    assert.equal(submitted.length,1);assert.equal(submitted[0].email,'proof@example.com');assert.equal(submitted[0].consent,true);assert.equal(submitted[0].captchaToken,'fixture-token');assert.equal(scriptLanguage,'en');
    assert.equal(await submit.isDisabled(),true);await noRussian(page);await ctx.close();
  });
  await check('Password sign-in, Telegram second factor, reset and email links retain behavior',async()=>{
    const {ctx,page}=await context();let count=0;
    await ctx.route('**/api/auth/login',r=>r.fulfill(++count===1?{status:429,json:{error:'Слишком много попыток входа. Подождите 5 минут.'}}:{json:{requiresCode:true,challengeId:'fixture-challenge'}}));
    await ctx.route('**/api/auth/login/code',r=>r.fulfill({status:401,json:{error:'Неверный код'}}));
    await ctx.route('**/api/auth/magic-link',r=>r.fulfill({json:{ok:true}}));
    await ctx.route('**/api/auth/forgot',r=>r.fulfill({json:{ok:true}}));
    await page.goto(base+'/en/login?email=proof%40example.com&exists=1');
    assert.equal(await page.locator('#email').inputValue(),'proof@example.com');
    await page.locator('#password').fill('fixture-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByText('Too many sign-in attempts. Please wait 5 minutes.',{exact:true}).waitFor();
    await page.getByTestId('magic-link-button').click();await page.getByTestId('magic-sent').waitFor();
    await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
    await page.getByText(/If an account with this email address exists, a password reset link/).waitFor();
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('textbox',{name:'Telegram code'}).fill('123456');
    await page.getByRole('button',{name:'Confirm',exact:true}).click();
    await page.getByText('Incorrect code',{exact:true}).waitFor();await noRussian(page);await ctx.close();
  });
  await check('Support contact validation is in English',async()=>{
    const {ctx,page}=await context();await page.goto(base+'/en');
    await page.getByRole('button',{name:'Contact us',exact:true}).click();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByText('Please leave a phone number or email address so we can reply',{exact:true}).waitFor();
    await noRussian(page);await ctx.close();
  });
  await check('Signed-in landing preserves names and both English auth routes redirect',async()=>{
    const {ctx,page}=await context();
    const token=await encode({secret:'isolated-english-proof-secret-not-for-production',token:{id:'english-fixture-user',sub:'english-fixture-user',name:'Иван Тестовый',role:'owner',organizationId:'english-fixture-org',sv:0}});
    await ctx.addCookies([{name:'haccp-online.session-token',value:token,url:base}]);
    await page.goto(base+'/en');
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.getByRole('link',{name:'Profile · Иван Тестовый',exact:true}).getAttribute('title'),'Иван Тестовый');
    for(const path of ['/en/login','/en/register']){
      const r=await ctx.request.get(base+path,{maxRedirects:0});
      assert.equal(r.status(),307,path);assert.equal(new URL(r.headers().location,base).pathname,'/dashboard');
    }
    await page.setViewportSize({width:320,height:780});
    for(const control of await page.locator('.landing-nav a:visible').all()){
      const b=await control.boundingBox();assert.ok(b&&b.x>=0&&b.x+b.width<=321);
    }
    await ctx.close();
  });
  await check('Real sitemap and preview image; protected paths have no English aliases',async()=>{
    const {ctx}=await context();
    const response=await ctx.request.get(base+'/sitemap.xml');assert.equal(response.status(),200);
    const xml=await response.text();assert.match(xml,/<loc>https:\/\/wesetup.ru\/en<\/loc>/);assert.match(xml,/hreflang="en"/);
    const image=await ctx.request.get(base+'/og/english');assert.equal(image.status(),200);assert.match(image.headers()['content-type'],/image\/png/);await fs.writeFile(new URL('english-og.png',raw),await image.body());
    for(const path of ['/en/root','/en/dashboard','/en/api/auth/session'])assert.equal((await ctx.request.get(base+path)).status(),404,path);
    await ctx.close();
  });
}finally{
  await browser.close();
  await fs.writeFile(new URL('browser-report.json',raw),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.errors.length)process.exitCode=1;
}
