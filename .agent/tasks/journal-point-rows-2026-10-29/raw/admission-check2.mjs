// Шаг 2: выбрать «Руководитель проверки» в «Кто заполняет» и открыть «Допуск сотрудников».
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/journal-point-rows-2026-10-29/raw";
const token = JSON.parse(readFileSync(`${dir}/point-token.json`, "utf8"));
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => { const l = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`; out.push(l); console.log(l); };
const T = 420000;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.setDefaultTimeout(T);
  await page.goto(`${base}/login`, { timeout: T });
  await page.fill("#email", seed.manager);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: T });
  await page.goto(`${base}${token.hygieneUrl}`, { timeout: T });
  await page.getByText("Руководитель проверки").first().click();
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  let text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("после выбора:", text.slice(0, 160));
  const pin = page.locator('#qp-pin').first();
  if (await pin.count()) {
    await pin.fill("2468");
    await Promise.all([page.waitForNavigation({ timeout: 120000 }).catch(() => {}), page.locator("#qp-pin").evaluate((el) => el.form.requestSubmit())]);
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
    text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    console.log("после PIN:", text.slice(0, 160));
  }
  const tab = page.getByText(/Допуск сотрудников/).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  }
  text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  writeFileSync(`${dir}/admission-page.txt`, text);
  await page.screenshot({ path: `${dir}/admission-point-a.png`, fullPage: true });
  const onTab = /не отметил|ждут допуска|допущено/i.test(text);
  check("вкладка «Допуск сотрудников» открыта", onTab, text.slice(0, 200));
  if (onTab) {
    check("в допуске сотрудник точки А", text.includes("Сотрудник точки А"));
    check("в допуске сотрудник всех точек", text.includes("Сотрудник всех точек"));
    check("в допуске НЕТ сотрудника точки Б", !text.includes("Сотрудник точки Б"));
    const counters = text.match(/ждут допуска \d+|не отметил\S* \d+|допущено \d+/gi) ?? [];
    check("счётчики по точке", counters.length > 0, counters.join(", "));
  }
} catch (error) {
  out.push(`ОШИБКА: ${String(error.message).split("\n")[0]}`); console.log(out[out.length - 1]);
} finally {
  await browser.close();
  writeFileSync(`${dir}/admission-check.txt`, out.join("\n") + "\n");
}
