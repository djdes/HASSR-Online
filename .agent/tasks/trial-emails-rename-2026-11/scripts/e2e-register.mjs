// Мгновенная регистрация через форму /register: письмо с паролем, затем приветственное.
import { chromium } from "playwright";
const email = process.argv[2];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const p = await b.newPage();
await p.goto("http://localhost:3000/register", { waitUntil: "networkidle", timeout: 180000 });
await p.waitForTimeout(2500);
await p.fill('input[type="email"]', email);
for (const box of await p.locator('input[type="checkbox"]').all()) if (!(await box.isChecked())) await box.check().catch(() => {});
await p.waitForTimeout(1500);
const resp = p.waitForResponse((r) => r.url().includes("/api/auth/instant-register"), { timeout: 60000 });
await p.click('button[type="submit"]');
const r = await resp;
console.log("instant-register", r.status(), JSON.stringify(await r.json().catch(() => null)).slice(0, 160));
await p.waitForTimeout(8000);
await b.close();
