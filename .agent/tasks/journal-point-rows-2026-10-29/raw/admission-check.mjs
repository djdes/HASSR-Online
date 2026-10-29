// QR «Все журналы» точки А → гигиена → «Допуск сотрудников» (e2e-база, порт 3020).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/journal-point-rows-2026-10-29/raw";
const token = JSON.parse(readFileSync(`${dir}/point-token.json`, "utf8"));
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};
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

  await page.goto(`${base}${token.hygieneUrl}&view=all`, { timeout: T });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: `${dir}/admission-point-a.png`, fullPage: true });
  writeFileSync(`${dir}/admission-page.txt`, text);
  const has = (name) => text.includes(name);
  check("открыт «Допуск сотрудников»", /Допуск|допуск/.test(text), text.slice(0, 160));
  check("в списке сотрудник точки А", has("Сотрудник точки А"));
  check("в списке заведующая точки А", has("Заведующая точки А"));
  check("в списке сотрудник всех точек (без точки — везде)", has("Сотрудник всех точек"));
  check("НЕТ сотрудника точки Б", !has("Сотрудник точки Б"));
} catch (error) {
  out.push(`ОШИБКА: ${String(error.message).split("\n")[0]}`);
  console.log(out[out.length - 1]);
} finally {
  await browser.close();
  writeFileSync(`${dir}/admission-check.txt`, out.join("\n") + "\n");
}
