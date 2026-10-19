// Смоук правок мастер-кабинета (AC1–AC5, AC8) на dev-сервере с локальной wesetup_integ.
// Запуск из корня worktree: node .agent/tasks/master-export-2026-10/smoke.mjs [base]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3082";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
fs.mkdirSync(RAW, { recursive: true });
const report = { base: BASE, at: new Date().toISOString(), checks: {}, problems: [] };
const check = (name, ok, detail = "") => {
  report.checks[name] = { ok, detail };
  if (!ok) report.problems.push(`${name}: ${detail}`);
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

async function launch() {
  for (const root of [path.join(process.env.LOCALAPPDATA || "", "ms-playwright"), "D:/handoff/wesetup-2026-10-18/ms-playwright"]) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const exe = path.join(root, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
  }
  return chromium.launch();
}

async function login(context) {
  const page = await context.newPage();
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email: "master@haccp.local", password: "admin1234" },
    timeout: 600_000,
  });
  if (!res.ok()) throw new Error(`login ${res.status()} ${await res.text()}`);
  return page;
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.locator('[data-testid="master-directory-client"][data-ready="true"]').waitFor({ timeout: 180_000 }).catch(() => {});
}

const browser = await launch();
try {
  // ---- Компьютер ----
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await login(ctx);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await settle(page);
  const header = await page.locator("header").innerText();
  check("AC1 нет кода справочника в шапке", !header.includes("Код справочника"), header.slice(0, 120).replace(/\s+/g, " "));
  check("AC1 нет «Подключено объектов» в шапке", !header.includes("Подключено объектов"));
  const tabs = await page.locator('[role="tab"]').allInnerTexts();
  check(
    "AC2 вкладки",
    tabs[0]?.includes("Мастер-справочник журнала бракеража готовой продукции") &&
      tabs[1]?.includes("Мастер-справочник журнала бракеража скоропортящейся продукции") &&
      tabs[2]?.includes("Подключённые объекты"),
    tabs.map((t) => t.replace(/\s+/g, " ")).join(" | ")
  );
  const tabOverflow = await page.locator('[role="tablist"]').evaluate((el) => el.scrollWidth - el.clientWidth);
  check("AC2 вкладки без прокрутки на 1440", tabOverflow <= 1, `overflow=${tabOverflow}`);
  const panel = await page.locator('[data-testid="master-export-panel"]').innerText().catch(() => "");
  check("AC3 панель выгрузки", panel.includes("Выгрузка блюд") && panel.includes("Выгрузить в журналы") && panel.includes("Загрузить Excel/CSV"));
  check("AC3 нет «Вставить списком» и сохранённого списка", (await page.locator('[data-testid="master-paste-dish"], [data-testid="master-list-dish"]').count()) === 0);
  await page.screenshot({ path: path.join(RAW, "d-master-menu-tab.png") });

  // ---- Окно выгрузки ----
  await page.locator('[data-testid="master-brakerage-open"]').click();
  const dialog = page.locator('[data-testid="master-brakerage-dialog"]');
  await dialog.waitFor({ timeout: 60_000 });
  const dialogText = await dialog.innerText();
  check("AC4 нет «Время для всех строк» / «Проставить всем строкам» / «Взять из справочника»",
    !/Время для всех строк|Проставить всем строкам|Взять из справочника/.test(dialogText));
  check("AC4 есть «Загрузить Excel/CSV» в окне", (await dialog.locator('[data-testid="master-brakerage-upload"]').count()) === 1);
  const names = await dialog.locator('[data-testid^="bulk-name-"]').evaluateAll((els) => els.map((el) => el.value));
  check("AC4 пустая таблица", names.length >= 1 && names.every((v) => v === ""), `строк ${names.length}`);
  const boxes = dialog.locator('[data-testid="master-brakerage-target"]');
  const boxStates = await boxes.evaluateAll((els) => els.map((el) => el.checked));
  check("AC4 галочки пищеблоков — все отмечены", boxStates.length === 2 && boxStates.every(Boolean), JSON.stringify(boxStates));

  // Набор: время с маской.
  await dialog.locator('[data-testid="bulk-name-0"]').fill("Борщ со сметаной");
  await dialog.locator('[data-testid="bulk-time-0"]').pressSequentially("0830");
  const t0 = await dialog.locator('[data-testid="bulk-time-0"]').inputValue();
  check("AC6 маска: 0830 → 08:30", t0 === "08:30", t0);
  await dialog.locator('[data-testid="bulk-name-1"]').fill("Компот из сухофруктов");
  await dialog.locator('[data-testid="bulk-time-1"]').pressSequentially("12");
  const t1typed = await dialog.locator('[data-testid="bulk-time-1"]').inputValue();
  await dialog.locator('[data-testid="bulk-name-1"]').click();
  const t1 = await dialog.locator('[data-testid="bulk-time-1"]').inputValue();
  check("AC6 маска: 12 → «12:» → при уходе 12:00", t1typed === "12:" && t1 === "12:00", `${t1typed} → ${t1}`);
  // Повтор тех же блюд на ту же дату не добавляется — дата прогона задаётся снаружи.
  await dialog.locator('[data-testid="master-brakerage-date"]').fill(process.env.SMOKE_DATE || "20-10-2026");

  // Снять второй пищеблок.
  const orgNames = await dialog.locator('[data-testid="master-brakerage-targets"] label:has(input)').allInnerTexts();
  const cafeIndex = orgNames.findIndex((n) => n.includes("Одна точка"));
  await boxes.nth(cafeIndex).uncheck();
  const submit = dialog.locator('[data-testid="master-brakerage-dialog-submit"]');
  const label = await submit.innerText();
  // `\b` в регулярках JS не работает с кириллицей — сравниваем целиком.
  check("AC4 надпись кнопки по отмеченным", label.trim() === "Выгрузить в 1 пищеблок", label);
  await page.screenshot({ path: path.join(RAW, "d-export-dialog.png") });

  // Снять все — кнопка неактивна.
  await dialog.locator('[data-testid="master-brakerage-targets-toggle"]').click(); // «Отметить все»
  await dialog.locator('[data-testid="master-brakerage-targets-toggle"]').click(); // «Снять все»
  check("AC4 без отмеченных — кнопка неактивна", await submit.isDisabled(), await submit.innerText());
  // Вернуть только «Берёзку».
  const berezka = orgNames.findIndex((n) => n.includes("Берёзка"));
  await boxes.nth(berezka).check();

  await submit.click();
  const preview = page.locator('[data-testid="master-brakerage-preview"]');
  await preview.waitFor({ timeout: 180_000 });
  const previewOrgs = await preview.locator('[data-testid="master-brakerage-org"]').allInnerTexts();
  check("AC5 предпросмотр только в отмеченный", previewOrgs.length === 1 && previewOrgs[0].includes("Берёзка"), previewOrgs.map((t) => t.replace(/\s+/g, " ")).join(" | "));
  await page.screenshot({ path: path.join(RAW, "d-export-preview.png") });
  await page.getByRole("button", { name: /^Добавить/ }).click();
  const result = page.locator('[data-testid="master-brakerage-result"]');
  await result.waitFor({ timeout: 180_000 });
  const resultText = (await result.innerText()).replace(/\s+/g, " ");
  check("AC5 запись в отмеченный", /Берёзка/.test(resultText) && !/Одна точка/.test(resultText), resultText);
  await page.screenshot({ path: path.join(RAW, "d-export-result.png") });
  check("без ошибок страницы", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // ---- Телефон ----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const m = await login(mctx);
  await m.goto(`${BASE}/master`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await settle(m);
  const mTabs = await m.locator('[role="tab"]').allInnerTexts();
  const pageOverflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("AC2 телефон: короткие подписи, страница без горизонтальной прокрутки", mTabs.join("|").includes("Готовая продукция") && pageOverflow <= 1, `${mTabs.join(" | ")} overflow=${pageOverflow}`);
  await m.screenshot({ path: path.join(RAW, "m-master-menu-tab.png"), fullPage: true });
  await mctx.close();
} finally {
  await browser.close();
  fs.writeFileSync(path.join(RAW, "smoke.json"), JSON.stringify(report, null, 2));
  console.log(report.problems.length ? `ПРОБЛЕМЫ: ${report.problems.length}` : "ВСЁ ОК");
}
