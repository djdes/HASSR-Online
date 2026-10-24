const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT = '/home/user/HASSR-Online/.agent/tasks/bug-report-launcher-2026-10-24/raw';
const BASE = 'http://localhost:3000';
async function run(name, ctxOpts) {
  const b = await chromium.launch();
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  await p.goto(BASE + '/login', { timeout: 180000 });
  await p.fill('input[type=email], input[name=email]', 'bug@test.local');
  await p.fill('input[type=password]', 'Test12345!');
  await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000 });
  await p.goto(BASE + '/journals', { timeout: 180000 });
  await p.waitForTimeout(4000);
  // close any blocking modal (legal, whats-new)
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
  await p.mouse.wheel(0, 600); await p.waitForTimeout(800);
  const tab = p.getByRole('button', { name: /Сообщить о проблеме/ }).last();
  await tab.waitFor({ timeout: 60000 });
  console.log(name, 'tab box', await tab.boundingBox());
  await p.screenshot({ path: `${OUT}/${name}-1-page-with-tab.png` });
  const t0 = Date.now();
  await tab.click();
  const img = p.locator('img[alt="Скриншот страницы"]');
  await img.waitFor({ timeout: 60000 });
  console.log(name, 'capture+open ms', Date.now() - t0);
  // save the captured screenshot itself
  const dataUrl = await img.evaluate(async (el) => { const r = await fetch(el.src); const bl = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(bl); }); });
  fs.writeFileSync(`${OUT}/${name}-captured.jpg`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await p.fill('#bug-report-message', 'Тестовый репорт: кнопка не работает <b>xss</b>');
  fs.writeFileSync('/tmp/claude-0/pw/extra.txt', 'extra file');
  await p.setInputFiles('input[type=file]', '/tmp/claude-0/pw/extra.txt');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/${name}-2-form.png` });
  const respP = p.waitForResponse((r) => r.url().endsWith('/api/feedback') && r.request().method() === 'POST');
  await p.getByRole('button', { name: 'Отправить' }).click();
  const resp = await respP;
  console.log(name, 'POST', resp.status(), JSON.stringify(await resp.json()), JSON.stringify(JSON.parse(resp.request().postData()).pageUrl));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/${name}-3-after-submit.png` });
  console.log(name, 'console errors', logs.filter(l => !/timeZone|hydrat/i.test(l)).slice(0, 5));
  await b.close();
}
(async () => {
  await run('desktop', { viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await run('mobile', { ...devices['iPhone 13'], locale: 'ru-RU' });
})().catch((e) => { console.error(e); process.exit(1); });
