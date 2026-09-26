// Разведка: meta viewport на /mini/me в приложении (сколько их и что внутри).
import { chromium } from "playwright";
import { BASE, PASSWORD } from "./server-db";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: process.env.NOSW ? "block" : "allow", userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile WeSetupApp/1.0.0 (android)" });
  const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()) as { csrfToken: string };
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email: "manager-a@e2e.local", password: PASSWORD, json: "true" }, maxRedirects: 0 });
  const html = await (await ctx.request.get(`${BASE}/mini/me`)).text();
  console.log("ssr", html.match(/<meta name="viewport"[^>]*>/g));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  console.log("dash", await page.$$eval('meta[name="viewport"]', (els) => els.map((e) => e.getAttribute("content"))));
  await page.goto(`${BASE}/mini/me`, { waitUntil: "load" });
  console.log("at load", await page.$$eval('meta[name="viewport"]', (els) => els.map((e) => e.getAttribute("content"))));
  await page.waitForTimeout(3000);
  console.log("dom", await page.$$eval('meta[name="viewport"]', (els) => els.map((e) => e.getAttribute("content"))));
  await b.close();
})();
