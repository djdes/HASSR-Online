// Страница приглашения: принять, когда места заняты — текст по следующему тарифу (AC2).
// Токены — invite-tokens.ts create (файл «email токен» в INVITES). Запуск вне репозитория:
//   INVITES=... OUT_DIR=... node invite-check.cjs
const fs = require("fs");
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const rows = fs.readFileSync(process.env.INVITES, "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/));
(async () => {
  const browser = await chromium.launch();
  for (const [owner, raw] of rows) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 250) + 1}` } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/invite/${raw}`, { waitUntil: "networkidle", timeout: 180000 });
    await page.fill("#password", "InvitePass123!");
    await page.fill("#confirm", "InvitePass123!");
    await page.locator('form button[type="submit"]').click();
    const alert = page.locator('form [role="alert"]');
    await alert.waitFor({ timeout: 30000 });
    console.log(`-- ${owner}: «${(await alert.innerText()).replace(/\s+/g, " ").trim()}»`);
    if (owner.startsWith("lim-prem")) await page.screenshot({ path: `${process.env.OUT_DIR}/invite-premium.png` });
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
