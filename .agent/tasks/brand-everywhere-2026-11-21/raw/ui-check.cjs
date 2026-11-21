/**
 * Local stand browser check for brand-everywhere-2026-11-21 (AC1–AC4, AC8).
 * node ui-check.cjs <outDir> <stand.json> <logo.png>
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const OUT = process.argv[2];
const STAND = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const LOGO = path.resolve(process.argv[4]);
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, details) => {
  results.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details === undefined ? "" : ` — ${JSON.stringify(details)}`}`);
};
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
const settle = async (page) => {
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
};
/*
 * Белый текст на #1f9d3a — контраст 3,53:1, ниже AA. Акцент затемняется до 4,5:1
 * (`brandAccent`): #1a8531 (4,73:1), наведение — #17752b.
 */
const ACCENT = "#1a8531";
const rgbHex = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || "");
  return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}` : null;
};

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"]', STAND.email);
  await page.fill('input[type="password"]', STAND.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 240000 }), page.click('button[type="submit"]')]);
}

async function save(page) {
  await page.locator("button", { hasText: "Сохранить" }).first().click();
  await page.waitForTimeout(2500);
  await settle(page);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });

  // ── Desktop: «Фирменный стиль» ─────────────────────────────
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
  const page = await desk.newPage();
  page.setDefaultTimeout(120000);
  await login(page);
  await page.goto(`${BASE}/settings/organization/branding`, { waitUntil: "load", timeout: 240000 });
  await settle(page);
  check("AC1 до загрузки логотипа кнопки подбора нет", (await page.locator("[data-pick-palette]").count()) === 0);
  await shot(page, "01-branding-before", true);

  // AC1: загрузка логотипа → цвета подбираются сами.
  await page.setInputFiles('[data-org-logo] input[type="file"]', LOGO);
  await page.waitForFunction(() => (document.querySelector("#brand-color-1-text")?.value ?? "") !== "", null, { timeout: 60000 });
  const auto = await page.evaluate(() => ({
    c1: document.querySelector("#brand-color-1-text")?.value,
    c2: document.querySelector("#brand-color-2-text")?.value,
    c3: document.querySelector("#brand-color-3-text")?.value,
    toast: [...document.querySelectorAll("[data-sonner-toast]")].map((el) => el.textContent?.trim()).join(" | "),
  }));
  check("AC1 после загрузки логотипа цвета подобраны сами (зелёный и оранжевый)", auto.c1 === "#1f9d3a" && auto.c2 === "#f39c12" && !auto.c3, auto);
  check("AC1 сообщение о подборе", /Подобрали цвета под логотип/.test(auto.toast), auto.toast);
  await page.waitForTimeout(800);
  const phone = await page.evaluate(() => {
    const header = document.querySelector('[data-preview="qr-page"] [data-preview-qr-header]');
    const button = document.querySelector('[data-preview="qr-page"] [data-preview-qr-button]');
    return {
      headerBg: header ? getComputedStyle(header).backgroundImage : null,
      button: button ? getComputedStyle(button).backgroundColor : null,
      logo: Boolean(document.querySelector('[data-preview="qr-page"] [data-qr-logo] img')),
    };
  });
  check("AC4 превью телефона — шапка и кнопка в цвете компании, логотип", /rgb\(26, 133, 49\)/.test(`${phone.headerBg}`) && rgbHex(phone.button) === ACCENT && phone.logo, phone);
  await shot(page, "02-branding-auto-colors", true);
  await save(page);

  // AC1: кнопка «Подобрать по логотипу» возвращает цвета логотипа.
  await page.fill("#brand-color-1-text", "#000000");
  await page.fill("#brand-color-2-text", "");
  await page.click("[data-pick-palette]");
  await page.waitForFunction(() => document.querySelector("#brand-color-1-text")?.value === "#1f9d3a", null, { timeout: 30000 });
  const byButton = await page.evaluate(() => ({
    c1: document.querySelector("#brand-color-1-text")?.value,
    c2: document.querySelector("#brand-color-2-text")?.value,
  }));
  check("AC1 кнопка «Подобрать по логотипу»", byButton.c1 === "#1f9d3a" && byButton.c2 === "#f39c12", byButton);
  await page.locator("[data-palette-from-logo]").scrollIntoViewIfNeeded();
  await shot(page, "03-branding-palette-button");

  // AC3: кабинет в цветах компании.
  await page.click('[data-testid="brand-cabinet"]');
  await page.waitForTimeout(500);
  check("AC4 превью кабинета появилось", (await page.locator('[data-preview="cabinet"]').count()) === 1);
  await save(page);
  await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 240000 });
  await settle(page);
  const homeOn = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const setup = document.querySelector("[data-home-setup]");
    return {
      accentAttr: shell?.hasAttribute("data-partner-accent"),
      accentVar: shell ? getComputedStyle(shell).getPropertyValue("--brand-accent").trim() : null,
      setupBg: setup ? getComputedStyle(setup).backgroundColor : null,
    };
  });
  check("AC3 кабинет включён — акцент компании на кабинете (затемнён до AA)", homeOn.accentAttr && homeOn.accentVar === ACCENT, homeOn);
  check("AC3 «Начальная настройка» в цвете компании", rgbHex(homeOn.setupBg) === ACCENT, homeOn.setupBg);
  await shot(page, "04-home-cabinet-accent");
  await page.goto(`${BASE}/settings/organization/branding`, { waitUntil: "load", timeout: 240000 });
  await settle(page);
  await shot(page, "05-branding-cabinet-accent", true);

  // ── Телефон: страница сотрудника по QR ─────────────────────
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
  });
  const qr = await mobile.newPage();
  qr.setDefaultTimeout(120000);
  await qr.goto(`${BASE}/equipment-fill/${STAND.equipmentId}?token=${encodeURIComponent(STAND.token)}`, { waitUntil: "load", timeout: 240000 });
  await settle(qr);
  const qrState = await qr.evaluate(() => {
    const main = document.querySelector("main[data-qr-brand]");
    const header = main?.querySelector("header");
    const primary = [...document.querySelectorAll("main .bg-\\[\\#5566f6\\]")].find((el) => el.getClientRects().length > 0);
    return {
      branded: Boolean(main),
      accentAttr: main?.hasAttribute("data-partner-accent") ?? false,
      headerBg: header ? getComputedStyle(header).backgroundImage : null,
      logo: Boolean(header?.querySelector("[data-qr-logo] img")),
      logoLoaded: (() => {
        const img = header?.querySelector("[data-qr-logo] img");
        return img ? img.complete && img.naturalWidth > 0 : false;
      })(),
      primaryBg: primary ? getComputedStyle(primary).backgroundColor : null,
    };
  });
  check("AC2 страница по QR в стиле компании: логотип в шапке", qrState.branded && qrState.logo && qrState.logoLoaded, qrState);
  check("AC2 шапка — градиент цвета компании (затемнён до AA)", /linear-gradient\(135deg, rgb\(26, 133, 49\), rgb\(23, 117, 43\)\)/.test(`${qrState.headerBg}`), qrState.headerBg);
  check("AC2 основная кнопка — в цвете компании (или её нет на экране)", qrState.primaryBg === null || rgbHex(qrState.primaryBg) === ACCENT, qrState.primaryBg);
  await shot(qr, "06-qr-page-branded");
  await mobile.close();

  // AC3: выключили — кабинет снова WeSetup.
  await page.click('[data-testid="brand-cabinet"]');
  await save(page);
  await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 240000 });
  await settle(page);
  const homeOff = await page.evaluate(() => ({
    accentAttr: document.querySelector(".app-shell")?.hasAttribute("data-partner-accent"),
    setupBg: getComputedStyle(document.querySelector("[data-home-setup]")).backgroundImage,
  }));
  check("AC3 кабинет выключен — прежний вид", !homeOff.accentAttr && /linear-gradient/.test(homeOff.setupBg), homeOff);
  await shot(page, "07-home-default");

  await desk.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, "ui-check.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
