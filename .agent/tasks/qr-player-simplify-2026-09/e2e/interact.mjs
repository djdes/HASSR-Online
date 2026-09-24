// Интерактивная проверка: спойлер «Попробуйте сами», клик по вкладке,
// reduced-motion раскадровка.
import { chromium } from "playwright-core";
import path from "node:path";

const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const out = "D:/www/Wesetup.ru/.agent/tasks/qr-player-simplify-2026-09/shots";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });

// 1) Мобайл: раскрыть спойлер, подвигать слайдер холодильника.
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.goto("http://localhost:3020/#qr", { waitUntil: "networkidle", timeout: 60000 });
await m.waitForSelector("[data-qr-player]");
await m.getByRole("button", { name: "Попробуйте сами" }).click();
await m.locator("#qrp-try-fridge").waitFor({ state: "visible" });
await m.locator("#qrp-try-fridge").fill("8");
await m.waitForTimeout(600);
const openState = await m.evaluate(() => {
  const btn = document.querySelector('[aria-controls="qrp-try-panel"]');
  const p = document.querySelector("#qrp-try-panel");
  const player = document.querySelector("[data-qr-player]");
  return {
    expanded: btn?.getAttribute("aria-expanded"),
    panelVisible: p && getComputedStyle(p).display !== "none",
    frame: player?.getAttribute("data-frame"),
    playing: player?.getAttribute("data-playing"),
  };
});
console.log("try-open:", JSON.stringify(openState));
await m.locator("#qr").screenshot({ path: path.join(out, "check-try-open-390.png") });

// 2) Клик по вкладке «Фритюр» — переход к главе 4.
await m.getByRole("button", { name: /4\s*Фритюр/ }).click();
await m.waitForTimeout(400);
const tabState = await m.evaluate(() => {
  const player = document.querySelector("[data-qr-player]");
  const strip = document.querySelector(".qrp-tabs");
  return { frame: player?.getAttribute("data-frame"), scrollLeft: Math.round(strip?.scrollLeft ?? -1) };
});
console.log("tab-4:", JSON.stringify(tabState));
await m.close();

// 3) Reduced motion: раскадровка, полный caption виден.
const r = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
await r.goto("http://localhost:3020/#qr", { waitUntil: "networkidle", timeout: 60000 });
await r.waitForSelector("[data-qr-player]");
await r.waitForTimeout(1200);
const rm = await r.evaluate(() => {
  const player = document.querySelector("[data-qr-player]");
  return { frame: player?.getAttribute("data-frame"), playing: player?.getAttribute("data-playing"), text: player?.querySelector("p")?.textContent?.slice(0, 60) };
});
console.log("reduced:", JSON.stringify(rm));
await r.locator("#qr").screenshot({ path: path.join(out, "check-reduced-390.png") });
await r.close();

await browser.close();
console.log("done");
