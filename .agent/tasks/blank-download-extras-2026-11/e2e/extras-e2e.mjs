// E2E окна скачивания (спека blank-download-extras-2026-11): две галки,
// почта без «прыжков», «Дополнительно», быстрая регистрация с сотрудниками.
// Запуск: BASE=http://localhost:3000 OUT=<dir> node extras-e2e.mjs <email>
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || ".";
const email = process.argv[2] || `e2e-${Date.now()}@gmail.com`;
const result = { email };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, timezoneId: "Asia/Yekaterinburg" });
await page.goto(`${BASE}/journals-info/hygiene`, { waitUntil: "networkidle", timeout: 120000 });
const trigger = page.locator('[data-testid="blank-download-docx"]').first();
await trigger.click();
const dialog = page.locator('[data-testid="blank-download-dialog"]');
await dialog.waitFor();
await page.waitForTimeout(500);
await dialog.screenshot({ path: `${OUT}/1-form.png` });
result.checkboxes = await dialog.locator('input[type="checkbox"]').count();
result.marketingPresent = await dialog.locator('[data-testid="blank-download-marketing"]').count();
result.registerChecked = await dialog.locator('[data-testid="blank-download-register"]').isChecked();

// Печатаем по символу и меряем высоту окна на каждом шаге.
const heights = new Set();
const input = dialog.locator("#blank-download-email");
for (const ch of "bugdenes@gmail.co") {
  await input.type(ch, { delay: 20 });
  heights.add(Math.round((await dialog.boundingBox()).height));
}
await page.waitForTimeout(900);
heights.add(Math.round((await dialog.boundingBox()).height));
result.heightsWhileTyping = [...heights];
result.typoChip = await dialog.locator('[data-testid="blank-download-email-typo"]').innerText().catch(() => null);
await dialog.screenshot({ path: `${OUT}/2-typo.png` });
await dialog.locator('[data-testid="blank-download-email-typo"]').click();
result.emailAfterFix = await input.inputValue();
await input.fill(email);
await page.waitForTimeout(1200);

await dialog.locator('[data-testid="blank-download-extras-toggle"]').click();
await dialog.locator('[data-testid="blank-extras-responsible-name"]').fill("Иванова Мария Петровна");
await dialog.locator('input[aria-label="Ответственный за журнал: Должность"]').fill("Заведующая");
await dialog.locator('[data-testid="blank-extras-employee-0"]').fill("Петров Сергей");
await dialog.getByRole("button", { name: "Добавить сотрудника" }).click();
await dialog.locator('[data-testid="blank-extras-employee-1"]').fill("Сидорова Анна");
await dialog.locator('input[aria-label="Должность 2"]').fill("Повар");
await dialog.screenshot({ path: `${OUT}/3-extras.png` });
result.extrasBadge = await dialog.locator('[data-testid="blank-download-extras-toggle"]').innerText();

await dialog.locator('[data-testid="blank-download-consent"]').check();
const responsePromise = page.waitForResponse((r) => r.url().includes("/api/public/blank-download") && r.request().method() === "POST");
await dialog.locator('[data-testid="blank-download-submit"]').click();
const response = await responsePromise;
result.requestBody = JSON.parse(response.request().postData());
result.response = await response.json();
await page.waitForTimeout(1500);
await dialog.screenshot({ path: `${OUT}/4-done.png` });

// Мобильный вид окна с раскрытым «Дополнительно».
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(`${BASE}/journals-info/cold_equipment_control`, { waitUntil: "networkidle", timeout: 120000 });
await phone.locator('[data-testid="blank-download-pdf"]').first().click();
const d2 = phone.locator('[data-testid="blank-download-dialog"]');
await d2.waitFor();
await d2.locator('[data-testid="blank-download-extras-toggle"]').click();
await d2.locator('[data-testid="blank-extras-equipment-0"]').fill("Холодильник №1");
await phone.waitForTimeout(400);
await phone.screenshot({ path: `${OUT}/5-mobile-cold.png` });
result.mobileScrollWidth = await phone.evaluate(() => document.documentElement.scrollWidth);

fs.writeFileSync(`${OUT}/e2e.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
