/**
 * Диагностика консоли: полный текст ошибок и предупреждений по страницам
 * (какой атрибут не совпал при гидратации, какой компонент обновил
 * состояние до монтирования).
 * Запуск: MSYS_NO_PATHCONV=1 npx tsx .agent/tasks/custom-names-2026-09/e2e/hydration-probe.ts a|b desktop|mini "/url1,/url2"
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3043";
const setup = JSON.parse(readFileSync(path.resolve(".agent/tasks/custom-names-2026-09/e2e/setup-output.json"), "utf8"));
const who = (process.argv[2] ?? "a") as "a" | "b";
const mini = process.argv[3] === "mini";
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright/chromium-1232/chrome-win64/chrome.exe");

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({
      viewport: mini ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      locale: "ru-RU",
    });
    const login = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: setup[who].email, password: setup.password },
      timeout: 240_000,
    });
    if (!login.ok()) throw new Error(`login ${login.status()}`);
    if (mini) await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    const page = await ctx.newPage();
    let current = "";
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") {
        console.log(`\n=== ${m.type()} ${current}\n${m.text().slice(0, 5000)}`);
      }
    });
    page.on("pageerror", (e) => console.log(`\n=== PAGEERROR ${current}\n${e.stack ?? e.message}`));
    const pages = (process.argv[4] ?? "/journals").split(",");
    for (const url of pages) {
      current = url;
      await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(3000);
      console.log(`visited ${url}`);
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
