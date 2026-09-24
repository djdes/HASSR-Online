import { chromium } from "playwright-core";
import path from "node:path";
const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:3020/", { waitUntil: "networkidle", timeout: 90000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: "D:/www/Wesetup.ru/.agent/tasks/landing-text-pass-2026-09/shots/after-hero-1440.png" });
await browser.close();
