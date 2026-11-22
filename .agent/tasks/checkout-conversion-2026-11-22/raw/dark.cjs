// Тёмная тема /order (системная схема устройства): гость, способ «счёт».
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark", locale: "ru-RU" });
  // Тема публичных страниц — из выбора в меню (localStorage), как у человека, выбравшего «Тёмная».
  await context.addInitScript(() => {
    localStorage.setItem("wesetup-theme-mode", "dark");
    localStorage.setItem("wesetup-app-theme", "dark");
  });
  const page = await context.newPage();
  await page.goto("http://localhost:3000/order?plan=premium&cycle=year&points=1", { waitUntil: "networkidle", timeout: 180_000 });
  const ok = page.getByRole("button", { name: "OK", exact: true });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  const theme = await page.evaluate(() => document.body.getAttribute("data-app-theme"));
  await page.screenshot({ path: path.join(__dirname, "shots", "07-dark-card.png"), fullPage: true });
  await page.getByTestId("order-method").click();
  await page.getByRole("option", { name: /Счёт для юрлица/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, "shots", "08-dark-invoice.png"), fullPage: true });
  console.log("data-app-theme", theme);
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
