// Детерминированные кадры сцены: пауза → seek скраббером → скрин сцены.
// Работает через DOM-контракт хрома (кнопка паузы + .qrp-range), одинаково
// для старого и нового движка. argv: <prefix> [baseUrl]
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";

const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const out = "D:/www/Wesetup.ru/.agent/tasks/qr-player-remotion-2026-09/shots";
const prefix = process.argv[2] || "before";
const baseUrl = process.argv[3] || "http://localhost:3020";
const FRAMES = [90, 990];
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });

async function run(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(baseUrl + "/#qr", { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector("[data-qr-player]");
  await page.waitForTimeout(2500); // гидрация + (для нового движка) маунт Плеера

  // Детерминированно: дождаться автоплея (иначе пауза «в пустоту» и
  // поздний автоплей уезжает кадром во время скриншота), поставить на
  // паузу, убедиться, что кадр стоит, и только потом снимать.
  await page.waitForFunction(() => document.querySelector("[data-qr-player]")?.getAttribute("data-playing") === "1", null, { timeout: 20000 });
  await page.evaluate(() => document.querySelector('button[aria-label="Пауза"]')?.click());
  await page.waitForFunction(() => document.querySelector("[data-qr-player]")?.getAttribute("data-playing") === "0", null, { timeout: 5000 });

  for (const frame of FRAMES) {
    await page.evaluate((target) => {
      const input = document.querySelector("input.qrp-range:not(.qrp-range-try)");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, String(target));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, frame);
    await page.waitForFunction(
      (target) => document.querySelector("[data-qr-player]")?.getAttribute("data-frame") === String(target),
      frame,
      { timeout: 5000 }
    );
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      const root = document.querySelector("[data-qr-player]");
      return { shown: root?.getAttribute("data-frame"), playing: root?.getAttribute("data-playing") };
    });
    console.log(JSON.stringify({ tag, requested: frame, ...state }));
    await page.locator("[data-qr-stage]").screenshot({ path: path.join(out, `${prefix}-${tag}-f${frame}.png`) });
  }
  await page.close();
}

await run(390, 844, "mobile");
await run(1440, 900, "desktop");
await browser.close();
console.log("done");
