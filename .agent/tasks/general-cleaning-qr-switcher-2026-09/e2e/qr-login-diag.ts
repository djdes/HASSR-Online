import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
  const res = await page.goto("http://localhost:3020/login", { waitUntil: "load", timeout: 240_000 });
  console.log("status", res?.status(), page.url());
  await page.waitForTimeout(8000);
  console.log("email count", await page.locator("#email").count());
  console.log((await page.locator("body").innerText()).slice(0, 600));
  await page.screenshot({ path: "D:/www/Wesetup.ru/.agent/tasks/general-cleaning-qr-switcher-2026-09/shots/qr-diag-login.png" });
  await browser.close();
})();
