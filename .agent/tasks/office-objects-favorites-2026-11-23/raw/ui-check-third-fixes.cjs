// Check of the fixes after the third verifier (2026-11-24), local stand only (next dev :3000, stand-seed.ts):
// 1) «Чек-лист уборки и проветривания»: the create window shows its texts, not raw keys «cleaningGrid.…»;
// 2) «График поверки» → «Сделать копию» at «Выберите объект» (owner, several objects, nothing remembered):
//    the toast says «Выберите объект…» instead of «Проверьте введённые данные».
// Output: UI_OUT or ui-check-third-fixes.json.
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
const RAW = "/home/user/HASSR-Online/.agent/tasks/office-objects-favorites-2026-11-23/raw";
const OUT = process.env.UI_OUT || `${RAW}/ui-check-third-fixes.json`;
const POINT_TEXT = "Выберите объект: документ журнала создаётся для объекта";

async function toOrganizationLevel(page, code) {
  // Раздел компании → уровень организации; объект не запомнен → журнал остаётся на «Выберите объект».
  await page.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.localStorage.removeItem("wesetup.point-return"));
  await page.goto(`${BASE}/journals/${code}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3500);
  const guide = page.locator('[aria-labelledby="fill-guide-title"]');
  if ((await guide.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    if ((await guide.count()) > 0) await guide.locator('button[aria-label="Закрыть"]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
  }
  return ((await page.locator("header [data-current-point]").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
}

(async () => {
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('button[type="submit"]');
      return Boolean(button && Object.keys(button).some((key) => key.startsWith("__reactProps")));
    }, null, { timeout: 120000 }).catch(() => {});
    await page.fill("#email", "owner@stand.local");
    await page.fill("#password", "Passw0rd!");
    await page.click('button[type="submit"]');
    if (await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 }).then(() => true).catch(() => false)) break;
  }
  const out = {};

  // 1) Чек-лист уборки и проветривания: окно создания.
  {
    const header = await toOrganizationLevel(page, "cleaning_ventilation_checklist");
    const create = page.locator('[data-tour="create-document"], button:visible:has-text("Создать документ")').first();
    const info = { header, createButton: await create.count() };
    if (info.createButton > 0) {
      await create.click();
      await page.waitForTimeout(1500);
      const dialog = page.getByRole("dialog").last();
      const text = ((await dialog.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      info.dialogText = text.slice(0, 300);
      info.rawKeys = /cleaningGrid\./.test(text);
      info.titleShown = text.includes("Создать документ") || text.includes("Создание документа");
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }
    out.cleaning_ventilation_checklist = info;
  }

  // 2) График поверки: «Сделать копию» на «Выберите объект».
  {
    const errorsBefore = pageErrors.length;
    const header = await toOrganizationLevel(page, "equipment_calibration");
    const actions = page.locator('button[aria-label="Действия"]:visible');
    const info = { header, documents: await actions.count() };
    if (info.documents > 0) {
      await actions.first().click();
      await page.waitForTimeout(800);
      const copy = page.getByRole("menuitem", { name: "Сделать копию" }).or(page.locator('button:visible:has-text("Сделать копию")')).first();
      info.copyItem = await copy.count();
      if (info.copyItem > 0) {
        await copy.click();
        await page.waitForTimeout(3500);
        const toasts = (await page.locator("[data-sonner-toast]").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
        info.toasts = toasts;
        info.pointMessageShown = toasts.some((text) => text.includes(POINT_TEXT));
        info.genericInvalidShown = toasts.some((text) => text.includes("Проверьте введённые данные"));
      }
    }
    info.newPageErrors = pageErrors.slice(errorsBefore);
    out.equipment_calibration_copy = info;
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((error) => {
  console.error("UI CHECK FAILED", String(error).slice(0, 400));
  process.exit(1);
});
