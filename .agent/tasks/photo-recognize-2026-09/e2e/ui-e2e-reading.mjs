// Follow-up UI e2e: «Снять показание с дисплея» (DisplayOcrButton) in the cold equipment journal, 1440 + 390.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire("C:/wt/qrforms/package.json");
const { chromium } = require("playwright-core");
const EXE = "C:/Users/Yaroslav/AppData/Local/ms-playwright/chromium-1232/chrome-win64/chrome.exe";
const BASE = "http://localhost:3042";
const EV = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
const DOC_ID = "cmugz8bc4004dkw9mtrw68qn1";
const DOC = `/journals/cold_equipment_control/documents/${DOC_ID}`;
const REGULAR_ORG = "cmugz8a670000kw9mfvb6611i";
const env = Object.fromEntries(
  readFileSync("C:/wt/qrforms/.env", "utf8").split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
async function login(context) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email: "admin@haccp.local", password: env.ADMIN_PASSWORD, json: "true" } });
  await context.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: REGULAR_ORG } });
  await context.request.post(`${BASE}/api/me/notices`, { data: { key: "fill-guide:cold_equipment_control" } });
}

async function run(context, label, shots) {
  const page = await context.newPage();
  await page.goto(`${BASE}${DOC}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  const done = page.getByRole("button", { name: "Понятно" });
  if (await done.isVisible().catch(() => false)) await done.click();
  // Карточки «на сегодня» с полем температуры — на вкладке «Сегодня» (на компьютере по умолчанию — таблица).
  const button = page.locator('button[aria-label="Снять показание с дисплея"]').filter({ visible: true }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await button.isVisible().catch(() => false)) break;
    const today = page.getByText("Сегодня", { exact: true }).filter({ visible: true }).first();
    if (await today.isVisible().catch(() => false)) await today.click();
    await page.waitForTimeout(1500);
  }
  await button.waitFor({ state: "visible", timeout: 60_000 });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  check(`${label}: кнопка «Снять показание с дисплея» на месте`, Boolean(box), JSON.stringify(box));
  const input = button.locator('xpath=preceding-sibling::input[@type="file"][1]');
  // Гидратация: до неё onChange ещё не висит — ждём, пока кнопка станет интерактивной.
  await page.waitForTimeout(1500);
  await input.setInputFiles(`${EV}/fu-display-readable.png`);
  const loading = page.getByText("Распознаём показание… обычно 10–40 секунд");
  const sawLoading = await loading.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
  check(`${label}: подсказка «Распознаём показание… обычно 10–40 секунд»`, sawLoading);
  if (sawLoading) await page.screenshot({ path: `${EV}/${shots.loading}.png` });
  const success = page.getByText("Распознано: -18.5");
  const sawSuccess = await success.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false);
  check(`${label}: тот же тост стал «Распознано: -18.5»`, sawSuccess);
  const values = await page.$$eval("input", (els) => els.map((el) => el.value));
  check(`${label}: число подставлено в поле температуры`, values.some((v) => /^-18[.,]5$/.test(v)), values.filter((v) => /18/.test(v)).join(" | "));
  await page.screenshot({ path: `${EV}/${shots.done}.png` });
  await page.waitForTimeout(2500);
  const saved = await page.request
    .get(`${BASE}/api/journal-documents/${DOC_ID}`, { timeout: 90_000 })
    .then((response) => response.text())
    .catch((error) => `request failed: ${error.message.split("\n")[0]}`);
  check(`${label}: значение сохранено в документе`, /-18\.5/.test(saved), /-18\.5/.test(saved) ? "" : saved.slice(0, 120));
  await page.close();
}

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox"] });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  await login(desktop);
  await run(desktop, "1440", { loading: "fu-1440-01-reading-loading", done: "fu-1440-02-reading-done" });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU" });
  await login(mobile);
  await run(mobile, "390", { loading: "fu-390-01-reading-loading", done: "fu-390-02-reading-done" });
  await mobile.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
