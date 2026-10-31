const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const OUT = process.env.OUT;
const MOCK = process.env.MOCK;
const report = {};
const step = (name, value) => { report[name] = value; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => (report.pageErrors = [...(report.pageErrors || []), String(e)]));
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.fill('#email', 'admin@haccp.local'); await page.fill('#password', 'admin1234');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), page.click('button[type=submit]')]);

  // 1. Настройки: Диадок с двумя ящиками → выбор ящика → подключено.
  await page.goto(BASE + '/settings/integrations/edo', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/settings-empty.png`, fullPage: true });
  const diadoc = page.locator('[data-supply-connection="diadoc"]');
  const inputs = diadoc.locator('input');
  await inputs.nth(0).fill('local-dev-key-123');
  await inputs.nth(1).fill('chef@school.ru');
  await inputs.nth(2).fill('wrong');
  await diadoc.locator('button[type=submit]').click();
  await page.waitForTimeout(2500);
  step('diadocWrongPassword', await page.locator('[data-sonner-toast]').last().textContent().catch(() => null));
  await inputs.nth(2).fill('secret');
  await diadoc.locator('button[type=submit]').click();
  await diadoc.locator('select').waitFor({ timeout: 30000 });
  step('diadocBoxes', await diadoc.locator('select option').allTextContents());
  await diadoc.locator('select').selectOption('box-school@diadoc.ru');
  await diadoc.locator('button[type=submit]').click();
  await page.waitForTimeout(3000);
  // 2. СБИС — через API с адресом локальной заглушки (в форме адреса нет: в проде только online.saby.ru / sbis.ru).
  step('sabyWrongKey', await page.evaluate(async () => {
    const res = await fetch('/api/settings/supply/saby', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: 'http://127.0.0.1:4555', clientId: 'app-1', appSecret: 'nope' }) });
    return { status: res.status, body: await res.json() };
  }));
  step('sabyConnect', await page.evaluate(async () => {
    const res = await fetch('/api/settings/supply/saby', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: 'http://127.0.0.1:4555', clientId: 'app-1', appSecret: 'secret-1' }) });
    return { status: res.status, body: await res.json() };
  }));
  await page.goto(BASE + '/settings/integrations/edo', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/settings-connected.png`, fullPage: true });
  step('settingsText', (await page.locator('[data-supply-connection]').allTextContents()).map((t) => t.replace(/\s+/g, ' ').slice(0, 220)));

  // 3. Входящие: при открытии — сами проверяются оба подключения.
  await page.goto(BASE + '/edo', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(6000);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  step('inboxAfterAutoSync', await page.locator('[data-edo-documents] li').allTextContents().then((a) => a.map((t) => t.replace(/\s+/g, ' ').slice(0, 200))));
  // Повторная проверка кнопкой — дублей нет.
  const sync = await page.evaluate(async () => (await fetch('/api/edo/sync', { method: 'POST' })).json());
  step('manualResync', sync);

  // 4. Загрузка файла: тот же УПД, что пришёл из Диадока, — дубль; новый — новая накладная.
  const upload = async (file) => page.evaluate(async ({ name, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData(); form.set('file', new File([bytes], name, { type: 'text/xml' }));
    const res = await fetch('/api/edo/upload', { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  }, { name: file, b64: require('fs').readFileSync(`${MOCK}/${file}`).toString('base64') });
  step('uploadSameAsDiadoc', await upload('upd-501-cp1251.xml'));
  step('uploadNotUpd', await page.evaluate(async () => {
    const form = new FormData(); form.set('file', new File(['<html>login</html>'], 'page.xml', { type: 'text/xml' }));
    const res = await fetch('/api/edo/upload', { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  }));
  // Новый файл — через кнопку на странице (input type=file).
  await page.goto(BASE + '/edo', { waitUntil: 'networkidle', timeout: 180000 });
  await page.setInputFiles('[data-edo-actions] input[type=file]', `${MOCK}/upd-upload-cp1251.xml`);
  await page.waitForURL(/\/edo\/[^/]+$/, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const docUrl = page.url();
  step('uploadedDocUrl', docUrl.replace(BASE, ''));
  await page.screenshot({ path: `${OUT}/document-new.png`, fullPage: true });

  // 5. Приёмка: строка 1 — принять (+4, годен до), строка 2 — отклонить без пояснения (отказ), потом с пояснением.
  const lines = page.locator('[data-edo-line]');
  await lines.nth(0).locator('input').nth(0).fill('+4');
  await lines.nth(1).locator('button[role=radio]').nth(1).click();
  await page.click('[data-edo-submit]');
  await page.waitForTimeout(1500);
  step('rejectWithoutAction', await page.locator('[data-sonner-toast]').last().textContent().catch(() => null));
  await lines.nth(1).locator('textarea').fill('Возврат поставщику: нарушена упаковка');
  await lines.nth(1).locator('button[role=checkbox]').nth(0).click();
  await page.click('[data-edo-submit]');
  await page.waitForSelector('text=Открыть журнал приёмки', { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/document-accepted.png`, fullPage: true });
  step('acceptedText', (await page.locator('[data-edo-document]').textContent()).replace(/\s+/g, ' ').slice(0, 300));
  const docId = docUrl.split('/').pop();
  step('secondAccept', await page.evaluate(async (id) => {
    const res = await fetch(`/api/edo/documents/${id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery: { transportOk: true, documentsOk: true }, items: [{ line: 1, decision: 'accept', packagingOk: true, organolepticOk: true }, { line: 2, decision: 'accept', packagingOk: true, organolepticOk: true }] }) });
    return { status: res.status, body: await res.json() };
  }, docId));

  // 6. Входящие на ПК и телефоне.
  await page.goto(BASE + '/edo', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/inbox-desktop.png`, fullPage: true });
  await page.goto(BASE + '/edo?tab=done', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(800);
  step('doneTab', await page.locator('[data-edo-documents] li').allTextContents().then((a) => a.map((t) => t.replace(/\s+/g, ' ').slice(0, 160))));
  await ctx.close();

  const mob = await browser.newContext({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const mp = await mob.newPage();
  await mp.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 180000 });
  await mp.waitForTimeout(1000);
  await mp.fill('#email', 'admin@haccp.local'); await mp.fill('#password', 'admin1234');
  await Promise.all([mp.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' }), mp.click('button[type=submit]')]);
  await mp.goto(BASE + '/edo', { waitUntil: 'networkidle', timeout: 180000 });
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: `${OUT}/inbox-mobile.png`, fullPage: true });
  const firstNew = await mp.locator('[data-edo-documents] a').first().getAttribute('href');
  await mp.goto(BASE + firstNew, { waitUntil: 'networkidle', timeout: 180000 });
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: `${OUT}/document-mobile.png`, fullPage: true });
  step('mobileOverflow', await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  await mob.close();
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); console.log(JSON.stringify(report, null, 1)); process.exit(1); });
