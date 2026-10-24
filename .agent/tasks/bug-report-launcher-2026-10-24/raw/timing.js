const { chromium, devices } = require('playwright');
(async () => {
  for (const [name, opts] of [['mobile', { ...devices['iPhone 13'] }], ['desktop', { viewport: { width: 1440, height: 900 } }]]) {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...opts, locale: 'ru-RU' }); const p = await ctx.newPage();
  let reqs = 0; p.on('request', () => reqs++);
  await p.goto('http://localhost:3000/login'); await p.fill('input[type=email], input[name=email]', 'bug@test.local'); await p.fill('input[type=password]', 'Test12345!'); await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000 });
  await p.goto('http://localhost:3000/journals'); await p.waitForTimeout(5000);
  for (let i = 0; i < 2; i++) {
    reqs = 0; const t0 = Date.now();
    await p.getByRole('button', { name: /Сообщить о проблеме/ }).last().click();
    await p.locator('img[alt="Скриншот страницы"]').waitFor({ timeout: 90000 });
    console.log(name, 'run', i, Date.now() - t0, 'ms, requests', reqs);
    await p.keyboard.press('Escape'); await p.waitForTimeout(800);
  }
  await b.close(); }
})();
