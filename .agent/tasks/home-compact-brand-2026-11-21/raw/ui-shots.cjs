/**
 * Local stand screenshots + measurements for home-compact-brand-2026-11-21.
 * node ui-shots.cjs <outDir> <stand.json> <label> [textSize: normal|large|xlarge]
 * Phone: 390×664 (visible area of an iPhone with browser bars), desktop 1440×900.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const OUT = process.argv[2];
const STAND = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const LABEL = process.argv[4] || "before";
const TEXT = process.argv[5] || "normal";
const PHONE_H = Number(process.env.PHONE_H || 664);
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const log = (name, data) => {
  results.push({ name, ...data });
  console.log(`${name} ${JSON.stringify(data)}`);
};

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"]', STAND.email);
  await page.fill('input[type="password"]', STAND.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 240000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function switchOrg(page, organizationId) {
  return page.evaluate(async (id) => {
    const r = await fetch("/api/me/active-organization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: id }),
    });
    return r.status;
  }, organizationId);
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
}

async function measureHome(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) };
    };
    const favs = [...document.querySelectorAll("[data-home-favorite-empty], [data-home-favorite]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) };
    });
    const se = document.scrollingElement;
    return {
      innerHeight: window.innerHeight,
      scrollHeight: se.scrollHeight,
      overflowX: se.scrollWidth - se.clientWidth,
      hero: box("[data-home-hero]"),
      setup: box("[data-home-setup]"),
      favorites: favs,
      contacts: box("[data-home-contacts]"),
      footer: box("footer"),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  const cookieText = TEXT === "normal" ? [] : [{ name: "wesetup-view", value: `t:${TEXT}|c:auto|m:auto|h:on`, url: BASE }];

  // ── Phone ────────────────────────────────────────────────
  const phone = await browser.newContext({
    viewport: { width: 390, height: PHONE_H },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  if (cookieText.length) await phone.addCookies(cookieText);
  const page = await phone.newPage();
  page.setDefaultTimeout(120000);
  await login(page);
  log("switch-home", { status: await switchOrg(page, STAND.homeId) });
  await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 240000 });
  await settle(page);
  log(`home-phone-${TEXT}`, await measureHome(page));
  await page.screenshot({ path: path.join(OUT, `home-phone-${TEXT}-${LABEL}.png`) });
  await page.screenshot({ path: path.join(OUT, `home-phone-${TEXT}-${LABEL}-full.png`), fullPage: true });

  // Contacts spoiler (after the change): tap opens the same panel.
  const toggle = page.locator("[data-home-contacts-toggle]");
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(500);
    const opened = await page.evaluate(() => {
      const button = document.querySelector("[data-home-contacts-toggle]");
      const panel = document.querySelector("[data-contact-us-panel]");
      const r = panel ? panel.getBoundingClientRect() : null;
      return {
        expanded: button ? button.getAttribute("aria-expanded") : null,
        panelVisible: Boolean(r && r.height > 0),
        tabs: [...document.querySelectorAll("[data-contact-group]")].map((el) => el.textContent.trim()),
        channels: ["data-contact-telegram", "data-contact-max", "data-contact-chat", "data-contact-email"].filter((a) => document.querySelector(`[${a}]`)),
      };
    });
    log("contacts-open", opened);
    await page.locator("[data-home-contacts]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `home-phone-${TEXT}-${LABEL}-contacts-open.png`) });
    await toggle.click();
    await page.waitForTimeout(400);
    log("contacts-closed-again", { expanded: await toggle.getAttribute("aria-expanded") });
    await page.evaluate(() => window.scrollTo(0, 0));
  } else {
    log("contacts-open", { toggle: false });
  }

  // Mobile menu sheet.
  await page.click("[data-nav-burger]");
  await page.waitForTimeout(900);
  const sheet = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const visibleText = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.clip !== "rect(0px, 0px, 0px, 0px)";
    };
    const title = dialog.querySelector("h2");
    const img = dialog.querySelector("[data-organization-brand] img, [data-mobile-nav-brand] img");
    const name = dialog.querySelector("[data-org-short-name]");
    const ir = img ? img.getBoundingClientRect() : null;
    const nr = name ? name.getBoundingClientRect() : null;
    return {
      titleText: title ? title.textContent : null,
      titleVisible: title ? visibleText(title) : null,
      logo: ir ? { top: Math.round(ir.top), height: Math.round(ir.height), width: Math.round(ir.width) } : null,
      name: name ? { text: name.textContent, fontSize: getComputedStyle(name).fontSize, top: nr ? Math.round(nr.top) : null } : null,
      dialogTop: Math.round(dialog.getBoundingClientRect().top),
    };
  });
  log("menu-phone", sheet || {});
  await page.screenshot({ path: path.join(OUT, `menu-phone-${TEXT}-${LABEL}.png`) });
  // The logo in the sheet header leads home and closes the sheet.
  const brandLink = page.locator('[role="dialog"] [data-mobile-nav-brand] a').first();
  if (await brandLink.count()) {
    await page.goto(`${BASE}/settings/organization/branding`, { waitUntil: "load", timeout: 240000 });
    await settle(page);
    await page.click("[data-nav-burger]");
    await page.waitForTimeout(900);
    await page.locator('[role="dialog"] [data-mobile-nav-brand] a').first().click();
    await page.waitForURL((u) => u.pathname === "/home", { timeout: 120000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    log("menu-logo-click", { path: new URL(page.url()).pathname, dialogOpen: (await page.locator('[role="dialog"]').count()) > 0 });
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(600);

  // Branding page of the organization created «как текущая».
  log("switch-gym", { status: await switchOrg(page, STAND.gymId) });
  await page.goto(`${BASE}/settings/organization/branding`, { waitUntil: "load", timeout: 240000 });
  await settle(page);
  const branding = await page.evaluate(() => {
    const logo = document.querySelector("[data-org-logo] img");
    const site = document.querySelector("#brand-site");
    const color = document.querySelector("#brand-color-1-text");
    return {
      logoSrc: logo ? logo.getAttribute("src") : null,
      sitePlaceholder: site ? site.getAttribute("placeholder") : null,
      siteValue: site ? site.value : null,
      brandColor: color ? color.value : null,
      bodyHasDobroe: /dobroe|доброе/i.test(document.body.innerText),
    };
  });
  log("branding-gym", branding);
  await page.locator("#brand-site").scrollIntoViewIfNeeded().catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, `branding-gym-site-${TEXT}-${LABEL}.png`) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, `branding-gym-${TEXT}-${LABEL}.png`) });
  // The menu of the gymnasium (its own brand).
  await page.click("[data-nav-burger]");
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `menu-gym-${TEXT}-${LABEL}.png`) });
  await page.keyboard.press("Escape");
  await phone.close();

  // ── Desktop ──────────────────────────────────────────────
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
  if (cookieText.length) await desk.addCookies(cookieText);
  const dpage = await desk.newPage();
  dpage.setDefaultTimeout(120000);
  await login(dpage);
  await switchOrg(dpage, STAND.homeId);
  await dpage.goto(`${BASE}/home`, { waitUntil: "load", timeout: 240000 });
  await settle(dpage);
  log(`home-desktop-${TEXT}`, await measureHome(dpage));
  await dpage.screenshot({ path: path.join(OUT, `home-desktop-${TEXT}-${LABEL}.png`) });
  await desk.close();

  await browser.close();
  fs.writeFileSync(path.join(OUT, `measure-${TEXT}-${LABEL}.json`), JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
