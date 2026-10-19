// Playwright-проверка на локальной копии демо-базы (wesetup_points):
// AC5 `/settings/areas`, AC6 `/settings/equipment` (+ окно оборудования),
// AC7 окно «Списки» журнала фритюра, AC8 наклейка фритюрницы, AC10 —
// 1440×900 и 390×800 без горизонтальной прокрутки страницы.
//
//   node .agent/tasks/points-model-2026-10/raw/check-pages.mjs <base> <outDir> <fryerUrl> <activeBuildingId> <orgId> <fryerDocId>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// «Все точки сразу» бывает только с выключенным флагом «журналы по точкам»:
// с флагом и ≥ 2 точками активна всегда одна (resolveActiveBuilding берёт
// первую доступную). Поэтому общий вид снимаем с флагом off, точку в шапке —
// с флагом on. Только локальная копия.
const sql = new pg.Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_points" });
await sql.connect();
const setPerLocation = (orgId, on) =>
  sql.query(`UPDATE "Organization" SET "perLocationJournals" = $2 WHERE id = $1`, [orgId, on]);

const [
  base = "http://localhost:3042",
  outDir = ".agent/tasks/points-model-2026-10/raw",
  fryerUrl = "",
  activeBuildingId = "",
  orgId = "",
  fryerDocId = "",
] = process.argv.slice(2);
const exe = process.env.PW_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
const report = [];
let failures = 0;
const log = (line) => {
  report.push(line);
  console.log(line);
};
const verdict = (ok, line) => {
  if (!ok) failures += 1;
  log(`${ok ? "PASS" : "FAIL"} ${line}`);
};

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.fill("#email", "admin@haccp.local");
  await page.fill("#password", "admin1234");
  await page.press("#password", "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 300_000 });
  await page.close();
}

async function check(page, route, name, viewport) {
  // /api/live — долгий опрос (5 мин), networkidle не наступает: ждём группы.
  await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 600_000 });
  await page.waitForSelector('[data-testid$="-building-group"] h2', { timeout: 300_000 });
  await page.waitForTimeout(1500);
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    areaGroups: [...document.querySelectorAll('[data-testid="area-building-group"] h2')].map((h) => h.textContent?.trim()),
    equipmentGroups: [...document.querySelectorAll('[data-testid="equipment-building-group"] h2')].map((h) => h.textContent?.trim()),
    title: [...document.querySelectorAll("h1")].map((h) => h.textContent?.trim()).filter(Boolean).pop(),
  }));
  const file = path.join(outDir, `${name}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const groups = metrics.areaGroups.length ? metrics.areaGroups : metrics.equipmentGroups;
  const hscroll = metrics.scrollWidth > metrics.clientWidth;
  verdict(
    !hscroll && groups.length > 0,
    `${route} @${viewport.width}x${viewport.height}: h1=«${metrics.title}» groups=${JSON.stringify(groups)} hscroll=${
      hscroll ? `YES (${metrics.scrollWidth}>${metrics.clientWidth})` : "no"
    } → ${path.basename(file)}`,
  );
  return { ...metrics, groups };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 800 },
]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "ru-RU" });
  await login(context);
  const page = await context.newPage();
  if (orgId) await setPerLocation(orgId, false);
  const areasAll = await check(page, "/settings/areas", "areas-all", viewport);
  verdict(
    areasAll.groups.at(-1) === "Без точки" &&
      areasAll.groups.indexOf("Берёзка на Ленина") === 0 &&
      areasAll.groups.indexOf("Берёзка на Мира") === 1,
    `AC5 группы цехов по точкам в порядке sortOrder, «Без точки» в конце: ${JSON.stringify(areasAll.groups)}`,
  );
  const equipmentAll = await check(page, "/settings/equipment", "equipment-all", viewport);
  verdict(
    equipmentAll.groups[0] === "Берёзка на Ленина" && equipmentAll.groups[1] === "Берёзка на Мира",
    `AC6 оборудование по точкам своего цеха: ${JSON.stringify(equipmentAll.groups)}`,
  );

  if (viewport.width === 1440) {
    // Окно «Добавить оборудование»: точка → помещения этой точки.
    await page.getByRole("button", { name: "Добавить оборудование" }).first().click();
    await page.waitForTimeout(700);
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] label')].map((l) => l.textContent?.replace(/\s+/g, " ").trim()),
    );
    await page.screenshot({ path: path.join(outDir, "equipment-dialog-1440x900.png") });
    await page.locator("#eq-area").click();
    await page.waitForTimeout(500);
    const options = await page.evaluate(() =>
      [...document.querySelectorAll('[role="listbox"] [role="group"]')].map((g) => ({
        label: g.firstElementChild?.textContent?.trim(),
        items: [...g.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()),
      })),
    );
    await page.screenshot({ path: path.join(outDir, "equipment-dialog-places-1440x900.png") });
    verdict(
      labels.some((l) => l?.startsWith("Точка")) && labels.some((l) => l?.startsWith("Помещение")) && options.length > 0,
      `AC6 окно оборудования: поля ${JSON.stringify(labels.filter((l) => /Точка|Помещение/.test(l ?? "")))}; помещения: ${JSON.stringify(options)}`,
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Окно цеха: выбор точки при двух точках.
    await page.goto(`${base}/settings/areas`, { waitUntil: "load", timeout: 600_000 });
    await page.getByRole("button", { name: "Добавить цех" }).first().click();
    await page.waitForTimeout(600);
    const hasBuildingSelect = (await page.locator("#area-building").count()) > 0;
    await page.screenshot({ path: path.join(outDir, "area-dialog-1440x900.png") });
    verdict(hasBuildingSelect, `AC5 окно цеха: выбор точки при двух точках = ${hasBuildingSelect}`);
    await page.keyboard.press("Escape");
  }

  if (activeBuildingId && orgId) {
    // Точка в шапке (кука wesetup.building) — только её группа и «Без точки».
    await setPerLocation(orgId, true);
    await context.addCookies([{ name: "wesetup.building", value: `${orgId}:${activeBuildingId}`, url: base }]);
    const areasActive = await check(page, "/settings/areas", "areas-active", viewport);
    const equipmentActive = await check(page, "/settings/equipment", "equipment-active", viewport);
    verdict(
      areasActive.groups.length === 2 && areasActive.groups[1] === "Без точки" && !areasActive.groups.includes("Берёзка на Ленина"),
      `AC5 выбрана точка в шапке: ${JSON.stringify(areasActive.groups)}`,
    );
    verdict(
      equipmentActive.groups.every((g) => g !== "Берёзка на Ленина"),
      `AC6 выбрана точка в шапке: ${JSON.stringify(equipmentActive.groups)}`,
    );
    await context.clearCookies({ name: "wesetup.building" });
  }

  if (fryerDocId && viewport.width === 1440) {
    // Окно «Списки» журнала фритюра: фритюрницы из «Оборудования» помечены.
    // Страница документа в dev не доходит до networkidle — ждём саму кнопку.
    await page.goto(`${base}/journals/fryer_oil/documents/${fryerDocId}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    const listsButton = page.getByRole("button", { name: "Редактировать списки" }).first();
    await listsButton.waitFor({ state: "visible", timeout: 600_000 });
    await page.waitForTimeout(1500);
    await listsButton.click();
    await page.waitForTimeout(600);
    await page.getByRole("tab", { name: "Оборудование" }).click();
    await page.waitForTimeout(400);
    const linked = await page.locator('[data-testid="fryer-linked-equipment"]').allTextContents();
    await page.screenshot({ path: path.join(outDir, "fryer-lists-dialog-1440x900.png") });
    verdict(
      linked.length > 0 && linked.every((t) => t.includes("из «Оборудования»")),
      `AC7 окно «Списки»: связанные позиции ${JSON.stringify(linked)}`,
    );
    await page.keyboard.press("Escape");
  }

  if (fryerUrl) {
    const sticker = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "ru-RU" });
    const qr = await sticker.newPage();
    await qr.goto(fryerUrl, { waitUntil: "load", timeout: 600_000 });
    await qr.waitForTimeout(800);
    const file = path.join(outDir, `fryer-sticker-${viewport.width}x${viewport.height}.png`);
    await qr.screenshot({ path: file, fullPage: true });
    const info = await qr.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent?.trim(),
      form: Boolean(document.querySelector('[data-testid="fryer-quality"]')),
      hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    verdict(
      info.form && /фритюрных жиров/.test(info.h1 ?? "") && !info.hscroll,
      `AC8 наклейка фритюрницы @${viewport.width}: ${JSON.stringify(info)} → ${path.basename(file)}`,
    );
    await sticker.close();
  }
  await context.close();
}

if (orgId) await setPerLocation(orgId, true);
await sql.end();
log(`SUMMARY ${failures === 0 ? "PASS" : "FAIL"} failures=${failures}`);
fs.writeFileSync(path.join(outDir, "playwright-report.txt"), report.join("\n") + "\n");
await browser.close();
process.exit(failures === 0 ? 0 : 1);
