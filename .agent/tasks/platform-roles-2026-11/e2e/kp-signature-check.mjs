// КП коммерческого директора: подпись в письме и веб-версии (next dev :3000).
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill('input[placeholder="name@company.com"]', "alexey@wesetup.ru");
await page.fill('input[type="password"]', "LocalUser-2026!");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
await page.goto("http://localhost:3000/root/proposals", { waitUntil: "networkidle" });
const sender = { name: await page.inputValue('[data-testid="kp-sender-name"]'), position: await page.inputValue('[data-testid="kp-sender-position"]') };
const result = await page.evaluate(async (s) => {
  const response = await fetch("/api/root/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sphere: "restaurant", companyName: "Кафе «Ромашка»", sender: s }) });
  const data = await response.json();
  const web = data.webUrl ? await (await fetch(data.webUrl)).text() : "";
  return { status: response.status, emailHas: JSON.stringify(data.email ?? "").includes("Коммерческий директор"), webHas: web.includes("Коммерческий директор"), webUrl: Boolean(data.webUrl), contentHas: JSON.stringify(data.content ?? "").includes("Коммерческий директор") };
}, sender);
console.log("sender", JSON.stringify(sender));
console.log("preview", JSON.stringify(result));
await browser.close();
