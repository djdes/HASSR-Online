import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = "http://localhost:3000";
const browser = await chromium.launch();
let jumps = 0;
for (let run = 0; run < 4; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const reqs = [];
  page.on("request", (r) => { if (r.method() !== "GET" || r.url().includes("_rsc") || r.headers()["rsc"]) reqs.push(`${r.method()} ${r.url().replace(BASE, "").slice(0, 70)} rsc=${r.headers()["rsc"] ?? ""} next-url=${r.headers()["next-url"] ?? ""}`); });
  await page.goto(`${BASE}/login`); await page.waitForLoadState("load"); await page.waitForTimeout(1500);
  await page.fill("#email", "admin@haccp.local"); await page.fill("#password", "admin1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator('[data-ppk-item="2-6"]').scrollIntoViewIfNeeded();
  await page.mouse.move(700, 500); await page.mouse.wheel(0, 200); await page.waitForTimeout(500);
  reqs.length = 0;
  const before = await page.evaluate(() => Math.round(scrollY));
  await page.evaluate(() => {
    window.__f = [];
    const t = () => {
      const area = document.querySelector("[data-page-area]");
      window.__f.push(`${Math.round(scrollY)}:${document.documentElement.scrollHeight}:${document.querySelector("[data-ppk-overview]") ? "OV" : "noOV"}:pulse${document.querySelectorAll(".animate-pulse").length}:${area ? area.className : "noarea"}:${document.querySelector("[data-ppk-item-dialog]") ? "dlg" : "-"}:${location.pathname.slice(-6)}`);
      if (window.__f.length < 120) requestAnimationFrame(t);
    };
    requestAnimationFrame(t);
  });
  await page.click('[data-ppk-item="2-6"]');
  await page.waitForSelector("[data-ppk-item-dialog]");
  await page.waitForTimeout(1500);
  const f = await page.evaluate(() => window.__f);
  const after = await page.evaluate(() => Math.round(scrollY));
  const jumped = after < before - 5;
  if (jumped) jumps++;
  const firstBad = f.findIndex((x) => Number(x.split(":")[0]) < before - 5);
  console.log(`run ${run}: before=${before} after=${after} ${jumped ? "JUMP" : "ok"}`);
  if (jumped) console.log("  frames:", f.slice(Math.max(0, firstBad - 2), firstBad + 4).join("  "));
  console.log("  reqs:", reqs.join(" || "));
  await ctx.close();
}
console.log("jumps:", jumps, "/ 4");
await browser.close();
