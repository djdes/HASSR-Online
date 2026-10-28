// Mini App после правки: «Сегодня» в оболочке без ключей сообщений и
// «Вся организация» в верхней панели (e2e-база, порт 3020). В обычном
// браузере /mini уводит на /dashboard в оболочке приложения.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/deploy-server-pull-2026-10-28/raw/reverify";
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });

async function login(email) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/login`, { timeout: 420000 });
  await page.fill("#email", email);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 420000 });
  return page;
}

async function shellText(page) {
  await page.goto(`${base}/mini`, { timeout: 420000 });
  await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 120000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

try {
  // Руководитель на «Вся организация» (её выбрал прошлый прогон).
  const manager = await login(seed.manager);
  const text = await shellText(manager);
  const keys = text.match(/\b(?:dashboardUi|cleaningUi)\.[\w.]+/g) ?? [];
  check("«Сегодня» в оболочке Mini App: нет ключей вместо подписей", keys.length === 0, keys.slice(0, 3).join(", "));
  check("верхняя панель: «Вся организация»", /WESETUP · ВСЯ ОРГАНИЗАЦИЯ|WeSetup · Вся организация/i.test(text), text.slice(0, 80));
  await manager.screenshot({ path: `${dir}/9-mini-manager.png` });
  await manager.close();

  // Заведующая точки А — её точка.
  const head = await login(seed.head);
  const headText = await shellText(head);
  check("заведующая в Mini App: в панели её точка", /· ТОЧКА А|· Точка А/i.test(headText), headText.slice(0, 80));
  const headKeys = headText.match(/\b(?:dashboardUi|cleaningUi)\.[\w.]+/g) ?? [];
  check("заведующая: нет ключей вместо подписей", headKeys.length === 0, headKeys.slice(0, 3).join(", "));
  await head.screenshot({ path: `${dir}/10-mini-head.png` });
  await head.close();
} catch (error) {
  out.push(`ОШИБКА: ${String(error.message).split("\n")[0]}`);
} finally {
  await browser.close();
  writeFileSync(`${dir}/check-mini.txt`, out.join("\n") + "\n");
}
