// UI check for .agent/tasks/office-objects-favorites-2026-11-23 (local stand, next dev on :3000).
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

async function toasts(page) {
  return page.locator("[data-switch-toast]").count();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await login(page);
  await settle(page);

  // AC1: office page — header «Выберите объект», list without office, footer «Создать объект».
  await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  const trigger = page.locator('header [data-current-point]').first();
  log("AC1_office_trigger", {
    state: await trigger.getAttribute("data-current-point"),
    text: (await trigger.innerText()).replace(/\s+/g, " ").trim(),
    hasCaptionOrganization: (await page.locator("header [data-point-caption]").allInnerTexts()).some((text) => /организ/i.test(text)),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-office-page.png`, fullPage: true });
  await trigger.click();
  await page.waitForSelector("[data-point-menu]");
  const options = await page.locator("[data-point-menu] [data-point-option]").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  log("AC1_menu", {
    options,
    office: options.some((text) => /^Офис/.test(text)),
    create: await page.locator("[data-point-menu] [data-point-create]").count(),
    activeChecked: await page.locator("[data-point-menu] [data-active-option]").count(),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-header-choose-menu.png` });

  // AC6: pin «Склад» — it moves to the top.
  const sklad = page.locator("[data-point-menu] [data-point-option]", { hasText: "Склад" });
  await sklad.hover();
  await sklad.locator("[data-pin-building]").click();
  await page.waitForTimeout(1500);
  const afterPin = await page.locator("[data-point-menu] [data-point-option]").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  log("AC6_after_pin_menu", { first: afterPin[0], pinned: await page.locator("[data-point-menu] [data-pinned]").count() });
  await page.screenshot({ path: `${SHOTS}/desktop-header-pinned.png` });

  // AC2: manual switch to «Кафе на Мира» from the office — no toast.
  await page.locator("[data-point-menu] [data-point-option]", { hasText: "Кафе на Мира" }).click();
  await settle(page, 2500);
  log("AC2_manual_switch", {
    url: new URL(page.url()).pathname,
    header: (await page.locator("header [data-current-point]").first().innerText()).replace(/\s+/g, " ").trim(),
    toasts: await toasts(page),
  });

  // AC3: company section → «Выберите объект» (no toast); journals page → remembered object (no toast).
  await page.goto(`${BASE}/settings/subscription`, { waitUntil: "domcontentloaded" });
  await settle(page, 3000);
  log("AC3_company_section", {
    header: (await page.locator("header [data-current-point]").first().innerText()).replace(/\s+/g, " ").trim(),
    toasts: await toasts(page),
  });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await settle(page, 4000);
  log("AC3_object_section_restore", {
    header: (await page.locator("header [data-current-point]").first().innerText()).replace(/\s+/g, " ").trim(),
    toasts: await toasts(page),
  });

  // AC9: top row «Журналы» opens a list, URL unchanged.
  await page.goto(`${BASE}/settings/areas`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  const before = page.url();
  const journalsTab = page.locator('[data-top-menu-trigger="journals"]');
  const hasTab = (await journalsTab.count()) > 0;
  if (hasTab) {
    await journalsTab.click();
    await page.waitForTimeout(800);
  }
  log("AC9_top_menu", {
    hasTrigger: hasTab,
    panelOpen: await page.locator('[data-top-menu-panel="journals"]').count(),
    urlUnchanged: page.url() === before,
    panelRows: await page.locator('[data-top-menu-panel="journals"] [data-top-menu-link]').count(),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-top-menu-journals-list.png` });
  await page.keyboard.press("Escape");

  // AC12: areas guide — three bullets, no «Группировка оборудования».
  const guideText = await page.locator("[data-page-guide]").first().evaluate((node) => node.textContent || "").catch(() => "");
  log("AC12_areas_guide", {
    guideFound: guideText.length > 0,
    grouping: /Группировка оборудования/.test(guideText),
    tempMaps: /Температурные карты/.test(guideText),
    workshop: /Цех живёт в своём объекте/.test(guideText),
  });

  // AC10: hover star on a left menu item, add to favourites, right-click menu.
  const sidebarItem = page.locator('aside [data-menu-item="equipment"]').first();
  let starInfo = { found: false };
  if ((await sidebarItem.count()) > 0) {
    await sidebarItem.hover();
    const star = page.locator('aside [data-favorite-star="/settings/equipment"]').first();
    starInfo = { found: (await star.count()) > 0, visible: await star.isVisible() };
    if (starInfo.found) {
      await star.click();
      await page.waitForTimeout(2000);
      starInfo.favoriteAfterClick = (await star.getAttribute("data-favorite")) !== null;
    }
  } else {
    // In the classic layout «Оборудование» lives in the top row: star on the tab.
    const tab = page.locator('[data-top-menu-item="equipment"]').first();
    await tab.hover();
    const star = page.locator('[data-favorite-star="/settings/equipment"]').first();
    starInfo = { found: (await star.count()) > 0, visible: await star.isVisible(), where: "top-row" };
    if (starInfo.found) {
      await star.click();
      await page.waitForTimeout(2000);
      starInfo.favoriteAfterClick = (await star.getAttribute("data-favorite")) !== null;
    }
  }
  log("AC10_star", starInfo);
  await page.screenshot({ path: `${SHOTS}/desktop-star-hover.png` });
  const sectionRow = page.locator('aside [data-nav-section="company"]').first();
  await sectionRow.click({ button: "right" });
  await page.waitForTimeout(700);
  log("AC10_context_menu", {
    open: await page.locator("[data-nav-context-menu]").count(),
    items: await page.locator("[data-nav-context-menu] [role=menuitem]").allInnerTexts(),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-context-menu.png` });
  await page.keyboard.press("Escape");

  // Home: favourite card shown.
  await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  log("AC10_home", {
    cards: await page.locator("[data-home-favorite]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-home-favorite"))),
    empty: await page.locator("[data-home-favorite-empty]").count(),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-home-favorites.png` });

  // AC7/AC8: office page blocks; «Показать всех сотрудников объектов».
  await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  log("AC7_office_blocks", {
    leaders: await page.locator("[data-office-staff]").evaluateAll((nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, " ").trim())),
    journalsButtons: await page.locator("[data-open-at-point^=office-journals-]").count(),
    createPoint: await page.locator("[data-office-create-point]").count(),
    pointsAll: await page.locator("[data-office-points-all]").count(),
    equipment: await page.locator("[data-office-equipment-point]").evaluateAll((nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, " ").trim())),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-office-blocks.png`, fullPage: true });
  await page.click("[data-office-staff-all]");
  await page.waitForURL(/\/settings\/users/);
  await settle(page, 4000);
  // Expand every position to see rows.
  const expanders = page.locator('button[aria-label]').filter({ has: page.locator("svg.lucide-chevron-down") });
  log("AC8_users_page", {
    url: new URL(page.url()).pathname + new URL(page.url()).search,
    header: (await page.locator("header [data-current-point]").first().innerText()).replace(/\s+/g, " ").trim(),
    toasts: await toasts(page),
  });
  const expandButtons = page.locator('button[aria-label="Раскрыть должность"]');
  const expandCount = await expandButtons.count();
  for (let index = 0; index < expandCount; index += 1) {
    await expandButtons.nth(index).click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const pills = await page.locator("[data-staff-place]").evaluateAll((nodes) =>
    nodes.map((node) => ({ text: node.textContent.trim(), none: node.hasAttribute("data-staff-place-none") })),
  );
  log("AC8_place_pills", { expanded: expandCount, pills });
  if (pills.length > 0) {
    await page.locator("[data-staff-place]").first().click();
    await page.waitForTimeout(1500);
    log("AC8_pill_opens_edit", { dialog: await page.locator('[role="dialog"]').count() });
    await page.screenshot({ path: `${SHOTS}/desktop-users-pill-edit.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${SHOTS}/desktop-users-all.png`, fullPage: true });

  // AC4: journal page at «Выберите объект» with several objects and nothing remembered.
  await page.evaluate(() => window.localStorage.removeItem("wesetup.point-return"));
  await page.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded" });
  await settle(page, 3000);
  await page.evaluate(() => window.localStorage.removeItem("wesetup.point-return"));
  await page.goto(`${BASE}/journals/hygiene`, { waitUntil: "domcontentloaded" });
  await settle(page, 4000);
  log("AC4_notice", {
    header: (await page.locator("header [data-current-point]").first().innerText()).replace(/\s+/g, " ").trim(),
    notice: await page.locator("[data-journal-point-notice]").count(),
    noticeButtons: await page.locator("[data-journal-point-option]").count(),
    create: await page.locator("[data-journal-point-create]").count(),
  });
  await page.screenshot({ path: `${SHOTS}/desktop-journal-point-notice.png` });
  // API guard.
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateCode: "hygiene", title: "Проверка", dateFrom: "2026-12-01", dateTo: "2026-12-31" }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  log("AC4_api_without_point", { status: api.status, code: api.body && api.body.code });
  // Окно «Как заполнять» открывается само при первом заходе — закрываем.
  const guideDialog = page.locator('[aria-labelledby="fill-guide-title"]');
  if ((await guideDialog.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    if ((await guideDialog.count()) > 0) await guideDialog.locator('button[aria-label="Закрыть"]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
  }
  // Create dialog: «Объект» field.
  const createButton = page.locator('[data-tour="create-document"]').first();
  if ((await createButton.count()) > 0) {
    await createButton.click();
    await page.waitForTimeout(1500);
    log("AC4_dialog_field", {
      pointSelect: await page.locator("#doc-point").count(),
      options: await page.locator("#doc-point option").allInnerTexts(),
      createLink: await page.locator("[data-create-point-link]").count(),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-create-dialog-point.png` });
    await page.keyboard.press("Escape");
  }
  // Choose an object from the notice — silently.
  if ((await page.locator("[data-journal-point-option]").count()) > 0) {
    await page.locator("[data-journal-point-option]").first().click();
    await settle(page, 3500);
    log("AC4_notice_choose", {
      header: (await page.locator("header [data-current-point]").first().innerText()).replace(/\s+/g, " ").trim(),
      notice: await page.locator("[data-journal-point-notice]").count(),
      toasts: await toasts(page),
    });
  }

  // AC11: QR missing hint in the cold equipment journal dialog (document moved to «Цех пищевых продуктов»).
  await page.goto(`${BASE}/journals/cold_equipment_control`, { waitUntil: "domcontentloaded" });
  await settle(page, 3000);
  const docLink = page.locator('a[href*="/journals/cold_equipment_control/documents/"]').first();
  if ((await docLink.count()) > 0) {
    await docLink.click();
    await settle(page, 5000);
    const nameButton = page.getByText("морозильник 2").first();
    if ((await nameButton.count()) > 0) {
      await nameButton.click();
      await page.waitForTimeout(3000);
      log("AC11_qr_missing", {
        missing: await page.locator("[data-qr-preview-missing]").count(),
        text: (await page.locator("[data-qr-fill-preview]").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
        retry: await page.getByRole("button", { name: "Повторить" }).count(),
      });
      await page.screenshot({ path: `${SHOTS}/desktop-qr-missing.png` });
    } else {
      log("AC11_qr_missing", { error: "row not found" });
    }
  } else {
    log("AC11_qr_missing", { error: "document link not found" });
  }

  // Dark theme screenshot of the header menu on the office page.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  await page.locator("header [data-current-point]").first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/desktop-dark-header-menu.png` });
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "light" });

  // Phone: header bar and sheet.
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await phone.newPage();
  mobile.setDefaultTimeout(120000);
  await login(mobile);
  await mobile.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
  await settle(mobile, 3000);
  const bar = mobile.locator("[data-point-bar] [data-current-point]").first();
  log("phone_bar", { text: (await bar.innerText()).replace(/\s+/g, " ").trim() });
  await bar.click();
  await mobile.waitForTimeout(1200);
  log("phone_sheet", {
    options: await mobile.locator("[data-location-option]").allInnerTexts(),
    pins: await mobile.locator("[data-pin-building]").count(),
    create: await mobile.locator("[data-point-create]").count(),
    stars: await mobile.locator("[data-favorite-star]").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").length),
  });
  await mobile.screenshot({ path: `${SHOTS}/phone-header-sheet.png` });

  fs.writeFileSync(`${RAW}/ui-check-desktop-phone.json`, JSON.stringify(out, null, 2));
  await browser.close();
})().catch((error) => {
  console.error("UI CHECK FAILED", error);
  fs.writeFileSync(`${RAW}/ui-check-desktop-phone.json`, JSON.stringify({ ...out, error: String(error) }, null, 2));
  process.exit(1);
});
