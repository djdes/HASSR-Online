// e2e-база (порт 3020), не прод: старые документы точки А после выкладки —
// только своё. Холодильник точки Б и сотрудник точки Б не видны.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/point-document-rows-2026-10-30/raw";
const fx = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
const base = "http://localhost:3020";
const T = 600000;
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(T);
  await page.goto(`${base}/login`, { timeout: T });
  await page.fill("#email", fx.manager);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: T });

  // Холодильники точки А: документ собран со шкафами обеих точек.
  await page.goto(`${base}/journals/cold_equipment_control/documents/${fx.coldId}`, { timeout: T });
  await page.getByText(fx.fridgeA).first().waitFor({ timeout: T });
  const coldText = await page.locator("body").innerText();
  check("холодильники точки А: свой шкаф виден", coldText.includes(fx.fridgeA));
  check("холодильники точки А: шкафа точки Б нет", !coldText.includes(fx.fridgeB));
  check("холодильники точки А: нет подсказки «Пересоздать документы»", !coldText.includes("Пересоздать документы"));
  await page.screenshot({ path: `${dir}/cold-point-a.png`, fullPage: false });

  // Гигиена точки А: строки заведены на сотрудников обеих точек.
  await page.goto(`${base}/journals/hygiene/documents/${fx.hygieneId}`, { timeout: T });
  await page.getByText("Проверка Анна").first().waitFor({ timeout: T });
  const hygieneText = await page.locator("body").innerText();
  check("гигиена точки А: сотрудница точки А видна", hygieneText.includes("Проверка Анна"));
  check("гигиена точки А: сотрудница «Все точки» видна", hygieneText.includes("Проверка Вера"));
  check("гигиена точки А: отметившийся здесь по QR виден", hygieneText.includes("Проверка Глеб"));
  check("гигиена точки А: сотрудника точки Б нет", !hygieneText.includes("Проверка Борис"));
  await page.screenshot({ path: `${dir}/hygiene-point-a.png`, fullPage: false });
} finally {
  await browser.close();
}
writeFileSync(`${dir}/browser-check.txt`, out.join("\n") + "\n");
const failed = out.filter((line) => line.startsWith("FAIL")).length;
console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
process.exit(failed === 0 ? 0 : 1);
