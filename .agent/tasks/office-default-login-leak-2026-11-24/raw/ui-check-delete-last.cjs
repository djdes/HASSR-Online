// AC6 (проверка 2026-11-24, P2): компания с одним объектом и открытым офисом удаляет объект —
// на странице «Офис» нет «Добавить в офис» и предупреждения «не распределены».
// Стенд: ui-stand.ts setup (компания «ui-office-straggler», владелец ui-office-straggler@stand.local).
const { chromium } = require("playwright");
const fs = require("node:fs");
const BASE = "http://localhost:3000";
const OUT = "/home/user/HASSR-Online/.agent/tasks/office-default-login-leak-2026-11-24/raw/ui-check-delete-last.json";
(async () => {
  const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.setDefaultTimeout(60000);
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector('form button[type="submit"]'); return Boolean(b && !b.disabled); }, null, { timeout: 180000 });
  await page.fill("#email", "ui-office-straggler@stand.local");
  await page.fill("#password", "Passw0rd!");
  await page.click('form:not([hidden]) button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 });
  const state = async () => {
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    return page.evaluate(() => ({
      officePage: document.querySelector("[data-office-page]")?.getAttribute("data-office-page") ?? null,
      addToOffice: Boolean(document.querySelector("[data-office-staff-add]")),
      unplacedWarning: Boolean(document.querySelector("[data-office-unplaced]")),
      objects: [...document.querySelectorAll("[data-office-point]")].map((el) => el.textContent.replace(/\s+/g, " ").trim()),
      createObject: Boolean(document.querySelector("[data-office-create-point]")),
    }));
  };
  const out = { before: await state() };
  out.objectIds = await page.evaluate(async () => (await (await fetch("/api/settings/buildings")).json()));
  const list = Array.isArray(out.objectIds?.buildings) ? out.objectIds.buildings : Array.isArray(out.objectIds) ? out.objectIds : [];
  const point = list.find((b) => b.kind !== "office");
  out.deleted = point ? await page.evaluate(async (id) => (await fetch(`/api/settings/buildings/${id}`, { method: "DELETE" })).status, point.id) : "no object";
  out.after = await state();
  delete out.objectIds;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((error) => { console.error("UI CHECK FAILED", String(error).slice(0, 400)); process.exit(1); });
