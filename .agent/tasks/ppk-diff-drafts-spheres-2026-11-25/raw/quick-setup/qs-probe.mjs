// Быстрая настройка на свежей организации: что видно после «Применить» (результат или снова шаг 1).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
const page = await context.newPage();
const log = [];
const t0 = Date.now();
const mark = (m) => log.push(`${String(Date.now() - t0).padStart(6)} ms  ${m}`);
page.on("framenavigated", (f) => { if (f === page.mainFrame()) mark(`navigated ${f.url().replace(BASE, "")}`); });
page.on("request", (r) => { const u = r.url().replace(BASE, ""); if (/onboarding-template|active-building/.test(u)) mark(`→ ${r.method()} ${u} ${r.headers()["rsc"] ? "(RSC)" : ""}`); });
page.on("response", (r) => { const u = r.url().replace(BASE, ""); if (/onboarding-template|active-building/.test(u)) mark(`← ${r.status()} ${u}`); });
await page.goto(`${BASE}/login`, { waitUntil: "load" });
await page.fill("#email", data.email);
await page.fill("#password", data.password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.locator('button[type="submit"]').first().click()]);
await page.goto(`${BASE}/settings/onboarding-template`, { waitUntil: "networkidle", timeout: 180000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.getByTestId("quick-setup-kind-cafe-small").click();
  if (await page.getByTestId("quick-setup-questions").isVisible().catch(() => false)) break;
  await page.waitForTimeout(1000);
}
await page.getByTestId("quick-setup-questions").waitFor({ timeout: 30000 });
await page.evaluate(() => {
  window.__qs = [];
  const obs = () => window.__qs.push([Math.round(performance.now()), !!document.querySelector('[data-testid="quick-setup-result"]'), !!document.querySelector('[data-testid="quick-setup-questions"]'), !!document.querySelector('[data-testid="quick-setup-kind-cafe-small"]')]);
  new MutationObserver(obs).observe(document.body, { subtree: true, childList: true });
});
mark("click apply");
await page.getByTestId("quick-setup-apply").click();
await page.waitForTimeout(6000);
const states = await page.evaluate(() => window.__qs);
// Сжать: только смены состояния.
let prev = "";
for (const [t, result, questions, kinds] of states) {
  const s = `result=${result} questions=${questions} kindPicker=${kinds}`;
  if (s !== prev) { log.push(`  dom@${t}  ${s}`); prev = s; }
}
const final = await page.evaluate(() => ({ result: !!document.querySelector('[data-testid="quick-setup-result"]'), kinds: !!document.querySelector('[data-testid="quick-setup-kind-cafe-small"]'), header: document.querySelector("header")?.innerText.replace(/\s+/g, " ").slice(0, 120) }));
log.push(`final: ${JSON.stringify(final)}`);
console.log(log.join("\n"));
await browser.close();
