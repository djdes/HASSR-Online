/*
 * States and menus for spec borderless-2026-11-22 (AC1, AC3, AC5). Local stand only.
 *   SMOKE_DATA='{"email":"…","password":"…"}' node states.cjs > states.json
 */
const { existsSync } = require("node:fs");
const { chromium, devices } = require("playwright");
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3005";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local server only");
const data = JSON.parse(process.env.SMOKE_DATA || "{}");

async function open(browser, theme, options) {
  const ctx = await browser.newContext({ locale: "ru-RU", ...options });
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

const alpha = `(value) => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "rgba(0,0,0,0)"; c.fillStyle = value; c.fillRect(0, 0, 1, 1); return c.getImageData(0, 0, 1, 1).data[3] / 255; }`;

(async () => {
  const executablePath = process.env.SMOKE_CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new", "--no-sandbox"] } : {});
  const out = {};
  for (const theme of ["light", "dark"]) {
    const result = {};
    let { ctx, page } = await open(browser, theme, { viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(3000);
    // AC1: the badge and its menu label.
    result.badge = await page.evaluate(() => [...document.querySelectorAll("aside [data-nav-badge]")].map((badge) => {
      const row = badge.closest("a, button");
      const label = row.querySelector("span.min-w-0");
      const s = getComputedStyle(badge);
      return { text: badge.textContent, border: s.borderTopWidth, label: label.textContent, labelFits: label.scrollWidth <= label.clientWidth, spare: label.clientWidth - label.scrollWidth, rowHeight: Math.round(row.getBoundingClientRect().height) };
    }));
    // AC3: the profile menu.
    await page.locator('header [data-slot="avatar"]').last().click({ timeout: 10000 });
    await page.waitForTimeout(1200);
    result.profileMenu = await page.evaluate((alphaSource) => {
      const alpha = eval(alphaSource);
      const menu = document.querySelector('[role="menu"]');
      if (!menu) return null;
      const sides = ["Top", "Right", "Bottom", "Left"];
      const boxed = [menu, ...menu.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && sides.every((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== "none" && alpha(s[`border${k}Color`]) > 0.02);
      });
      return {
        boxesWithBorder: boxed.length,
        which: boxed.map((el) => `${el.tagName.toLowerCase()}${el.matches("select, input, [role='combobox']") || el.querySelector(":scope > select") ? " (поле)" : ""}${el.matches('[aria-checked="true"], [aria-pressed="true"], [data-state="on"], [data-state="checked"]') || el.closest('[aria-checked="true"], [aria-pressed="true"]') ? " (выбрано)" : ""}: ${el.textContent.trim().replace(/\s+/g, " ").slice(0, 24)}`),
      };
    }, alpha);
    await page.keyboard.press("Escape");
    // AC5: a hover border still appears; a field keeps its border.
    await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(3000);
    const card = page.locator('[class*="hover:border-"][class*="border-[#ececf4]"], [class*="hover:border-"][class*="border-[#dcdfed]"]').first();
    if (await card.count()) {
      const read = () => card.evaluate((el, alphaSource) => eval(alphaSource)(getComputedStyle(el).borderTopColor), alpha);
      const rest = await read();
      await card.hover();
      await page.waitForTimeout(700);
      result.hoverBorder = { atRest: rest, hovered: await read() };
    }
    await page.goto(`${BASE}/settings/organization`, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(3000);
    result.fields = await page.evaluate((alphaSource) => {
      const alpha = eval(alphaSource);
      const fields = [...document.querySelectorAll("main input:not([type='checkbox'], [type='radio'], [type='hidden'], [type='file']), main textarea, main select")].filter((el) => el.getBoundingClientRect().width > 2);
      const bordered = (el) => { const s = getComputedStyle(el); return parseFloat(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0.02; };
      const shown = fields.filter((el) => bordered(el) || (el.parentElement && bordered(el.parentElement)));
      return { total: fields.length, withBorder: shown.length };
    }, alpha);
    await ctx.close();
    // AC1 on a phone: the menu sheet.
    ({ ctx, page } = await open(browser, theme, { ...devices["iPhone 13"] }));
    await page.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(3000);
    try {
      await page.locator("header button:has(svg.lucide-menu)").first().click({ timeout: 10000 });
      await page.waitForTimeout(1500);
      result.phoneSheet = await page.evaluate((alphaSource) => {
        const alpha = eval(alphaSource);
        const sheet = document.querySelector("[data-mobile-nav]");
        if (!sheet) return null;
        const lines = [...sheet.querySelectorAll("*")].filter((el) => {
          const s = getComputedStyle(el);
          return el.getBoundingClientRect().width > 2 && ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== "none" && alpha(s[`border${k}Color`]) > 0.02);
        }).length;
        const badges = [...sheet.querySelectorAll("[data-nav-badge]")].map((badge) => {
          const label = badge.closest("a, button").querySelector("span.min-w-0");
          return { text: badge.textContent, label: label.textContent, labelFits: label.scrollWidth <= label.clientWidth };
        });
        return { lines, badges };
      }, alpha);
    } catch (error) {
      result.phoneSheet = { error: String(error).slice(0, 160) };
    }
    await ctx.close();
    out[theme] = result;
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
