// Карточка клиента в /root: флаг по IP и местное время.
import { chromium } from "playwright";
const [org, out] = process.argv.slice(2);
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 120000 });
await page.fill('input[type="email"], input[name="email"]', "e2e-root@example.test");
await page.fill('input[type="password"]', "e2e-root-pass");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.keyboard.press("Enter")]);
await page.goto(`http://localhost:3000/root/organizations/${org}#security`, { waitUntil: "networkidle", timeout: 180000 });
const section = page.locator("#security");
await section.scrollIntoViewIfNeeded();
await section.screenshot({ path: out });
console.log(JSON.stringify({ geo: await section.locator('[data-testid="ip-geo"]').first().innerText(), localTime: await section.locator('[data-testid="client-local-time"]').innerText() }));
await browser.close();
