/**
 * Скриншот подсказки темы «Принципы ХАССП» в форме записи журнала
 * инструктажей (десктоп 1440×900 и телефон 390×800).
 *
 *   node .agent/tasks/journal-sets-checklists-2026-10/e2e/training-topic-shot.mjs http://localhost:3031
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:3031";
const DIR = ".agent/tasks/journal-sets-checklists-2026-10/raw";
const state = JSON.parse(fs.readFileSync(`${DIR}/e2e-state.json`, "utf8"));
const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const chromeDir = fs.readdirSync(root).filter((d) => d.startsWith("chromium-") && !d.includes("headless")).sort().pop();
const executablePath = path.join(root, chromeDir, "chrome-win64", "chrome.exe");

// Документ журнала инструктажей на текущий месяц — через API, как кнопка «Создать документ».
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email: "js-manager@e2e.local", password: state.password }),
});
// Живые куки сессии: остальные в ответе — очищающие (Max-Age=0).
const liveCookies = (res) => res.headers.getSetCookie().filter((c) => !/Max-Age=0/i.test(c)).map((c) => c.split(";")[0]).join("; ");
// Новый пользователь сначала принимает актуальную оферту (иначе окно перекроет страницу), затем входит заново.
await fetch(`${BASE}/api/legal/accept`, { method: "POST", headers: { Cookie: liveCookies(login), Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }) });
const relogin = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email: "js-manager@e2e.local", password: state.password }) });
const cookieHeader = liveCookies(relogin);
const now = new Date();
const from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
const to = now.toISOString().slice(0, 10);
const created = await fetch(`${BASE}/api/journal-documents`, {
  method: "POST",
  headers: { Cookie: cookieHeader, Origin: BASE, "Content-Type": "application/json" },
  body: JSON.stringify({ templateCode: "staff_training", title: "Журнал регистрации инструктажей", dateFrom: from, dateTo: to }),
});
const doc = await created.json();
// Повторный прогон: документ за период уже есть — открываем его.
const docId = doc.document?.id ?? doc.id ?? doc.existing?.id;
if (!docId) throw new Error(`документ не создан: ${created.status} ${JSON.stringify(doc)}`);

const browser = await chromium.launch({ executablePath });
const results = [];
for (const viewport of [{ width: 1440, height: 900, name: "desktop" }, { width: 390, height: 800, name: "mobile" }]) {
  const context = await browser.newContext({ viewport, baseURL: BASE });
  await context.addCookies(
    cookieHeader.split("; ").map((pair) => {
      const [name, ...rest] = pair.split("=");
      return { name, value: rest.join("="), url: BASE };
    }),
  );
  const page = await context.newPage();
  await page.goto(`/journals/staff_training/documents/${docId}`, { waitUntil: "load", timeout: 300_000 });
  await page.waitForTimeout(3000);
  // При первом визите поверх страницы открывается инструкция журнала — закрываем.
  const understood = page.getByRole("button", { name: "Понятно" });
  if (await understood.isVisible().catch(() => false)) {
    await understood.click();
    await page.waitForTimeout(800);
  }
  // «Добавить» — меню; окно записи открывает пункт «Добавить сотрудника».
  await page.getByRole("button", { name: /^Добавить/ }).first().click();
  await page.getByText("Добавить сотрудника", { exact: true }).last().click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: "Добавление записи" });
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.locator("label", { hasText: "Тема обучения" }).locator("xpath=following-sibling::*[1]").click();
  await page.waitForTimeout(800);
  await page.getByRole("option", { name: "Принципы ХАССП" }).click({ timeout: 15_000 });
  const hint = dialog.getByText("О чём рассказать:");
  await hint.waitFor();
  await hint.scrollIntoViewIfNeeded();
  const text = await hint.locator("xpath=..").innerText();
  const file = `${DIR}/training-topic-hint-${viewport.name}.png`;
  await page.screenshot({ path: file });
  results.push({ viewport: viewport.name, hint: text, file });
  await context.close();
}
await browser.close();
fs.writeFileSync(`${DIR}/training-topic-hint.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
