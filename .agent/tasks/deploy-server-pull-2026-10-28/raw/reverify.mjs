// Перепроверка в браузере на e2e-базе (порт 3020) после #42 и #43: режим
// точки, «Остальное», подвал памятки, мастер-кабинет, переключатель точки
// на общих страницах и в Mini App. Только e2e-база, не прод.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/deploy-server-pull-2026-10-28/raw/reverify";
mkdirSync(dir, { recursive: true });
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

async function login(email, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/login`, { timeout: T });
  await page.fill("#email", email);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: T });
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

const switcherCount = (page) => page.locator("[data-current-point]").count();

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(name, false, `ошибка: ${String(error.message).split("\n")[0]}`);
  }
}

try {
  const page = await login(seed.manager);

  // ---- Режим точки (#40) после #43 ---------------------------------------
  await step("режим точки", async () => {
    await page.goto(`${base}/journals/points`, { timeout: T });
    await dismissModals(page);
    const caption = (await page.locator('[data-current-point="switch"]').first().innerText()).replace(/\s+/g, " ");
    check("шапка: по умолчанию «Вся организация»", caption.includes("Вся организация"), caption);
    check("«Журналы точек» открыты всей организации", (await page.locator("[data-point-journals-page]").count()) === 1);
    let labels = await menuLabels(page);
    check("меню: есть «Журналы точек» и «Все журналы»", labels.includes("Журналы точек") && labels.includes("Все журналы"), labels.join(" | "));
    await page.screenshot({ path: `${dir}/1-organization.png` });

    await page.locator('[data-current-point="switch"]').first().click();
    await page.getByRole("menuitem", { name: /Точка Б/ }).click();
    await page.locator("[data-point-mode-unavailable]").waitFor({ timeout: 240000 }).catch(() => {});
    check("«Журналы точек» при точке — экран «недоступно»", (await page.locator("[data-point-mode-unavailable]").count()) === 1);
    labels = await menuLabels(page);
    check(
      "меню при точке: без «Журналов точек» и «Всех журналов», есть «Сегодня», «Настройка журналов», наборы",
      !labels.includes("Журналы точек") && !labels.includes("Все журналы") && labels.includes("Сегодня") && labels.some((l) => l.startsWith("Настройка")) && labels.includes("Стандартный набор"),
      labels.join(" | "),
    );
    check("на странице журналов переключатель точки виден (#43 его не прячет)", (await switcherCount(page)) > 0);
    await page.screenshot({ path: `${dir}/2-point-unavailable.png` });

    await page.goto(`${base}/journals`, { timeout: T });
    check("«Все журналы» при точке — экран «недоступно»", (await page.locator("[data-point-mode-unavailable]").count()) === 1);

    await page.goto(`${base}/dashboard`, { timeout: T });
    await page.goto(`${base}/journals/points`, { timeout: T });
    await page.locator("[data-point-mode-back]").click();
    await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 60000 }).catch(() => {});
    check("«Назад» возвращает на прошлую страницу", new URL(page.url()).pathname === "/dashboard", page.url());

    // #43: на главной переключатель скрыт — выбранная точка там ничего не меняет.
    await page.goto(`${base}/home`, { timeout: T });
    check("главная: переключатель точки скрыт (#43)", (await switcherCount(page)) === 0);

    await page.goto(`${base}/journals/points`, { timeout: T });
    await page.locator("[data-point-mode-organization]").click();
    await page.locator("[data-point-journals-page]").waitFor({ timeout: 60000 }).catch(() => {});
    check("«Выбрать всю организацию» открывает «Журналы точек»", (await page.locator("[data-point-journals-page]").count()) === 1);
    await page.screenshot({ path: `${dir}/3-back-to-organization.png` });
  });

  // ---- «Остальное» (#38) ---------------------------------------------------
  await step("«Остальное»", async () => {
    await page.goto(`${base}/more`, { timeout: T });
    const cards = await page.locator("[data-settings-card]").evaluateAll((els) => els.map((el) => el.getAttribute("data-settings-card")));
    const need = ["batches", "losses", "changes", "competencies", "bonuses"];
    check("«Остальное»: карточки партий, потерь, изменений, обучения, премий", need.every((id) => cards.includes(id)), cards.join(", "));
    await page.screenshot({ path: `${dir}/4-more.png`, fullPage: true });
  });

  // ---- Памятка: вверху сайт организации, внизу wesetup.ru (#41, #42) ------
  await step("памятка", async () => {
    await page.goto(`${base}/production-control/documents/posters/hygiene`, { timeout: T });
    await page.locator("[data-print-brand-footer-site]").first().waitFor({ timeout: 120000 });
    const footer = (await page.locator("[data-print-brand-footer-site]").first().innerText()).trim();
    const header = (await page.locator("[data-print-brand-header]").first().innerText()).replace(/\s+/g, " ");
    check("памятка: внизу всегда wesetup.ru", footer === "wesetup.ru", footer);
    check("памятка: в шапке есть адрес сайта", /\S+\.\S+/.test(header), header.slice(0, 160));
    await page.screenshot({ path: `${dir}/5-poster.png` });
  });

  // ---- Мастер-кабинет (#43) ------------------------------------------------
  await step("мастер-кабинет", async () => {
    const response = await page.goto(`${base}/settings/master-cabinet`, { timeout: T });
    check("мастер-кабинет: страница открывается", (response?.status() ?? 0) < 400, String(response?.status()));
    const cards = await page.locator('[data-testid="master-cabinet-card"]').count();
    const errorShown = await page.getByText(/Что-то пошло не так|Application error/).count();
    check("мастер-кабинет: без ошибки на экране", errorShown === 0, `карточек кабинетов: ${cards}`);
    check("мастер-кабинет: переключатель точки скрыт (#43)", (await switcherCount(page)) === 0);
    await page.screenshot({ path: `${dir}/6-master-cabinet.png`, fullPage: true });
  });
  await page.close();

  // ---- Mini App: «Вся организация» в списке точек (#40) ---------------------
  await step("Mini App", async () => {
    const mini = await login(seed.manager, { width: 390, height: 844 });
    await mini.goto(`${base}/mini`, { timeout: T });
    const pressed = mini.locator("button[aria-pressed]");
    await pressed.first().waitFor({ timeout: 180000 });
    const items = await pressed.evaluateAll((els) => els.map((el) => `${el.getAttribute("aria-pressed")}:${el.textContent.trim().replace(/\s+/g, " ")}`));
    check("Mini App: первый пункт — «Вся организация», он выбран", /^true:Вся организация/.test(items[0] ?? ""), items.join(" | "));
    await mini.screenshot({ path: `${dir}/7-mini.png`, fullPage: true });
    await mini.close();
  });

  // ---- Заведующая точки А ------------------------------------------------
  await step("заведующая", async () => {
    const head = await login(seed.head);
    await head.goto(`${base}/dashboard`, { timeout: T });
    await dismissModals(head);
    const labels = await menuLabels(head);
    check("заведующая: без «Журналов точек» и «Всех журналов»", !labels.includes("Журналы точек") && !labels.includes("Все журналы"), labels.join(" | "));
    await head.goto(`${base}/journals/points`, { timeout: T });
    const headCaption = (await head.locator("[data-current-point]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
    check("заведующая: в шапке её точка, «Вся организация» нет", headCaption.includes("Точка А") && !headCaption.includes("Вся организация"), headCaption);
    const status = await head.request.post(`${base}/api/me/active-building`, { data: { buildingId: "organization" } });
    check("заведующей «Вся организация» недоступна в API", status.status() === 403 || status.status() === 400, String(status.status()));
    await head.screenshot({ path: `${dir}/8-head-chef.png` });
    await head.close();
  });
} catch (error) {
  out.push(`ОШИБКА: ${String(error.message).split("\n")[0]}`);
} finally {
  await browser.close();
  writeFileSync(`${dir}/result.txt`, out.join("\n") + "\n");
}
