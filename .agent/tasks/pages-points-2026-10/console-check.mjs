// Ошибки консоли браузера на страницах раздела (руководитель, 1440 и Mini App 390).
import { chromium } from "playwright";
const BASE = process.argv[2] || "http://localhost:3072";
const browser = await chromium.launch({ channel: "chrome" });
const out = [];
for (const mini of [false, true]) {
  const context = await browser.newContext(mini ? { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") out.push(`${mini ? "mini" : "site"} ${page.url().replace(BASE, "")} [${m.type()}] ${m.text().slice(0, 4000)}`); });
  page.on("pageerror", (e) => out.push(`${mini ? "mini" : "site"} ${page.url().replace(BASE, "")} [pageerror] ${e.message.slice(0, 300)}`));
  await page.request.post(`${BASE}/api/auth/login`, { data: { email: "admin@haccp.local", password: "admin1234" } });
  if (mini) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  for (const href of (process.argv[3] ? process.argv[3].split(",") : ["/settings/buildings/fx-building-mira", "/settings/buildings/new", "/settings/buildings"])) {
    await new Promise((r) => setTimeout(r, 3000));
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await context.close();
}
await browser.close();
console.log(out.join("\n") || "нет ошибок консоли");
