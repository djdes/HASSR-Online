// Регрессия вне приложения: браузер телефона и «Telegram» (без приписки WeSetupApp)
// против приложения — отступы шапки, нижнего меню, тостов, публичной шапки,
// QR-шапки и /delete-account. Вне приложения все вырезы должны давать 0 / 12px,
// как до волны 2 (там было env(safe-area-inset-*) = 0 без viewport-fit=cover).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { installCapacitorStub, DEFAULT_STUB } from "./bridge-stub";

process.env.NEXTAUTH_SECRET ||= "e2e-stand-secret";
const BASE = "http://localhost:3022";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const UAS = {
  plain: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  telegram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/11.2",
  app: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 WeSetupApp/1.0.0 (android)",
};
const MEASURE = () => {
  const px = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop) : null);
  const header = document.querySelector("header.mini-topbar");
  const nav = document.querySelector(".mini-nav-rail");
  const main = document.querySelector("#mini-root main");
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;padding-top:var(--mini-safe-t);padding-bottom:var(--mini-safe-b)";
  (document.getElementById("mini-root") || document.body).appendChild(probe);
  const safeT = getComputedStyle(probe).paddingTop;
  const safeB = getComputedStyle(probe).paddingBottom;
  probe.remove();
  const toaster = document.querySelector("[data-sonner-toaster]") as HTMLElement | null;
  const qrHeader = document.querySelector("main > header");
  const pub = document.querySelector(".public-header");
  return {
    path: location.pathname,
    viewportMeta: document.querySelector("meta[name=viewport]")?.getAttribute("content"),
    headerPadTop: px(header, "padding-top"),
    headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
    navBottomGap: nav ? Math.round(window.innerHeight - nav.getBoundingClientRect().bottom) : null,
    mainPadBottom: px(main, "padding-bottom"),
    miniSafeT: safeT,
    miniSafeB: safeB,
    toastOffsetTop: toaster ? toaster.style.getPropertyValue("--offset-top") || toaster.getAttribute("style") : null,
    publicHeaderPadTop: px(pub, "padding-top"),
    qrHeaderPadTop: document.querySelector("#mini-root") ? null : px(qrHeader, "padding-top"),
    firstMainPadTop: document.querySelector("#mini-root") ? null : px(document.querySelector("main"), "padding-top"),
    scrollW: document.documentElement.scrollWidth,
    vw: window.innerWidth,
  };
};
(async () => {
  const { qrFillUrl } = await import("../../../../src/lib/qr-fill-poster");
  const ids = JSON.parse(fs.readFileSync("d:/wt/tmp/sweep/ids.json", "utf8"));
  const routes = ["/mini/me", "/dashboard", ids.docs[0], "/settings/notifications", "/privacy", "/delete-account", qrFillUrl("", "room", ids.room)];
  const browser = await chromium.launch({ headless: true });
  const out: Record<string, unknown>[] = [];
  for (const [name, ua] of Object.entries(UAS)) {
    const ctx = await browser.newContext({
      storageState: "d:/wt/tmp/sweep/state-ownerA.json", serviceWorkers: "block", userAgent: ua,
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript("window.__name=window.__name||function(f){return f};try{localStorage.setItem('wesetup.last-seen-build-sha','zzz')}catch(e){}");
    // «Telegram»: оболочка по куке ws-shell=mini, как после входа из бота.
    if (name === "telegram") await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    if (name === "app") await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB, permission: "denied", topInset: 44 });
    const page = await ctx.newPage();
    for (const r of routes) {
      await page.goto(BASE + r, { waitUntil: "load", timeout: 240000 });
      await page.waitForTimeout(1500);
      let m: Record<string, unknown> = {};
      for (let i = 0; i < 3; i++) {
        try { m = await page.evaluate(MEASURE); break; } catch { await page.waitForTimeout(1500); }
      }
      out.push({ ctx: name, route: r.slice(0, 60), ...m });
      await page.screenshot({ path: `d:/wt/tmp/sweep/regress.${name}.${r.replace(/\W+/g, "_").slice(0, 40)}.png` });
      console.log(name, r.slice(0, 40), JSON.stringify(m));
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(HERE, "sweep-regress.json"), JSON.stringify(out, null, 1));
  await browser.close();
})();
