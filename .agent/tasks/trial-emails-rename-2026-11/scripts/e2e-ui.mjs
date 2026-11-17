// Страница ответа на отзыв и ручная отправка служебных писем в /root.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [link, org, out] = process.argv.slice(2);
const res = {};
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const phone = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(link, { waitUntil: "networkidle", timeout: 180000 });
res.preset = await phone.locator('[data-testid="trial-feedback-help"]').isChecked();
await phone.fill('[data-testid="trial-feedback-comment"]', "Не разобрались, как распечатать QR для холодильника");
await phone.screenshot({ path: `${out}/feedback-page.png`, fullPage: true });
await phone.click('[data-testid="trial-feedback-submit"]');
await phone.locator('[data-testid="trial-feedback-done"]').waitFor({ timeout: 30000 });
res.done = await phone.locator('[data-testid="trial-feedback-done"]').innerText();
await phone.screenshot({ path: `${out}/feedback-done.png` });
await phone.goto(link.replace(/t=[^&]+/, "t=broken.token"), { waitUntil: "networkidle" });
res.invalid = await phone.locator("h1").innerText();

const page = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 120000 });
await page.fill('input[type="email"], input[name="email"]', "e2e-root@example.test");
await page.fill('input[type="password"]', "e2e-root-pass");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.keyboard.press("Enter")]);
await page.goto(`http://localhost:3000/root/organizations/${org}`, { waitUntil: "networkidle", timeout: 180000 });
const card = page.locator('[data-testid="service-emails"]');
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: `${out}/service-emails-card.png` });
page.on("dialog", (d) => d.accept());
res.manual = {};
for (const kind of ["welcome", "trial_reminder", "trial_feedback"]) {
  const resp = page.waitForResponse((r) => r.url().includes("/service-emails"));
  await card.locator(`[data-testid="service-email-${kind}"]`).click();
  const r = await resp;
  res.manual[kind] = { status: r.status(), body: await r.json() };
  await page.waitForTimeout(800);
}
console.log(JSON.stringify(res, null, 1));
await b.close();
