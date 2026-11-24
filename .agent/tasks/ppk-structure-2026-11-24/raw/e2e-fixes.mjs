import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = "http://localhost:3000";
const out = [];
const check = (name, ok, detail = "") => { out.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await chromium.launch();

async function login(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  // Форма входа ждёт загрузки страницы (master #332): поля, заполненные до гидратации, сбрасываются.
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
  await page.fill("#email", email);
  await page.fill("#password", "admin1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  return { context, page };
}

// Руководитель: группа ХАССП → шаблон 2.2 с составом
{
  const { context, page } = await login("admin@haccp.local");
  const staff = await (await context.request.get(`${BASE}/api/production-control/records?block=team`)).json();
  if ((staff.records ?? []).length === 0) {
    const users = process.env.TEAM_IDS.split(",");
    await context.request.post(`${BASE}/api/production-control/records`, { data: { block: "team", data: { userId: users[0], role: "leader", duties: "" } } });
    await context.request.post(`${BASE}/api/production-control/records`, { data: { block: "team", data: { userId: users[1], role: "member", duties: "" } } });
  }
  await page.goto(`${BASE}/production-control/item/2-2`, { waitUntil: "networkidle" });
  const text = await page.locator('[data-ppk-text="text-team-regulation"] textarea').inputValue();
  check("2.2: шаблон положения содержит состав группы", /Состав группы ХАССП\n1\) .+ — руководитель группы/.test(text), text.slice(text.indexOf("Состав"), text.indexOf("Состав") + 120));
  await page.screenshot({ path: "out/11-item-2-2.png", fullPage: true });

  // Ссылка между пунктами заменяет адрес: крестик → обзор
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle" });
  await page.click('[data-ppk-item="2-7"]');
  await page.waitForSelector("[data-ppk-item-dialog]");
  await page.waitForFunction(() => !document.querySelector("[data-ppk-item-skeleton]"), null, { timeout: 60000 });
  const link = page.locator('[data-ppk-item-dialog] a[href="/production-control/item/2-6"]').first();
  if (await link.count()) {
    await link.click();
    await page.waitForURL(`${BASE}/production-control/item/2-6`, { timeout: 30000 });
    await page.keyboard.press("Escape");
    await page.waitForURL(`${BASE}/production-control`, { timeout: 15000 });
    check("из 2.7 в 2.6 и Esc — снова обзор", page.url() === `${BASE}/production-control`, page.url());
  } else {
    check("из 2.7 в 2.6 и Esc — снова обзор", false, "нет ссылки на 2.6 в окне 2.7");
  }
  await context.close();
}

// Сотрудник: страница ознакомления с кнопкой и файл программы
{
  const { context, page } = await login("hotcook1@haccp.local");
  const res = await context.request.get(`${BASE}/api/acknowledgements/ppk/file`);
  check("сотрудник получает программу для ознакомления", res.status() === 200 && (res.headers()["content-type"] ?? "").includes("pdf"), `${res.status()} ${res.headers()["content-type"]}`);
  await page.goto(`${BASE}/acknowledge/ppk`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  check("на странице ознакомления есть «Открыть программу»", (await page.locator('a[href="/api/acknowledgements/ppk/file"]').count()) === 1);
  await page.screenshot({ path: "out/12-acknowledge-ppk-staff.png" });
  await context.close();
}

// Чужой: без входа файл не отдаётся
{
  const context = await browser.newContext();
  const res = await context.request.get(`${BASE}/api/acknowledgements/ppk/file`, { maxRedirects: 0 });
  check("без входа файл программы не отдаётся", res.status() === 401 || res.status() === 307 || res.status() === 302, String(res.status()));
  await context.close();
}

await browser.close();
const failed = out.filter((row) => !row.ok).length;
console.log(`\n${out.length - failed}/${out.length} passed`);
process.exit(failed ? 1 : 0);
