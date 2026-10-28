// «Журналы» по выбранной точке — проверка в браузере на e2e-базе (порт 3020).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/journals-point-mode-2026-10-28/raw";
const seed = JSON.parse(readFileSync(`${dir}/seed.json`, "utf8"));
const base = "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => out.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });

async function login(email) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/login`, { timeout: 420000 });
  await page.fill("#email", email);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 420000 });
  return page;
}

async function dismissModals(page) {
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible({ timeout: 6000 }).catch(() => false)) {
    await page.locator('input[type="checkbox"]').first().check();
    await terms.click();
    await page.waitForTimeout(1000);
  }
  await page.keyboard.press("Escape");
}

const menuLabels = (page) =>
  page.locator("aside nav a, aside a[href]").evaluateAll((links) => links.map((a) => a.textContent.trim()).filter(Boolean));

try {
  // ---- Руководитель: старт со всей организации -------------------------
  const page = await login(seed.manager);
  await page.goto(`${base}/journals/points`, { timeout: 420000 });
  await dismissModals(page);
  const caption = (await page.locator('[data-current-point="switch"]').first().innerText()).replace(/\s+/g, " ");
  check("шапка: по умолчанию «Вся организация»", caption.includes("Вся организация"), caption);
  check("«Журналы точек» открыты всей организации", (await page.locator("[data-point-journals-page]").count()) === 1);
  let labels = await menuLabels(page);
  check("меню: есть «Журналы точек» и «Все журналы»", labels.includes("Журналы точек") && labels.includes("Все журналы"), labels.join(" | "));
  await page.screenshot({ path: `${dir}/1-organization.png` });

  // ---- Выбор точки в шапке ---------------------------------------------
  await page.locator('[data-current-point="switch"]').first().click();
  await page.getByRole("menuitem", { name: /Точка Б/ }).click();
  // Переключение — запрос и обновление страницы; на dev-сервере небыстро.
  await page.locator("[data-point-mode-unavailable]").waitFor({ timeout: 240000 }).catch(() => {});
  check("«Журналы точек» при точке — экран «недоступно»", (await page.locator("[data-point-mode-unavailable]").count()) === 1);
  labels = await menuLabels(page);
  check(
    "меню при точке: без «Журналов точек» и «Всех журналов», есть «Сегодня», «Настройка журналов», наборы",
    !labels.includes("Журналы точек") && !labels.includes("Все журналы") && labels.includes("Сегодня") && labels.some((l) => l.startsWith("Настройка")) && labels.includes("Стандартный набор"),
    labels.join(" | "),
  );
  await page.screenshot({ path: `${dir}/2-point-unavailable.png` });

  await page.goto(`${base}/journals`, { timeout: 420000 });
  check("«Все журналы» при точке — экран «недоступно»", (await page.locator("[data-point-mode-unavailable]").count()) === 1);

  // «Назад» уводит со страницы.
  await page.goto(`${base}/dashboard`, { timeout: 420000 });
  await page.goto(`${base}/journals/points`, { timeout: 420000 });
  await page.locator("[data-point-mode-back]").click();
  await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 60000 }).catch(() => {});
  check("«Назад» возвращает на прошлую страницу", new URL(page.url()).pathname === "/dashboard", page.url());

  // «Выбрать всю организацию» — страница открывается на месте.
  await page.goto(`${base}/journals/points`, { timeout: 420000 });
  await page.locator("[data-point-mode-organization]").click();
  await page.locator("[data-point-journals-page]").waitFor({ timeout: 60000 }).catch(() => {});
  check("«Выбрать всю организацию» открывает «Журналы точек»", (await page.locator("[data-point-journals-page]").count()) === 1);
  await page.screenshot({ path: `${dir}/3-back-to-organization.png` });
  await page.close();

  // ---- Заведующая точки А ------------------------------------------------
  const head = await login(seed.head);
  await head.goto(`${base}/dashboard`, { timeout: 420000 });
  await dismissModals(head);
  labels = await menuLabels(head);
  check("заведующая: без «Журналов точек» и «Всех журналов»", !labels.includes("Журналы точек") && !labels.includes("Все журналы"), labels.join(" | "));
  const headCaption = (await head.locator("[data-current-point]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check("заведующая: в шапке её точка, «Вся организация» нет", headCaption.includes("Точка А") && !headCaption.includes("Вся организация"), headCaption);
  const status = await head.request.post(`${base}/api/me/active-building`, { data: { buildingId: "organization" } });
  check("заведующей «Вся организация» недоступна в API", status.status() === 403 || status.status() === 400, String(status.status()));
  await head.screenshot({ path: `${dir}/4-head-chef.png` });
} catch (error) {
  out.push(`ОШИБКА: ${error.message.split("\n")[0]}`);
} finally {
  await browser.close();
  writeFileSync(`${dir}/e2e-result.txt`, out.join("\n") + "\n");
  console.log(out.join("\n"));
}
