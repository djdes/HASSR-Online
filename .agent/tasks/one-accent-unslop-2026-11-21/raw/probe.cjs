/*
 * Computed-style probe for spec one-accent-unslop-2026-11-21 (AC1–AC4).
 * Local stand only: `next dev` on http://localhost:3005 with the smoke database
 * (scripts/smoke/run-local.sh). Usage:
 *   SMOKE_DATA='{"email":"…","password":"…"}' node probe.cjs > probe.json
 */
const { existsSync } = require("node:fs");
const { chromium } = require("playwright");
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3005";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local server only");
const data = JSON.parse(process.env.SMOKE_DATA || "{}");

async function open(browser, design, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  await ctx.addCookies([{ name: "wesetup-view", value: encodeURIComponent(`t:normal|c:auto|m:auto|h:on|n:new|d:${design}`), url: BASE }]);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("wesetup-app-theme", t);
      localStorage.setItem("wesetup-theme-mode", t);
      localStorage.setItem("wesetup-theme-auto-schedule", "0");
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
  await page.fill("#email", data.email);
  await page.fill("#password", data.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  return { ctx, page };
}

/** Runs in the page: colour helpers + the measurements. */
function measure() {
  const parse = (value) => {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    }
    // color(srgb r g b / a) and oklab(...) — let the canvas resolve them.
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = "#000";
    c.fillStyle = value;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const backdrop = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.a > 0) layers.push(bg);
      if (bg.a >= 1) break;
    }
    let colour = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) colour = over(layer, colour);
    return colour;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (el, colourProp = "color") => {
    const bg = backdrop(el);
    const fg = over(parse(getComputedStyle(el)[colourProp]), bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  };
  const rgb = (c) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})${c.a < 1 ? ` / ${Math.round(c.a * 100) / 100}` : ""}`;
  const css = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
  const unique = (list) => [...new Set(list)];

  const idleChips = [...document.querySelectorAll("aside [data-nav-row]:not([data-active]) [data-nav-chip]")];
  const allChips = [...document.querySelectorAll("[data-nav-chip]")];
  const primary = [...document.querySelectorAll("main .bg-\\[\\#5566f6\\], header .bg-\\[\\#5566f6\\]")].filter((el) => el.offsetParent);
  const veil = [...document.querySelectorAll(".bg-white\\/15")].filter((el) => el.offsetParent);
  const glowing = [...document.querySelectorAll('[class*="rgba(85,102,246,"]')].filter((el) => el.offsetParent);
  const headerButtons = [...document.querySelectorAll("header a[aria-label], header button[aria-label]")].filter(
    (el) => el.offsetParent && el.querySelector(":scope > svg") && el.getBoundingClientRect().width <= 48,
  );
  const menuText = [...document.querySelectorAll("aside nav a, aside [data-nav-row]")].filter((el) => el.offsetParent && el.textContent.trim());
  const crumbs = [...document.querySelectorAll('main nav[aria-label] a, main nav[aria-label] span, main [aria-current="page"]')].filter(
    (el) => el.offsetParent && el.children.length === 0 && el.textContent.trim(),
  );

  return {
    url: location.pathname,
    sidebarIdleIconColours: unique(idleChips.map((el) => rgb(parse(css(el.querySelector("svg") || el, "color"))))),
    chipBackgrounds: unique(allChips.map((el) => `${css(el, "backgroundImage")} | ${rgb(parse(css(el, "backgroundColor")))} | ${css(el, "boxShadow")}`)),
    primaryFill: unique(primary.map((el) => rgb(parse(css(el, "backgroundColor"))))),
    primaryBackgroundImage: unique(primary.map((el) => css(el, "backgroundImage"))),
    veilOnBrand: unique(veil.map((el) => rgb(parse(css(el, "backgroundColor"))))),
    shadowsOfFormerGlow: unique(glowing.map((el) => css(el, "boxShadow"))),
    headerButtons: headerButtons.map((el) => ({
      label: el.getAttribute("aria-label"),
      background: rgb(parse(css(el, "backgroundColor"))),
      icon: rgb(parse(css(el.querySelector("svg"), "color"))),
      iconContrast: contrast(el.querySelector("svg")),
    })),
    avatarBackgroundImage: unique([...document.querySelectorAll('header [data-slot="avatar-fallback"]')].map((el) => css(el, "backgroundImage"))),
    minSidebarIconContrast: idleChips.length ? Math.min(...idleChips.map((el) => contrast(el.querySelector("svg") || el))) : null,
    navBadges: unique([...document.querySelectorAll("aside [data-nav-row] span")].filter((el) => el.textContent.trim() === "PRO").map((el) => `${css(el, "backgroundImage")} | contrast ${contrast(el)}`)),
    minMenuTextContrast: menuText.length ? Math.min(...menuText.map((el) => contrast(el))) : null,
    menuTextCount: menuText.length,
    minCrumbContrast: crumbs.length ? Math.min(...crumbs.map((el) => contrast(el))) : null,
    crumbCount: crumbs.length,
  };
}

(async () => {
  // Cloud session: the preinstalled browser (as scripts/smoke/new-features.smoke.cjs does).
  const executablePath = process.env.SMOKE_CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new", "--no-sandbox"] } : {});
  const out = {};
  for (const mode of ["classic-light", "classic-dark", "new-light", "new-dark"]) {
    const [design, theme] = mode.split("-");
    const { ctx, page } = await open(browser, design, theme);
    out[mode] = {};
    for (const path of ["/home", "/settings/master-cabinet", "/staff"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 240000 });
      await page.waitForTimeout(2500);
      // A page may still be redirecting (/staff → /settings/users on a cold dev server): measure once it settles.
      let result;
      for (let attempt = 0; ; attempt += 1) {
        try {
          result = await page.evaluate(measure);
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
          await page.waitForLoadState("load").catch(() => {});
          await page.waitForTimeout(2500);
        }
      }
      if (path === "/settings/master-cabinet") {
        // Motion on hover: the icon of a menu row must stay put.
        const row = page.locator("aside [data-nav-row]:not([data-active])").first();
        if (await row.count()) {
          await row.hover();
          await page.waitForTimeout(400);
          result.hoveredChip = await row.evaluate((el) => {
            const chip = el.querySelector("[data-nav-chip]");
            if (!chip) return null;
            const s = getComputedStyle(chip);
            const icon = getComputedStyle(chip.querySelector("svg"));
            return { translate: s.translate, rotate: s.rotate, scale: s.scale, animation: s.animationName, iconAnimation: icon.animationName };
          });
        }
        const bell = page.locator("header button[aria-label]").filter({ has: page.locator("svg.lucide-bell") }).first();
        if (await bell.count()) {
          await bell.hover();
          await page.waitForTimeout(400);
          result.hoveredBell = await bell.evaluate((el) => {
            const s = getComputedStyle(el);
            return { translate: s.translate, boxShadow: s.boxShadow, iconAnimation: getComputedStyle(el.querySelector("svg")).animationName };
          });
        }
      }
      out[mode][path] = result;
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
