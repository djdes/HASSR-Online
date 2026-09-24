// Одноразовый скрипт: скриншоты QR-блока wesetup.ru (до правок).
// Chromium из %LOCALAPPDATA%\ms-playwright, headless, без MCP-мусора.
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";

const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const outDir = process.argv[2];
const baseUrl = process.argv[3] || "https://wesetup.ru";
const prefix = process.argv[4] || "before";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });

async function shoot(width, height, name, opts = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(baseUrl + "/#qr", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("[data-qr-player]", { timeout: 30000 });
  // Пауза ролика на осмысленном кадре, чтобы кадр был детерминированным
  await page.evaluate((frame) => {
    const el = document.querySelector("[data-qr-player]");
    if (el) el.scrollIntoView({ block: "center" });
  }, 0);
  await page.waitForTimeout(1500);
  const section = page.locator("#qr");
  await section.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
  if (opts.full) {
    await page.screenshot({ path: path.join(outDir, `${name}-${width}-viewport.png`) });
  }
  await page.close();
}

await shoot(390, 844, `${prefix}-qr-mobile`, { full: true });
await shoot(1440, 900, `${prefix}-qr-desktop`);
await browser.close();
console.log("done →", outDir);
