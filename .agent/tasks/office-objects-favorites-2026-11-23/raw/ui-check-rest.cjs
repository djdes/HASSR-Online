// Remaining UI checks: staff place pills (AC8), areas guide (AC12), QR missing hint (AC11), phone sheet.
const { chromium, devices } = require("playwright");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
const RAW = "/home/user/HASSR-Online/.agent/tasks/office-objects-favorites-2026-11-23/raw";
const SHOTS = `${RAW}/screens`;
const out = {};
const log = (key, value) => {
  out[key] = value;
  console.log(key, JSON.stringify(value));
};

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", "owner@stand.local");
  await page.fill("#password", "Passw0rd!");
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await login(page);
  await settle(page);

  // AC12: areas guide.
  await page.goto(`${BASE}/settings/areas`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  const guides = await page.locator("[data-page-guide]").evaluateAll((nodes) => nodes.map((node) => (node.textContent || "").replace(/\s+/g, " ").slice(0, 400)));
  log("AC12_guides", guides);
  const allText = await page.evaluate(() => document.body.textContent || "");
  log("AC12_areas_guide", {
    workshop: /Цех живёт в своём объекте/.test(allText),
    tasksflow: /Помещения = TasksFlow задачи/.test(allText),
    tempMaps: /Температурные карты/.test(allText),
    grouping: /Группировка оборудования/.test(allText),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-areas-guide.png` });

  // AC8: staff place pills on /settings/users?place=all (from the office page).
  await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
  await settle(page, 2000);
  await page.click("[data-office-staff-all]");
  await page.waitForURL(/\/settings\/users/);
  await settle(page, 3500);
  const expandButtons = page.locator('button[aria-label="Раскрыть должность"]');
  const expandCount = await expandButtons.count();
  for (let index = 0; index < expandCount; index += 1) {
    await expandButtons.nth(index).click().catch(() => {});
    await page.waitForTimeout(500);
  }
  const pills = await page.locator("[data-staff-place]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent.trim(),
      none: node.hasAttribute("data-staff-place-none"),
      row: (node.closest("label")?.textContent || "").replace(/\s+/g, " ").slice(0, 60),
    })),
  );
  log("AC8_place_pills", { expandButtons: expandCount, pills, header: (await page.locator("header [data-current-point]").first().innerText()).replace(/\s+/g, " ").trim() });
  await page.screenshot({ path: `${SHOTS}/desktop-users-place-pills.png`, fullPage: true });
  if (pills.length > 0) {
    await page.locator("[data-staff-place]").first().click();
    await page.waitForTimeout(2000);
    const dialogText = await page.locator('[role="dialog"]').first().innerText().catch(() => "");
    log("AC8_pill_opens_edit", { dialog: await page.locator('[role="dialog"]').count(), whereWorks: /Где работает/.test(dialogText) });
    await page.screenshot({ path: `${SHOTS}/desktop-users-pill-edit.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // AC11: QR missing hint — the cold equipment document now lives at «Цех пищевых продуктов».
  const docs = await page.evaluate(async () => {
    const response = await fetch("/api/journal-documents?templateCode=cold_equipment_control");
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  const list = Array.isArray(docs.body?.documents) ? docs.body.documents : Array.isArray(docs.body) ? docs.body : [];
  log("AC11_docs_api", { status: docs.status, count: list.length });
  const qrApi = await page.evaluate(async () => {
    const response = await fetch("/api/qr-fill/equipment/deleted-equipment-id");
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  log("AC11_qr_api", qrApi);
  const documentId = list[0]?.id;
  if (documentId) {
    await page.goto(`${BASE}/journals/cold_equipment_control/documents/${documentId}`, { waitUntil: "domcontentloaded" });
    await settle(page, 5000);
    const guideDialog = page.locator('[aria-labelledby="fill-guide-title"]');
    if ((await guideDialog.count()) > 0) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    }
    const row = page.getByText("морозильник 2", { exact: true }).first();
    log("AC11_row", { found: await row.count() });
    if ((await row.count()) > 0) {
      await row.click();
      await page.waitForTimeout(3500);
      log("AC11_qr_missing", {
        missing: await page.locator("[data-qr-preview-missing]").count(),
        text: (await page.locator("[data-qr-fill-preview]").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
        retry: await page.locator('[data-qr-fill-preview] button', { hasText: "Повторить" }).count(),
      });
      await page.screenshot({ path: `${SHOTS}/desktop-qr-missing.png` });
      // Save the row: it is linked again and the QR appears.
      const save = page.getByRole("button", { name: "Сохранить" }).last();
      await save.click();
      await page.waitForTimeout(4000);
      log("AC11_after_save", {
        missing: await page.locator("[data-qr-preview-missing]").count(),
        svg: await page.locator("[data-qr-fill-preview] svg").count(),
        dialogOpen: await page.locator('[role="dialog"]').count(),
      });
      await page.screenshot({ path: `${SHOTS}/desktop-qr-relinked.png` });
    }
  }

  // Phone: header bar and sheet with pins and «Создать объект».
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await phone.newPage();
  mobile.setDefaultTimeout(120000);
  await login(mobile);
  await mobile.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
  await settle(mobile, 3000);
  const bar = mobile.locator("[data-point-bar] [data-current-point]").first();
  log("phone_bar", { text: (await bar.innerText()).replace(/\s+/g, " ").trim() });
  await bar.click();
  await mobile.waitForTimeout(1500);
  log("phone_sheet", {
    options: (await mobile.locator("[data-location-option]").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim()),
    pins: await mobile.locator("[data-pin-building]").count(),
    create: await mobile.locator("[data-point-create]").count(),
    visibleStars: await mobile.locator("[data-favorite-star]").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").length),
  });
  await mobile.screenshot({ path: `${SHOTS}/phone-header-sheet.png` });
  // Pin from the sheet: the sheet stays, «Склад» moves up after refresh.
  const pinButtons = mobile.locator("[data-pin-building]");
  if ((await pinButtons.count()) > 1) {
    await pinButtons.nth(1).click();
    await mobile.waitForTimeout(2500);
    log("phone_pin", {
      sheetStillOpen: await mobile.locator("[data-location-option]").count(),
      pinned: await mobile.locator("[data-pin-building][data-pinned]").count(),
    });
  }

  // Dark theme (the cabinet theme is the user's preference, not prefers-color-scheme).
  const darkReady = await page.evaluate(async () => {
    const response = await fetch("/api/me/theme", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "dark" }) }).catch(() => null);
    return response ? response.status : 0;
  });
  log("dark_theme_api", darkReady);
  await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  log("dark_theme_attr", await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme") ?? document.body.getAttribute("data-app-theme")));
  await page.locator("header [data-current-point]").first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/desktop-dark-header-menu.png` });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SHOTS}/desktop-dark-office.png`, fullPage: true });

  fs.writeFileSync(`${RAW}/ui-check-rest.json`, JSON.stringify(out, null, 2));
  await browser.close();
})().catch((error) => {
  console.error("UI CHECK FAILED", String(error).slice(0, 600));
  fs.writeFileSync(`${RAW}/ui-check-rest.json`, JSON.stringify({ ...out, error: String(error).slice(0, 600) }, null, 2));
  process.exit(1);
});
