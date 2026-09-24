import { chromium } from "playwright-core";
import path from "node:path";
const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });
const r = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
await r.goto("http://localhost:3020/#qr", { waitUntil: "networkidle", timeout: 60000 });
await r.waitForSelector("[data-qr-player]");
await r.waitForTimeout(5000);
const rm = await r.evaluate(() => {
  const player = document.querySelector("[data-qr-player]");
  return {
    mq: matchMedia("(prefers-reduced-motion: reduce)").matches,
    frame: player?.getAttribute("data-frame"),
    playing: player?.getAttribute("data-playing"),
    text: player?.querySelector("p")?.textContent?.slice(0, 70),
  };
});
console.log(JSON.stringify(rm));
await r.locator("#qr").screenshot({ path: "D:/www/Wesetup.ru/.agent/tasks/qr-player-simplify-2026-09/shots/check-reduced2-390.png" });
await browser.close();
