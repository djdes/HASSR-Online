// Final UI check for .agent/tasks/office-objects-favorites-2026-11-23 on the current code
// (local stand: next dev on :3000, data from stand-seed.ts, state reset by stand-reset.ts).
// Every step is isolated: a failing step records its error and the run goes on.
const { chromium, devices } = require("playwright");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
const RAW = "/home/user/HASSR-Online/.agent/tasks/office-objects-favorites-2026-11-23/raw";
const SHOTS = process.env.SHOTS_DIR || `${RAW}/screens`;
// UI_OUT — свой файл результата (например, у проверяющего); SHOTS_DIR — свои скриншоты.
const OUT = process.env.UI_OUT || (process.env.ONLY ? `${RAW}/ui-check-final-${process.env.ONLY.replace(/,/g, "-")}.json` : `${RAW}/ui-check-final.json`);
const out = { startedAt: new Date().toISOString() };
const log = (key, value) => {
  out[key] = value;
  console.log(key, JSON.stringify(value));
};
const clean = (text) => (text || "").replace(/\s+/g, " ").trim();

const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);

async function step(key, run) {
  if (ONLY.length > 0 && !ONLY.includes(key)) return;
  try {
    await run();
  } catch (error) {
    log(`${key}_error`, String(error).slice(0, 400));
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", "owner@stand.local");
  await page.fill("#password", "Passw0rd!");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000, waitUntil: "commit" }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("domcontentloaded", { timeout: 180000 }).catch(() => {});
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// Any toast at all: the old «switched» toast and every sonner toast.
async function toasts(page) {
  return (await page.locator("[data-switch-toast]").count()) + (await page.locator("[data-sonner-toast]").count());
}

async function header(page) {
  return clean(await page.locator("header [data-current-point]").first().innerText());
}

async function closeFillGuide(page) {
  const guide = page.locator('[aria-labelledby="fill-guide-title"]');
  if ((await guide.count()) === 0) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  if ((await guide.count()) > 0) await guide.locator('button[aria-label="Закрыть"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  // The repo pins its own Playwright; the container's browser lives here.
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await login(page);
  await settle(page);

  await step("AC1", async () => {
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    const trigger = page.locator("header [data-current-point]").first();
    log("AC1_office_trigger", {
      state: await trigger.getAttribute("data-current-point"),
      text: clean(await trigger.innerText()),
      captionOrganization: (await page.locator("header [data-point-caption]").allInnerTexts()).some((text) => /организ/i.test(text)),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-office-page.png`, fullPage: true });
    await trigger.click();
    await page.waitForSelector("[data-point-menu]");
    const options = (await page.locator("[data-point-menu] [data-point-option]").allInnerTexts()).map(clean);
    const menuText = clean(await page.locator("[data-point-menu]").innerText());
    log("AC1_menu", {
      options,
      office: options.some((text) => /^Офис/.test(text)),
      wholeOrganization: /Вся организация|Все объекты/.test(menuText),
      create: await page.locator("[data-point-menu] [data-point-create]").count(),
      activeChecked: await page.locator("[data-point-menu] [data-active-option]").count(),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-header-choose-menu.png` });
  });

  await step("AC6", async () => {
    const before = page.url();
    const sklad = page.locator("[data-point-menu] [data-point-option]", { hasText: "Склад" });
    await sklad.hover();
    await sklad.locator("[data-pin-building]").click();
    await page.waitForTimeout(2000);
    const after = (await page.locator("[data-point-menu] [data-point-option]").allInnerTexts()).map(clean);
    log("AC6_pin_in_header", {
      first: after[0],
      pinned: await page.locator("[data-point-menu] [data-pinned]").count(),
      menuStillOpen: await page.locator("[data-point-menu]").count(),
      urlUnchanged: page.url() === before,
    });
    await page.screenshot({ path: `${SHOTS}/desktop-header-pinned.png` });
  });

  await step("AC2", async () => {
    await page.locator("[data-point-menu] [data-point-option]", { hasText: "Кафе на Мира" }).click();
    const start = Date.now();
    await page.waitForURL(/\/settings\/buildings\//, { timeout: 30000 }).catch(() => {});
    const ms = Date.now() - start;
    await settle(page, 1500);
    log("AC2_manual_switch", { url: new URL(page.url()).pathname, ms, header: await header(page), toasts: await toasts(page) });
  });

  await step("AC3", async () => {
    await page.goto(`${BASE}/settings/subscription`, { waitUntil: "domcontentloaded" });
    await settle(page, 3000);
    log("AC3_company_section", { header: await header(page), toasts: await toasts(page) });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await settle(page, 4000);
    log("AC3_object_section_restore", { header: await header(page), toasts: await toasts(page) });
  });

  await step("AC9", async () => {
    await page.goto(`${BASE}/settings/areas`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    const before = page.url();
    const tab = page.locator('[data-top-menu-trigger="journals"]');
    const hasTrigger = (await tab.count()) > 0;
    if (hasTrigger) {
      await tab.click();
      await page.waitForTimeout(800);
    }
    log("AC9_top_menu", {
      hasTrigger,
      panelOpen: await page.locator('[data-top-menu-panel="journals"]').count(),
      urlUnchanged: page.url() === before,
      panelRows: (await page.locator('[data-top-menu-panel="journals"] [data-top-menu-link]').allInnerTexts()).map(clean),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-top-menu-journals-list.png` });
    await page.keyboard.press("Escape");
  });

  await step("AC12", async () => {
    const text = await page.evaluate(() => document.body.textContent || "");
    log("AC12_areas_guide", {
      guideTitle: /Зачем нужны цеха/.test(text),
      workshop: /Цех живёт в своём объекте/.test(text),
      tempMaps: /Температурные карты/.test(text),
      grouping: /Группировка оборудования/.test(text),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-areas-guide.png` });
  });

  await step("AC10", async () => {
    const tab = page.locator('[data-top-menu-item="equipment"]').first();
    await tab.hover();
    const star = page.locator('[data-favorite-star="/settings/equipment"]').first();
    const found = (await star.count()) > 0;
    const info = { found, where: "top-row", visibleOnHover: found ? await star.isVisible() : false };
    if (found) {
      await star.click();
      await page.waitForTimeout(2000);
      info.favoriteAfterClick = (await star.getAttribute("data-favorite")) !== null;
      info.toastAfterClick = await page.locator("[data-sonner-toast]").allInnerTexts();
    }
    log("AC10_star", info);
    await page.screenshot({ path: `${SHOTS}/desktop-star-hover.png` });
    const row = page.locator('aside [data-nav-section="company"]').first();
    await row.click({ button: "right" });
    await page.waitForTimeout(700);
    log("AC10_context_menu", {
      open: await page.locator("[data-nav-context-menu]").count(),
      items: (await page.locator("[data-nav-context-menu] [role=menuitem]").allInnerTexts()).map(clean),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-context-menu.png` });
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    log("AC10_home", {
      cards: await page.locator("[data-home-favorite]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-home-favorite"))),
      emptySlots: await page.locator("[data-home-favorite-empty]").count(),
      header: await header(page),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-home-favorites.png` });
  });

  await step("AC7", async () => {
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    log("AC7_office_blocks", {
      leaders: await page.locator("[data-office-staff]").evaluateAll((nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, " ").trim())),
      staffAll: await page.locator("[data-office-staff-all]").count(),
      journalsButtons: await page.locator("[data-open-at-point^=office-journals-]").count(),
      createPoint: await page.locator("[data-office-create-point]").count(),
      pointsAll: await page.locator("[data-office-points-all]").count(),
      equipment: await page.locator("[data-office-equipment-point]").evaluateAll((nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, " ").trim())),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-office-blocks.png`, fullPage: true });
  });

  await step("AC8", async () => {
    await page.click("[data-office-staff-all]");
    await page.waitForURL(/\/settings\/users/);
    await settle(page, 4000);
    log("AC8_users_page", {
      url: new URL(page.url()).pathname + new URL(page.url()).search,
      header: await header(page),
      toasts: await toasts(page),
    });
    const expand = page.locator('button[aria-label="Раскрыть должность"]');
    const expandCount = await expand.count();
    for (let index = 0; index < expandCount; index += 1) {
      await expand.nth(index).click().catch(() => {});
      await page.waitForTimeout(400);
    }
    const pills = await page.locator("[data-staff-place]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent.trim(),
        none: node.hasAttribute("data-staff-place-none"),
        row: (node.closest("label")?.textContent || "").replace(/\s+/g, " ").slice(0, 40),
      })),
    );
    log("AC8_place_pills", { expanded: expandCount, pills });
    await page.screenshot({ path: `${SHOTS}/desktop-users-place-pills.png`, fullPage: true });
    if (pills.length > 0) {
      await page.locator("[data-staff-place]").first().click();
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const dialogText = clean(await dialog.innerText().catch(() => ""));
      log("AC8_pill_opens_edit", {
        dialog: await page.getByRole("dialog").count(),
        whereWorks: /Где работает/i.test(dialogText),
        pointNamed: /Цех пищевых продуктов/.test(dialogText),
      });
      await page.screenshot({ path: `${SHOTS}/desktop-users-pill-edit.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  });

  await step("AC4", async () => {
    // Company page → organisation level; then forget the remembered object: several objects, nothing remembered.
    await page.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded" });
    await settle(page, 3000);
    await page.evaluate(() => window.localStorage.removeItem("wesetup.point-return"));
    await page.goto(`${BASE}/journals/hygiene`, { waitUntil: "domcontentloaded" });
    await settle(page, 4000);
    log("AC4_notice", {
      header: await header(page),
      notice: await page.locator("[data-journal-point-notice]").count(),
      noticeText: clean(await page.locator("[data-journal-point-notice]").first().innerText().catch(() => "")),
      noticeButtons: await page.locator("[data-journal-point-option]").count(),
      create: await page.locator("[data-journal-point-create]").count(),
      toasts: await toasts(page),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-journal-point-notice.png` });
    const api = await page.evaluate(async () => {
      const response = await fetch("/api/journal-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateCode: "hygiene", title: "Проверка", dateFrom: "2026-12-01", dateTo: "2026-12-31" }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    });
    log("AC4_api_without_point", { status: api.status, code: api.body && api.body.code, error: api.body && api.body.error });
    await closeFillGuide(page);
    const create = page.locator('[data-tour="create-document"]').first();
    if ((await create.count()) > 0) {
      await create.click();
      await page.waitForTimeout(1500);
      const field = page.locator("[data-create-point-field]");
      const fieldInfo = {
        pointSelect: await page.locator("#doc-point").count(),
        requiredMark: await field.locator("label span[aria-hidden]").count(),
        options: (await page.locator("#doc-point option").allInnerTexts()).map(clean),
        createLink: await page.locator("[data-create-point-link]").count(),
      };
      await page.screenshot({ path: `${SHOTS}/desktop-create-dialog-point.png` });
      // Submit without an object: the dialog refuses with the field error and sends nothing.
      let posts = 0;
      const onRequest = (request) => {
        if (request.method() === "POST" && request.url().includes("/api/journal-documents")) posts += 1;
      };
      page.on("request", onRequest);
      await page.getByRole("dialog").last().locator('button[type="submit"]').click();
      await page.waitForTimeout(1500);
      page.off("request", onRequest);
      fieldInfo.submitWithoutObject = {
        fieldError: clean(await field.innerText()).includes("Выберите объект: документ журнала создаётся для объекта"),
        postsSent: posts,
        dialogOpen: await page.getByRole("dialog").count(),
      };
      log("AC4_dialog_field", fieldInfo);
      await page.screenshot({ path: `${SHOTS}/desktop-create-dialog-point-required.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    } else {
      log("AC4_dialog_field", { error: "create button not found" });
    }
    if ((await page.locator("[data-journal-point-option]").count()) > 0) {
      await page.locator("[data-journal-point-option]").first().click();
      await settle(page, 3500);
      log("AC4_notice_choose", {
        header: await header(page),
        notice: await page.locator("[data-journal-point-notice]").count(),
        toasts: await toasts(page),
      });
    }
  });

  await step("AC11", async () => {
    const qrApi = await page.evaluate(async () => {
      const response = await fetch("/api/qr-fill/equipment/deleted-equipment-id");
      return { status: response.status, body: await response.json().catch(() => null) };
    });
    log("AC11_qr_api", qrApi);
    await page.goto(`${BASE}/journals/cold_equipment_control`, { waitUntil: "domcontentloaded" });
    await settle(page, 3000);
    await closeFillGuide(page);
    const docLink = page.locator('a[href*="/journals/cold_equipment_control/documents/"]').first();
    if ((await docLink.count()) === 0) {
      log("AC11_qr_missing", { error: "document link not found", header: await header(page) });
      return;
    }
    await docLink.click();
    await page.waitForURL(/\/documents\//);
    await settle(page, 5000);
    await closeFillGuide(page);
    const row = page.getByText("морозильник 2").first();
    if ((await row.count()) === 0) {
      log("AC11_qr_missing", { error: "row not found" });
      return;
    }
    await row.click();
    await page.waitForTimeout(3500);
    log("AC11_qr_missing", {
      missing: await page.locator("[data-qr-preview-missing]").count(),
      text: clean(await page.locator("[data-qr-fill-preview]").first().innerText().catch(() => "")),
      retry: await page.locator("[data-qr-fill-preview] button", { hasText: "Повторить" }).count(),
      objectNotFound: await page.getByText("Объект не найден").count(),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-qr-missing.png` });
    await page.getByRole("button", { name: "Сохранить" }).last().click();
    await page.waitForTimeout(4500);
    log("AC11_after_save", {
      missing: await page.locator("[data-qr-preview-missing]").count(),
      qrSvg: await page.locator("[data-qr-fill-preview] svg").count(),
      dialogOpen: await page.getByRole("dialog").count(),
    });
    await page.screenshot({ path: `${SHOTS}/desktop-qr-relinked.png` });
  });

  await step("phone", async () => {
    const phone = await browser.newContext({ ...devices["iPhone 13"] });
    const mobile = await phone.newPage();
    mobile.setDefaultTimeout(60000);
    await login(mobile);
    await mobile.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
    await settle(mobile, 3000);
    const bar = mobile.locator("[data-point-bar] [data-current-point]").first();
    log("phone_bar", { text: clean(await bar.innerText()) });
    await bar.click();
    await mobile.waitForTimeout(1500);
    log("phone_sheet", {
      options: (await mobile.locator("[data-location-option]").allInnerTexts()).map(clean),
      pins: await mobile.locator("[data-pin-building]").count(),
      create: await mobile.locator("[data-point-create]").count(),
      visibleStars: await mobile.locator("[data-favorite-star]").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").length),
    });
    await mobile.screenshot({ path: `${SHOTS}/phone-header-sheet.png` });
    const pins = mobile.locator("[data-pin-building]");
    if ((await pins.count()) > 1) {
      await pins.nth(1).click();
      await mobile.waitForTimeout(2500);
      log("phone_pin", {
        sheetStillOpen: await mobile.locator("[data-location-option]").count(),
        pinned: await mobile.locator("[data-pin-building][data-pinned]").count(),
        url: new URL(mobile.url()).pathname,
      });
    }
    await phone.close();
  });

  await step("mini", async () => {
    const miniContext = await browser.newContext({ ...devices["iPhone 13"] });
    const mini = await miniContext.newPage();
    mini.setDefaultTimeout(60000);
    await login(mini);
    await mini.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
    await settle(mini, 3000);
    await miniContext.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    await mini.goto(`${BASE}/mini/me`, { waitUntil: "domcontentloaded" });
    await settle(mini, 4000);
    const section = mini.locator("section.mini-card").filter({ has: mini.locator("button[aria-pressed]") }).first();
    const options = (await section.locator("button[aria-pressed]").allInnerTexts().catch(() => [])).map(clean);
    const bodyText = await mini.evaluate(() => document.body.innerText);
    log("mini_switcher", {
      options,
      pressed: await section.locator('button[aria-pressed="true"]').count().catch(() => -1),
      office: options.some((text) => /^Офис/.test(text)),
      wholeOrganization: /Вся организация/.test(bodyText),
      chooseLabel: /Выберите объект|ВЫБЕРИТЕ ОБЪЕКТ/i.test(bodyText),
    });
    await mini.screenshot({ path: `${SHOTS}/mini-location-switcher.png`, fullPage: true });
    if (options.length > 0) {
      await section.locator("button[aria-pressed]").first().click();
      await mini.waitForTimeout(3500);
      log("mini_switch", { pressed: await section.locator('button[aria-pressed="true"]').count(), toasts: await toasts(mini) });
    }
    await miniContext.close();
  });

  await step("dark", async () => {
    const darkContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await darkContext.addCookies([{ name: "wesetup-theme", value: "dark", url: BASE }]);
    const dark = await darkContext.newPage();
    dark.setDefaultTimeout(60000);
    await login(dark);
    await dark.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded" });
    await settle(dark, 2500);
    log("dark_theme", { attr: await dark.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme") ?? null) });
    await dark.locator("header [data-current-point]").first().click();
    await dark.waitForTimeout(900);
    await dark.screenshot({ path: `${SHOTS}/desktop-dark-header-menu.png` });
    await dark.keyboard.press("Escape");
    await dark.screenshot({ path: `${SHOTS}/desktop-dark-office.png`, fullPage: true });
    await dark.goto(`${BASE}/settings/users?place=all`, { waitUntil: "domcontentloaded" });
    await settle(dark, 3000);
    const expand = dark.locator('button[aria-label="Раскрыть должность"]');
    for (let index = 0; index < (await expand.count()); index += 1) {
      await expand.nth(index).click().catch(() => {});
      await dark.waitForTimeout(400);
    }
    await dark.screenshot({ path: `${SHOTS}/desktop-dark-users-pills.png`, fullPage: true });
    await dark.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
    await settle(dark, 2500);
    await dark.screenshot({ path: `${SHOTS}/desktop-dark-home.png` });
    await darkContext.close();
  });

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  await browser.close();
})().catch((error) => {
  console.error("UI CHECK FAILED", String(error).slice(0, 600));
  fs.writeFileSync(OUT, JSON.stringify({ ...out, fatal: String(error).slice(0, 600) }, null, 2));
  process.exit(1);
});
