// Проход по ключевым страницам собранного сайта (как шаги обновления пакетов 2026-11-10):
// код ответа, экран ошибки, JS-ошибки и ошибки гидратации. Вывод — TSV.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "pagepass.tsv";
const env = Object.fromEntries(
  fs.readFileSync("/home/user/HASSR-Online/.env", "utf8").split("\n")
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"(.*)"$/, "$1")]),
);
const GROUPS = {
  public: ["/", "/login", "/register", "/pricing", "/features", "/journals-info", "/journals-info/cleaning", "/blog", "/oferta",
    "/order?plan=standard&cycle=month&points=1", "/dlya-kafe", "/zhurnal-uborki", "/compare", "/kp", "/partners", "/status",
    "/api/health", "/api/build-info", "/sitemap.xml", "/robots.txt"],
  owner: ["/dashboard", "/journals", "/journals/hygiene", "/journals/cleaning", "/dashboard/journals-memo", "/settings",
    "/settings/subscription", "/settings/balance", "/settings/users", "/settings/journals", "/staff", "/reports", "/batches",
    "/capa", "/plans", "/sanpin", "/knowledge", "/production-control", "/production-control/revisions"],
  root: ["/root", "/root/crm", "/root/tariffs", "/root/team", "/root/feedback", "/root/status", "/root/seo", "/root/translations"],
};
const ACCOUNTS = { owner: ["admin@haccp.local", "admin1234"], root: [env.ROOT_EMAIL, env.ROOT_PASSWORD] };
const rows = [];
const browser = await chromium.launch();
for (const [group, paths] of Object.entries(GROUPS)) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && /hydrat|didn't match/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  if (ACCOUNTS[group]) {
    const [email, password] = ACCOUNTS[group];
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 30000 });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  }
  for (const path of paths) {
    errors.length = 0;
    let status = 0;
    let finalPath = "";
    let errorScreen = false;
    try {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 120000 });
      status = response?.status() ?? 0;
      finalPath = new URL(page.url()).pathname;
      await page.waitForTimeout(1200);
      const text = (await page.locator("body").innerText().catch(() => "")) || "";
      errorScreen = /Что-то пошло не так|Application error|Internal Server Error/i.test(text);
    } catch (error) {
      errors.push(`goto: ${String(error).slice(0, 160)}`);
    }
    const row = [group, path, status, finalPath, errorScreen ? "ERROR-SCREEN" : "", errors.length, errors.join(" | ").replace(/\s+/g, " ").slice(0, 300)];
    rows.push(row);
    console.log(row.slice(0, 6).join("\t"));
  }
  await context.close();
}
await browser.close();
fs.writeFileSync(OUT, rows.map((r) => r.join("\t")).join("\n") + "\n");
const bad = rows.filter((r) => (r[2] !== 200 && !(r[1] === "/kp" && r[2] === 404)) || r[4] || r[5] > 0);
console.log(bad.length ? `PAGEPASS: ${bad.length} problem page(s)` : `PAGEPASS: all ${rows.length} pages ok`);
