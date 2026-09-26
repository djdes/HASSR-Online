// Снимок одной страницы в приложении (Android 360) вверху и после прокрутки вниз.
// Env: R=/path ROLE=ownerA TAG=name DARK=1 BOTTOM=1
import { chromium } from "playwright";
import { installCapacitorStub, DEFAULT_STUB } from "./bridge-stub";

const BASE = "http://localhost:3022";
const UA = process.env.PLAIN
  ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
  : "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 WeSetupApp/1.0.0 (android)";
(async () => {
  const browser = await chromium.launch({ headless: true });
  const role = process.env.ROLE ?? "ownerA";
  const ctx = await browser.newContext({
    storageState: role === "anon" ? undefined : `d:/wt/tmp/sweep/state-${role}.json`,
    serviceWorkers: "block", userAgent: UA, viewport: { width: Number(process.env.W ?? 360), height: 740 },
    isMobile: true, hasTouch: true, colorScheme: process.env.DARK ? "dark" : "light",
  });
  await ctx.addInitScript("window.__name=window.__name||function(f){return f};try{localStorage.setItem('wesetup.last-seen-build-sha','zzz');localStorage.setItem('wesetup.mini.tour.seen','1')}catch(e){};document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})");
  if (!process.env.PLAIN) await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB, permission: "denied", topInset: 44 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 300)));
  await page.goto(BASE + (process.env.R ?? "/mini"), { waitUntil: "load", timeout: 240000 });
  await page.waitForTimeout(2500);
  const tag = process.env.TAG ?? "shot";
  await page.screenshot({ path: `d:/wt/tmp/sweep/${tag}-top.png` });
  if (process.env.BOTTOM) {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `d:/wt/tmp/sweep/${tag}-bottom.png` });
  }
  if (process.env.EVAL) console.log(await page.evaluate(process.env.EVAL));
  await browser.close();
})();
