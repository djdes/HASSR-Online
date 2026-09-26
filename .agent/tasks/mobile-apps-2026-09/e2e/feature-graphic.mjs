// Баннер Google Play 1024x500 (без альфа) и значок 512x512 (RGBA) из mobile/assets/icon-only.png.
// Запуск: node .agent/tasks/mobile-apps-2026-09/e2e/feature-graphic.mjs
import { chromium } from "file:///D:/www/Wesetup.ru/node_modules/playwright/index.mjs";
import sharp from "file:///D:/wt/mobile-apps/mobile/node_modules/sharp/lib/index.js";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
await p.goto("file:///D:/wt/mobile-apps/.agent/tasks/mobile-apps-2026-09/e2e/feature-graphic.html");
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);
console.log("font", await p.evaluate(() => document.fonts.check("800 92px Manrope")));
const box = await p.evaluate(() => { const r = document.querySelector(".text").getBoundingClientRect(); const h = document.querySelector("h1").getBoundingClientRect(); const q = document.querySelector("p").getBoundingClientRect(); return { h: [h.left, h.top, h.right, h.bottom], p: [q.left, q.top, q.right, q.bottom] }; });
console.log(JSON.stringify(box));
await p.screenshot({ path: "d:/wt/tmp/feature-graphic-raw.png" });
await b.close();
const out = "d:/wt/mobile-apps/docs/mobile/store-graphics/";
await sharp("d:/wt/tmp/feature-graphic-raw.png").flatten({ background: "#0b1024" }).removeAlpha().png().toFile(out + "feature-graphic.png");
await sharp("d:/wt/mobile-apps/mobile/assets/icon-only.png").resize(512, 512).ensureAlpha().png().toFile(out + "icon-512.png");
for (const f of ["feature-graphic.png", "icon-512.png"]) { const m = await sharp(out + f).metadata(); const fs = await import("node:fs"); console.log(f, m.width, m.height, m.channels, m.hasAlpha, fs.statSync(out + f).size); }
