/*
 * Border probe for spec borderless-2026-11-22 (AC2–AC6). Local stand only (next dev on
 * localhost:3005 with the smoke database). Usage:
 *   SMOKE_DATA='{"email":"…","password":"…"}' node probe.cjs [--list] > probe.json
 * For every page and theme/design it counts the boxes that still show a border on all four
 * sides, splits them into kept-on-purpose (fields, tables, pictures, accent/status colours,
 * states) and neutral leftovers, and checks that a de-bordered box still differs from what
 * it lies on.
 */
const { existsSync } = require("node:fs");
const { chromium } = require("playwright");
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3005";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local server only");
const data = JSON.parse(process.env.SMOKE_DATA || "{}");
const PAGES = (process.env.PROBE_PAGES || "/home,/settings/master-cabinet,/journals,/settings/users,/dashboard,/settings/subscription").split(",");
const MODES = (process.env.PROBE_MODES || "classic-light,classic-dark,new-light,new-dark").split(",");
const LIST = process.argv.includes("--list");

function measure(list) {
  const parse = (value) => {
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = "rgba(0,0,0,0)";
    c.fillStyle = value;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const cache = new Map();
  const colour = (value) => {
    if (!cache.has(value)) cache.set(value, parse(value));
    return cache.get(value);
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const backdropOf = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const bg = colour(getComputedStyle(node).backgroundColor);
      if (bg.a > 0) layers.push(bg);
      if (bg.a >= 1) break;
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden"; };
  const isField = (el) => el.matches('input, textarea, select, [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"], [data-slot="select-trigger"]') || el.matches(':has(> input:not([type="checkbox"], [type="radio"], [type="hidden"], [type="file"]), > textarea, > select)');
  const inTable = (el) => Boolean(el.closest('table, [role="grid"]'));
  const isNeutral = ({ r, g, b }) => {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    return s <= 0.46; // greys and muted blue-greys, in either theme
  };
  // Same rule as scripts/gen-borderless.mjs: light, and grey or a muted cool blue-grey.
  const neutralHex = (hex) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (l < 0.78) return false;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (s <= 0.2) return true;
    const d = max - min;
    const hue = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
    return hue >= 210 && hue <= 255 && (s <= 0.46 || l >= 0.9);
  };
  const sides = ["Top", "Right", "Bottom", "Left"];
  const all = [...document.querySelectorAll("body *")].filter(visible);
  const boxed = [];
  for (const el of all) {
    if (el.closest("nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button]")) continue;
    const s = getComputedStyle(el);
    const shown = sides.every((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== "none" && colour(s[`border${k}Color`]).a > 0.02);
    if (!shown) continue;
    const c = over(colour(s.borderTopColor), backdropOf(el.parentElement || el));
    // The class decides first: a status colour is muted in the dark theme and would pass for a grey.
    const named = [...String(el.className).matchAll(/(?:^|\s)border-\[#([0-9a-fA-F]{6})\]/g)].map((m) => m[1]);
    const classIsNeutral = named.length ? named.every(neutralHex) : null;
    const neutralLook = classIsNeutral === null ? isNeutral(c) : classIsNeutral;
    const kind = isField(el) ? "field" : inTable(el) ? "table" : el.matches("img, picture, canvas, video, iframe, kbd, [style*='background']") ? "picture" : !neutralLook ? "accent-or-status" : "neutral";
    boxed.push({ el, kind });
  }
  const neutral = boxed.filter((b) => b.kind === "neutral");
  // De-bordered boxes: a transparent border of non-zero width on a box that is not a field or a table cell.
  const cleared = all.filter((el) => {
    const s = getComputedStyle(el);
    return !isField(el) && !inTable(el) && el.classList.contains("border") && sides.every((k) => parseFloat(s[`border${k}Width`]) > 0 && colour(s[`border${k}Color`]).a <= 0.02);
  });
  const invisible = [];
  for (const el of cleared) {
    const own = colour(getComputedStyle(el).backgroundColor);
    if (own.a === 0 && !getComputedStyle(el).backgroundImage.includes("gradient")) { invisible.push({ el, why: "no fill" }); continue; }
    if (getComputedStyle(el).backgroundImage !== "none") continue;
    // A floating control with a shadow (the collapse handle on the menu edge) is set apart by the shadow.
    if (/\d+px [1-9]\d*px|\d+px \d+px [1-9]\d*px/.test(getComputedStyle(el).boxShadow.replace(/rgba?\([^)]*\) 0px 0px 0px 0px,?\s*/g, ""))) continue;
    const under = backdropOf(el.parentElement || document.body);
    const mine = over(own, under);
    if (ratio(mine, under) < 1.03) invisible.push({ el, why: `fill ${ratio(mine, under).toFixed(3)}:1` });
  }
  const describe = (el) => `${el.tagName.toLowerCase()}${el.closest("aside") ? "@aside" : el.closest("header") ? "@header" : ""} .${String(el.className).replace(/\s+/g, " ").slice(0, 150)} | ${el.textContent.trim().replace(/\s+/g, " ").slice(0, 40)}`;
  const kinds = {};
  for (const b of boxed) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
  const aside = document.querySelector("aside[data-app-sidebar]");
  const lineEls = aside
    ? [...aside.querySelectorAll("*"), aside].filter(visible).filter((el) => {
        const s = getComputedStyle(el);
        return !isField(el) && !el.matches("img, [style*='background']") && sides.some((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== "none" && colour(s[`border${k}Color`]).a > 0.02);
      })
    : null;
  const lines = lineEls ? lineEls.length : null;
  const header = document.querySelector("header.sticky");
  const shell = document.querySelector(".app-shell");
  const firstCard = [...document.querySelectorAll("main .bg-white, main .bg-card")].find(visible);
  return {
    url: location.pathname,
    boxes: kinds,
    neutralBoxes: neutral.length,
    neutralList: list ? neutral.slice(0, 25).map((b) => describe(b.el)) : undefined,
    clearedBoxes: cleared.length,
    invisibleBoxes: invisible.length,
    invisibleList: list ? invisible.slice(0, 25).map((b) => `${b.why} — ${describe(b.el)}`) : undefined,
    sidebarLines: lines,
    sidebarLineList: list && lineEls ? lineEls.slice(0, 8).map(describe) : undefined,
    headerBottomLine: header ? colour(getComputedStyle(header).borderBottomColor).a > 0.02 && parseFloat(getComputedStyle(header).borderBottomWidth) > 0 : null,
    canvas: shell ? getComputedStyle(shell).backgroundColor : null,
    cardVsCanvas: firstCard && shell ? Number(ratio(over(colour(getComputedStyle(firstCard).backgroundColor), backdropOf(firstCard.parentElement)), backdropOf(firstCard.parentElement)).toFixed(3)) : null,
    // Layout: the boxes of the page body keep their place and size (the border width is kept).
    geometry: (() => {
      const main = document.querySelector("main");
      if (!main) return null;
      const rects = [...main.querySelectorAll(".border")].filter(visible).slice(0, 80).map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.x)},${Math.round(r.y + window.scrollY)},${Math.round(r.width)},${Math.round(r.height)}`;
      });
      return { mainHeight: main.scrollHeight, mainWidth: main.scrollWidth, rects };
    })(),
    fieldsWithBorder: boxed.filter((b) => b.kind === "field").length,
    fieldsTotal: all.filter((el) => el.matches("input:not([type='checkbox'], [type='radio'], [type='hidden'], [type='file']), textarea, select")).length,
  };
}

(async () => {
  const executablePath = process.env.SMOKE_CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new", "--no-sandbox"] } : {});
  const out = {};
  for (const mode of MODES) {
    const [design, theme] = mode.split("-");
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
    out[mode] = {};
    for (const path of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 240000 });
      await page.waitForTimeout(3000);
      let result;
      for (let attempt = 0; ; attempt += 1) {
        try {
          result = await page.evaluate(measure, LIST);
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
          await page.waitForLoadState("load").catch(() => {});
          await page.waitForTimeout(2500);
        }
      }
      out[mode][path] = result;
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
