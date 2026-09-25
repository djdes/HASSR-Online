/* eslint-disable no-console */
// Ошибки консоли на главной (390): что за «1 Issue» у dev-индикатора Next.
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3040";
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(-1500)}`); });
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await p.goto(`${BASE}/login`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(1500);
  await p.fill("#email", "e2e-nav@wesetup.local"); await p.fill("#password", "E2e-Nav-2026!");
  await p.click('button[type="submit"]'); await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  errors.length = 0;
  await p.goto(`${BASE}/dashboard`); await p.waitForTimeout(6000);
  console.log(JSON.stringify(errors, null, 1));
  await b.close();
})();
