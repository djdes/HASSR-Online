// Полный текст ошибки гидрации на /mini: приложение, приложение без заглушки, обычный браузер.
import fs from "node:fs";
import { chromium } from "playwright";
import { installCapacitorStub, DEFAULT_STUB } from "./bridge-stub";

const BASE = "http://localhost:3022";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 WeSetupApp/1.0.0 (android)";
const PLAIN = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const route = process.env.R ?? "/mini/me";
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [name, ua, stub] of [["app", ANDROID, true], ["app-nostub", ANDROID, false], ["plain", PLAIN, false]] as const) {
    const ctx = await browser.newContext({ storageState: "d:/wt/tmp/sweep/state-ownerA.json", serviceWorkers: "block", userAgent: ua, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    if (stub) await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB });
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(BASE + route, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    console.log("=====", name, errs.length);
    for (const e of errs) console.log(e.slice(0, 3000));
    await ctx.close();
  }
  await browser.close();
})();
