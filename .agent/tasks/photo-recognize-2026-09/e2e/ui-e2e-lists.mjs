// AC3: «С фото» в скоропорте «Редактировать списки → Изделия» (1440 + 390).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire("C:/wt/qrforms/package.json");
const { chromium } = require("playwright-core");
const EXE = "C:/Users/Yaroslav/AppData/Local/ms-playwright/chromium-1232/chrome-win64/chrome.exe";
const BASE = "http://localhost:3042";
const EV = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
const DOC = "/journals/perishable_rejection/documents/cmugz8be4004wkw9m4c6zxqt4";
const DOC_ID = "cmugz8be4004wkw9m4c6zxqt4";
const REGULAR_ORG = "cmugz8a670000kw9mfvb6611i";
const env = Object.fromEntries(
  readFileSync("C:/wt/qrforms/.env", "utf8").split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const MOCK = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/c--www-Users-OrdersFlow/219cb6e5-0fbd-4c76-b9bc-bdaadd99e88b/scratchpad/photo-agent/vision-mock.json";
const originalMock = readFileSync(MOCK, "utf8");
// Новые позиции, которых ещё нет в списках документа (сырьё из мастер-кабинета туда уже разослано).
writeFileSync(MOCK, JSON.stringify({ ...JSON.parse(originalMock), raw: JSON.stringify({ items: [
  { name: "Кефир 2,5%", manufacturer: "ООО «Лесная молочная»", supplier: "ИП Смирнов А. В.", quantity: "6 л", productionDate: null, expiryDate: "2026-10-02" },
  { name: "Ряженка 4%", manufacturer: "ООО «Лесная молочная»", supplier: "ИП Смирнов А. В.", quantity: "4 л", productionDate: null, expiryDate: "2026-10-03" },
] }) }));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
async function login(context) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email: "admin@haccp.local", password: env.ADMIN_PASSWORD, json: "true" } });
  await context.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: REGULAR_ORG } });
  await context.request.post(`${BASE}/api/me/notices`, { data: { key: "fill-guide:perishable_rejection" } });
}
async function openLists(page) {
  await page.goto(`${BASE}${DOC}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByRole("button", { name: "Редактировать списки" }).first().click();
    if (await page.locator('[data-testid="perishable-lists-photo"]').waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false)) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
  }
  throw new Error("lists dialog did not open");
}
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox"] });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  await login(desktop);
  const page = await desktop.newPage();
  await openLists(page);
  check("Скоропорт «Редактировать списки → Изделия»: кнопка «С фото»", await page.locator('[data-testid="perishable-lists-photo"]').isVisible());
  const before = await (await page.request.get(`${BASE}/api/journal-documents/${DOC_ID}`)).json();
  const config = before?.document?.config ?? before?.config ?? {};
  const listBefore = config.productLists?.[0]?.items ?? [];
  const manufacturersBefore = config.manufacturers ?? [];
  await page.locator('[data-testid="perishable-lists-photo"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EV}/e2e-1440-17-perishable-lists.png` });
  await page.setInputFiles('[data-testid="perishable-lists-photo-input"]', `${EV}/ac1-invoice.png`);
  await page.locator('[data-testid="photo-recognize-submit"]').waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="photo-recognize-submit"]')?.hasAttribute("disabled"));
  await page.locator('[data-testid="photo-recognize-submit"]').click();
  await page.waitForSelector('[data-testid="photo-recognize-dialog"][data-phase="review"]', { timeout: 120_000 });
  const rows = await page.locator('[data-testid^="photo-recognize-row-"]').count();
  check("Списки: распознано 2 новые позиции", rows === 2, `rows=${rows}`);
  await page.locator('[data-testid="photo-recognize-add"]').click();
  await page.locator('[data-testid="photo-recognize-dialog"]').waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500); // автосохранение конфига
  const after = await (await page.request.get(`${BASE}/api/journal-documents/${DOC_ID}`)).json();
  const configAfter = after?.document?.config ?? after?.config ?? {};
  const listAfter = configAfter.productLists?.[0]?.items ?? [];
  const manufacturersAfter = configAfter.manufacturers ?? [];
  const suppliersAfter = configAfter.suppliers ?? [];
  check(
    "Списки: изделия, изготовители и поставщик добавлены в списки документа",
    listAfter.length === listBefore.length + 2 && listAfter.includes("Ряженка 4%") && manufacturersAfter.includes("ООО «Лесная молочная»") && suppliersAfter.includes("ИП Смирнов А. В."),
    `изделий ${listBefore.length}→${listAfter.length}, изготовителей ${manufacturersBefore.length}→${manufacturersAfter.length}, поставщиков → ${suppliersAfter.length}`
  );
  await page.screenshot({ path: `${EV}/e2e-1440-18-perishable-lists-added.png` });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU" });
  await login(mobile);
  const phone = await mobile.newPage();
  await openLists(phone);
  await phone.locator('[data-testid="perishable-lists-photo"]').scrollIntoViewIfNeeded();
  const box = await phone.locator('[data-testid="perishable-lists-photo"]').boundingBox();
  check("390: «С фото» в «Редактировать списки» не ниже 48 px", Boolean(box && box.height >= 48), JSON.stringify(box));
  await phone.screenshot({ path: `${EV}/e2e-390-11-perishable-lists.png` });
  await mobile.close();
} finally {
  writeFileSync(MOCK, originalMock);
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
