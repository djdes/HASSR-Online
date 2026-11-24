// Final check 2026-11-24 (AC4): journals with their own create windows at «Выберите объект» (owner, several
// objects, nothing remembered) — the plaque is there and «Создать» says «Выберите объект…» instead of silence
// or a generic error. Local stand only (next dev :3000, stand-seed.ts). Output: UI_OUT or ui-check-point-windows.json.
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
const RAW = "/home/user/HASSR-Online/.agent/tasks/office-objects-favorites-2026-11-23/raw";
const OUT = process.env.UI_OUT || `${RAW}/ui-check-point-windows.json`;
const JOURNALS = ["audit_report", "cleaning", "traceability_test", "audit_plan_scan"];
const POINT_TEXT = "Выберите объект: документ журнала создаётся для объекта";

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
  for (const code of JOURNALS) {
    const errorsBefore = pageErrors.length;
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
    const info = {
      header: ((await page.locator("header [data-current-point]").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim(),
      plaque: await page.locator("[data-journal-point-notice]").count(),
    };
    const create = page.locator('[data-tour="create-document"], button:visible:has-text("Создать документ")').first();
    if ((await create.count()) === 0) {
      info.error = "create button not found";
      out[code] = info;
      continue;
    }
    await create.click();
    await page.waitForTimeout(1500);
    const dialog = page.getByRole("dialog").last();
    if ((await page.getByRole("dialog").count()) > 0) {
      const submit = dialog.locator('button[type="submit"], button:has-text("Создать"), button:has-text("Сохранить")').last();
      if ((await submit.count()) > 0) await submit.click().catch(() => {});
    }
    await page.waitForTimeout(3500);
    const toasts = (await page.locator("[data-sonner-toast]").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
    const dialogText = (await page.getByRole("dialog").count()) > 0 ? ((await dialog.innerText().catch(() => "")) || "").replace(/\s+/g, " ") : "";
    info.toasts = toasts;
    info.pointMessageShown = toasts.some((text) => text.includes(POINT_TEXT)) || dialogText.includes(POINT_TEXT);
    info.newPageErrors = pageErrors.slice(errorsBefore);
    out[code] = info;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
  await browser.close();
})().catch((error) => {
  console.error("UI CHECK FAILED", String(error).slice(0, 400));
  process.exit(1);
});
