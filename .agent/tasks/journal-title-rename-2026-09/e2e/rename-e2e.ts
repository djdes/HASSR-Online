/**
 * E2E «Своё название журнала с его страницы + компактный „Включён“» на
 * своей базе (wesetup_wt_jtitle) и своём dev-сервере (http://localhost:3047).
 *
 * Запуск (из C:/wt/jtitle, dev-сервер уже поднят, setup-output.json есть):
 *   npx tsx .agent/tasks/journal-title-rename-2026-09/e2e/rename-e2e.ts
 *
 * Пишет проверки в evidence/e2e-results.json, снимки 1440×900 и 390×844 —
 * в evidence/*.png (в git не попадают: `.agent/**\/*.png`).
 */
import "dotenv/config";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import pg from "pg";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3047";
const TASK_DIR = path.resolve(".agent/tasks/journal-title-rename-2026-09");
const EVIDENCE = path.join(TASK_DIR, "evidence");
const setup = JSON.parse(readFileSync(path.join(TASK_DIR, "e2e/setup-output.json"), "utf8")) as {
  password: string;
  journal: string;
  managerEmail: string;
  cookEmail: string;
  organizationId: string;
  managerId: string;
  cookId: string;
};
const CHROME =
  process.env.E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright/chromium-1232/chrome-win64/chrome.exe");

const DB_URL = process.env.DATABASE_URL ?? "";
if (!DB_URL.includes("wesetup_wt_jtitle")) throw new Error("Только своя база wesetup_wt_jtitle");

const CODE = setup.journal;
const OFFICIAL = "Журнал контроля температурного режима холодильного и морозильного оборудования";
const CUSTOM = "Холодильники";
/** Уже сохранённые своими названия организации: окно журнала их не трогает. */
const STORED_BEFORE = { journals: { hygiene: "Гигиена персонала" }, sections: { reports: "Выгрузки" } };
const WARNING =
  `Это название увидят ваши сотрудники в кабинете, на QR и в Telegram. В печати и у проверяющего останется официальное: «${OFFICIAL}» — так требуют правила.`;
const AUDIT_ACTION = "settings.custom_names.update";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const NAV_TIMEOUT = 240_000;

type Check = { id: string; ac: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(id: string, ac: string, ok: boolean, detail: string) {
  checks.push({ id, ac, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${id} — ${detail}`);
}

const consoleErrors: string[] = [];
function watchConsole(page: Page, label: string) {
  const where = () => page.url().replace(BASE, "");
  page.on("pageerror", (error) =>
    consoleErrors.push(`${label} ${where()} pageerror: ${(error.stack ?? error.message).slice(0, 500)}`)
  );
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // У предупреждения гидратации важна не шапка, а строки «- / +» —
    // какой именно атрибут не совпал.
    const diff = text
      .split("\n")
      .filter((line) => /^\s*[-+]\s/.test(line))
      .slice(0, 6)
      .map((line) => line.trim())
      .join(" | ");
    consoleErrors.push(
      `${label} ${where()} console: ${text.slice(0, 160)}${diff ? ` [diff: ${diff.slice(0, 500)}]` : ""}`
    );
  });
}

const pool = new pg.Pool({ connectionString: DB_URL });

async function orgRow() {
  const { rows } = await pool.query(
    `select "customNamesJson", "disabledJournalCodes" from "Organization" where id = $1`,
    [setup.organizationId]
  );
  return rows[0] as { customNamesJson: unknown; disabledJournalCodes: string[] };
}

async function auditRows(since: Date) {
  // `createdAt` — timestamp без пояса в UTC (так пишет Prisma), а сессия
  // базы — Europe/Moscow: границу переводим в UTC явно.
  const { rows } = await pool.query(
    `select "userId", action, details, "createdAt" from "AuditLog"
       where "organizationId" = $1 and action = $2
         and "createdAt" > ($3::timestamptz at time zone 'UTC')
       order by "createdAt" asc`,
    [setup.organizationId, AUDIT_ACTION, since.toISOString()]
  );
  return rows as Array<{ userId: string | null; action: string; details: Record<string, unknown> }>;
}

async function newContext(browser: Browser, viewport: { width: number; height: number }) {
  const phone = viewport.width < 500;
  return browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    locale: "ru-RU",
    reducedMotion: "reduce",
  });
}

async function login(context: BrowserContext, email: string) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: setup.password },
    timeout: NAV_TIMEOUT,
  });
  if (!res.ok()) throw new Error(`login ${email}: ${res.status()} ${await res.text()}`);
}

async function go(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
}

/** Окна, что открываются сами при первом заходе (гайд журнала и т. п.). */
async function closeAutoDialogs(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  }
}

async function openJournal(page: Page) {
  await go(page, `/journals/${CODE}`);
  await page.locator("h1").first().waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  await closeAutoDialogs(page);
}

async function shot(page: Page, name: string, ac: string) {
  await page.mouse.move(4, 420);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(400);
  const file = path.join(EVIDENCE, name);
  await page.screenshot({ path: file, animations: "disabled" });
  const size = statSync(file).size;
  check(`shot:${name}`, ac, size > 10_000, `${name} — ${Math.round(size / 1024)} КБ`);
}

function squash(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

// Строкой: tsx оборачивает именованные функции в `__name`, которого нет в браузере.
const GEOMETRY_SCRIPT = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) };
  };
  const h1 = document.querySelector("h1");
  const controls = h1 ? h1.querySelector("[data-journal-title-controls]") : null;
  const toggle = h1 ? h1.querySelector("[data-journal-enabled]") : null;
  const qr = document.querySelector("[data-testid=journal-qr-point]");
  const lineHeight = h1 ? parseFloat(getComputedStyle(h1).lineHeight) : 0;
  return {
    h1: box(h1),
    controls: box(controls),
    toggle: box(toggle),
    qr: box(qr),
    lineHeight: Math.round(lineHeight),
    oldPill: document.body.innerText.includes("· отключить"),
  };
})()`;

type Box = { x: number; y: number; w: number; h: number; bottom: number } | null;
type Geometry = { h1: Box; controls: Box; toggle: Box; qr: Box; lineHeight: number; oldPill: boolean };

async function geometry(page: Page): Promise<Geometry> {
  return (await page.evaluate(GEOMETRY_SCRIPT)) as Geometry;
}

/** Переключатель стоит в последней строке заголовка, а не отдельной строкой. */
function checkCompact(label: string, g: Geometry, before: { indicator?: { h: number } } | undefined) {
  const inside =
    Boolean(g.h1 && g.toggle) &&
    g.toggle!.y >= g.h1!.y &&
    g.toggle!.bottom <= g.h1!.bottom + 2 &&
    g.toggle!.y >= g.h1!.bottom - g.lineHeight - 4;
  check(
    `compact-in-title-line:${label}`,
    "AC3",
    inside,
    `h1 ${JSON.stringify(g.h1)}, «Включён» ${JSON.stringify(g.toggle)}, строка ${g.lineHeight}px`
  );
  check(
    `compact-size:${label}`,
    "AC3",
    Boolean(g.toggle) && g.toggle!.h <= 30 && (!before?.indicator || g.toggle!.h < before.indicator.h),
    `высота «Включён» ${g.toggle?.h}px (было ${before?.indicator?.h ?? "—"}px), старой пилюли «· отключить» нет: ${!g.oldPill}`
  );
  check(`old-pill-gone:${label}`, "AC3", !g.oldPill, "текста «· отключить» на странице нет");
}

function dialogOf(page: Page): Locator {
  return page.locator('[role="dialog"]').filter({ has: page.getByTestId("journal-rename-dialog") });
}

async function main() {
  const before = JSON.parse(readFileSync(path.join(EVIDENCE, "before-geometry.json"), "utf8")) as Record<
    string,
    { indicator?: { h: number; y: number }; h1?: { y: number; h: number } }
  >;

  // Исходное состояние: у организации уже есть свои названия других журналов
  // и раздела — окно журнала не должно их затереть. Журнал включён.
  await pool.query(
    `update "Organization" set "customNamesJson" = $2::jsonb,
       "disabledJournalCodes" = (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements_text("disabledJournalCodes") c where c <> $3)
     where id = $1`,
    [setup.organizationId, JSON.stringify(STORED_BEFORE), CODE]
  );
  const startedAt = new Date(Date.now() - 1000);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-gl=swiftshader", "--no-sandbox"],
  });

  try {
    // ── Руководитель, 1440 ─────────────────────────────────────────────
    const desk = await newContext(browser, DESKTOP);
    await login(desk, setup.managerEmail);
    const page = await desk.newPage();
    watchConsole(page, "manager-1440");
    await openJournal(page);

    const pencil = page.getByRole("button", { name: "Переименовать журнал" });
    const toggle = page.getByRole("switch", { name: "Вести журнал" });
    check("pencil-visible:1440", "AC1", await pencil.isVisible(), "карандаш у заголовка виден руководителю");
    check(
      "pencil-in-h1:1440",
      "AC1",
      (await page.locator("h1").first().getByRole("button", { name: "Переименовать журнал" }).count()) === 1,
      "карандаш — в строке заголовка (внутри H1, сразу за названием)"
    );
    check(
      "switch-on:1440",
      "AC3",
      (await toggle.getAttribute("aria-checked")) === "true",
      `переключатель «Вести журнал» включён, подпись: ${squash(await page.locator("h1 [data-journal-enabled]").innerText())}`
    );
    const g1440 = await geometry(page);
    checkCompact("1440", g1440, before["before-manager-1440.png"]);
    await shot(page, "after-manager-1440.png", "AC3");

    // Страница не должна перезагружаться: метка в window и timeOrigin
    // документа переживут только обновление без перезагрузки, а событие
    // `load` пришло бы на новый документ.
    await page.evaluate(() => {
      (window as unknown as { __jtitleMarker?: string }).__jtitleMarker = "same-document";
    });
    const timeOriginBefore = await page.evaluate(() => performance.timeOrigin);
    let documentLoads = 0;
    page.on("load", () => {
      documentLoads += 1;
    });

    await pencil.click();
    const dialog = dialogOf(page);
    await dialog.waitFor({ state: "visible", timeout: 30_000 });
    const input = dialog.getByLabel("Название журнала в вашей организации");
    const saveButton = dialog.getByRole("button", { name: "Сохранить" });
    const resetButton = dialog.getByRole("button", { name: "Вернуть стандартное" });
    const warning = squash(await dialog.getByTestId("journal-rename-warning").innerText());
    check("dialog-title", "AC1", squash(await dialog.locator("#confirm-dialog-title").innerText()) === "Своё название журнала", "окно «Своё название журнала» — общий диалог проекта (ConfirmDialog)");
    check("dialog-field-prefilled", "AC1", (await input.inputValue()) === OFFICIAL, `поле заполнено текущим: «${await input.inputValue()}»`);
    check("dialog-warning-text", "AC1", warning.includes(WARNING), `предупреждение: «${warning}»`);
    check("dialog-reset-in-warning", "AC1", (await dialog.getByTestId("journal-rename-warning").getByRole("button", { name: "Вернуть стандартное" }).count()) === 1, "«Вернуть стандартное» — в самом предупреждении");
    check("dialog-reset-disabled-when-standard", "AC1", await resetButton.isDisabled(), "официальное уже стоит — «Вернуть стандартное» неактивна");
    check("dialog-save-disabled-unchanged", "AC1", await saveButton.isDisabled(), "без изменений «Сохранить» неактивна");
    check("dialog-cancel", "AC1", await dialog.getByRole("button", { name: "Отмена" }).isVisible(), "есть «Отмена»");
    await shot(page, "rename-dialog-1440.png", "AC1");

    // Проверки — те же, что на странице «Названия».
    await input.fill("Х");
    const shortHint = squash(await dialog.locator("[id$='-hint']").innerText());
    check("validate-length", "AC1", shortHint === "От 2 до 80 символов" && (await saveButton.isDisabled()), `1 символ → «${shortHint}», «Сохранить» неактивна`);
    check("validate-maxlength", "AC1", (await input.getAttribute("maxlength")) === "80", "поле не даёт ввести больше 80 символов");

    const hint = dialog.locator("[id$='-hint']");
    const patchResponse = () =>
      page.waitForResponse(
        (res) => res.url().endsWith("/api/settings/custom-names") && res.request().method() === "PATCH",
        { timeout: NAV_TIMEOUT }
      );

    // Повторы проверяет сервер (каталога журналов на странице нет) — ответ
    // показывается у поля, окно остаётся открытым.
    await input.fill("гигиена  персонала");
    const dupCustomResponse = patchResponse();
    await saveButton.click();
    const dupCustomStatus = (await dupCustomResponse).status();
    const dupCustomText = "Так уже назван журнал «Гигиенический журнал (сотрудники)»";
    await hint.filter({ hasText: dupCustomText }).waitFor({ timeout: 15_000 }).catch(() => {});
    const dupHint = squash(await hint.innerText());
    check(
      "validate-duplicate-custom",
      "AC1",
      dupCustomStatus === 400 && dupHint === dupCustomText && (await dialog.isVisible()),
      `своё название другого журнала → ${dupCustomStatus}, у поля «${dupHint}», окно не закрылось`
    );
    await input.fill("Журнал уборки");
    const dupOfficialResponse = patchResponse();
    await input.press("Enter");
    const dupOfficialStatus = (await dupOfficialResponse).status();
    const dupOfficialText = "Так называется журнал «Журнал уборки»";
    await hint.filter({ hasText: dupOfficialText }).waitFor({ timeout: 15_000 }).catch(() => {});
    const dupOfficial = squash(await hint.innerText());
    check(
      "validate-duplicate-official",
      "AC1",
      dupOfficialStatus === 400 && dupOfficial === dupOfficialText,
      `официальное название другого журнала (Enter) → ${dupOfficialStatus}, у поля «${dupOfficial}»`
    );
    check("validate-nothing-saved", "AC1", isDeepStrictEqual((await orgRow()).customNamesJson, STORED_BEFORE), "после отказов в базе всё как было");

    // Сохранение.
    await input.fill(`  ${CUSTOM} `);
    const saveResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/settings/custom-names") && response.request().method() === "PATCH"
    );
    await saveButton.click();
    const response = await saveResponse;
    check("save-same-api", "AC1", response.status() === 200, `PATCH /api/settings/custom-names → ${response.status()} ${squash(await response.text()).slice(0, 160)}`);
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
    const h1 = page.locator("h1").first();
    await page.waitForFunction(
      (name) => (document.querySelector("h1")?.textContent ?? "").startsWith(name),
      CUSTOM,
      { timeout: 30_000 }
    );
    const h1Text = squash(await h1.innerText());
    check("title-updated", "AC1", h1Text.startsWith(CUSTOM) && h1Text.includes(`Официальное название: ${OFFICIAL}`), `H1: «${h1Text}»`);
    const toastText = squash(await page.locator("[data-sonner-toast]").first().innerText().catch(() => ""));
    check("toast", "AC1", toastText.includes(`Журнал переименован: «${CUSTOM}»`), `уведомление: «${toastText}»`);
    const marker = await page.evaluate(() => (window as unknown as { __jtitleMarker?: string }).__jtitleMarker);
    const timeOriginAfter = await page.evaluate(() => performance.timeOrigin);
    check(
      "no-reload",
      "AC1",
      marker === "same-document" && timeOriginAfter === timeOriginBefore && documentLoads === 0,
      `без перезагрузки: метка «${marker}», timeOrigin тот же: ${timeOriginAfter === timeOriginBefore}, новых загрузок документа: ${documentLoads}`
    );
    const crumbs = page.getByRole("navigation", { name: "Хлебные крошки" });
    check("crumb-updated", "AC1", (await crumbs.getByTitle(CUSTOM, { exact: true }).count()) > 0, `крошка журнала: «${CUSTOM}»`);

    // Меню: переключатель журналов в крошке приходит с сервера после обновления.
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await crumbs.getByTitle(CUSTOM, { exact: true }).last().hover();
    const menu = page.getByRole("menu").last();
    await menu.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    const menuText = squash(await menu.innerText().catch(() => ""));
    check("menu-updated", "AC1", menuText.includes(CUSTOM) && !menuText.includes(OFFICIAL), `меню «Журналы набора»: ${menuText.slice(0, 200)}`);
    await page.mouse.move(700, 700);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, "renamed-1440.png", "AC1");

    const stored = (await orgRow()).customNamesJson;
    const expectedStored = {
      journals: { ...STORED_BEFORE.journals, [CODE]: CUSTOM },
      sections: STORED_BEFORE.sections,
    };
    check("db-merged", "AC1", isDeepStrictEqual(stored, expectedStored), `customNamesJson: ${JSON.stringify(stored)}`);
    const audit1 = await auditRows(startedAt);
    const expectedAudit1 = { count: 1, [`Журнал «${OFFICIAL}»`]: { from: "стандартное", to: CUSTOM } };
    check(
      "audit-rename",
      "AC1",
      audit1.length === 1 && audit1[0].userId === setup.managerId && isDeepStrictEqual(audit1[0].details, expectedAudit1),
      `AuditLog ${AUDIT_ACTION}: ${JSON.stringify(audit1.map((row) => row.details))}`
    );

    // Сохранено по-настоящему: после перезагрузки — то же; «Названия» видят его же.
    await openJournal(page);
    check("persisted-after-reload", "AC1", squash(await page.locator("h1").first().innerText()).startsWith(CUSTOM), "после перезагрузки заголовок — своё название");
    await go(page, "/settings/names");
    const namesValue = await page.locator(`#custom-name-journal-${CODE}`).inputValue();
    const hygieneValue = await page.locator("#custom-name-journal-hygiene").inputValue();
    const reportsValue = await page.locator("#custom-name-section-reports").inputValue();
    check("settings-names-same-storage", "AC1", namesValue === CUSTOM && hygieneValue === "Гигиена персонала" && reportsValue === "Выгрузки", `«Настройки → Названия»: ${CODE}=«${namesValue}», hygiene=«${hygieneValue}», reports=«${reportsValue}»`);
    await go(page, "/journals");
    const listText = squash(await page.locator("main").innerText());
    check("journals-list-updated", "AC1", listText.includes(CUSTOM), "список журналов показывает своё название");

    // Клавиатура: карандаш с клавиатуры, Esc закрывает, фокус возвращается.
    await openJournal(page);
    await page.getByRole("button", { name: "Переименовать журнал" }).focus();
    await page.keyboard.press("Enter");
    await dialogOf(page).waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(200);
    const focusedInput = await page.evaluate(() => document.activeElement?.tagName === "INPUT");
    await page.keyboard.press("Escape");
    await dialogOf(page).waitFor({ state: "hidden", timeout: 15_000 });
    await page.waitForTimeout(200);
    const focusBack = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("keyboard", "AC1", focusedInput && focusBack === "Переименовать журнал", `Enter открывает, фокус в поле: ${focusedInput}; Esc закрывает, фокус на карандаше: ${focusBack}`);

    // Сброс: «Вернуть стандартное» в предупреждении → «Сохранить».
    const resetStartedAt = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Переименовать журнал" }).click();
    const dialog2 = dialogOf(page);
    await dialog2.waitFor({ state: "visible", timeout: 15_000 });
    const input2 = dialog2.getByLabel("Название журнала в вашей организации");
    check("reset-prefilled-custom", "AC1", (await input2.inputValue()) === CUSTOM, `поле заполнено своим: «${await input2.inputValue()}»`);
    await dialog2.getByRole("button", { name: "Вернуть стандартное" }).click();
    const resetHint = squash(await dialog2.locator("[id$='-hint']").innerText());
    check("reset-fills-official", "AC1", (await input2.inputValue()) === OFFICIAL && resetHint === "Сохраните — сотрудники снова увидят официальное название", `поле: «${await input2.inputValue()}», подсказка: «${resetHint}»`);
    await dialog2.getByRole("button", { name: "Сохранить" }).click();
    await dialog2.waitFor({ state: "hidden", timeout: 30_000 });
    await page.waitForFunction(
      (name) => (document.querySelector("h1")?.textContent ?? "").startsWith(name),
      OFFICIAL,
      { timeout: 30_000 }
    );
    const h1Reset = squash(await page.locator("h1").first().innerText());
    check("reset-title", "AC1", h1Reset.startsWith(OFFICIAL) && !h1Reset.includes("Официальное название"), `H1 после сброса: «${h1Reset}»`);
    check("reset-db", "AC1", isDeepStrictEqual((await orgRow()).customNamesJson, STORED_BEFORE), `customNamesJson: ${JSON.stringify((await orgRow()).customNamesJson)}`);
    const audit2 = await auditRows(resetStartedAt);
    check(
      "audit-reset",
      "AC1",
      audit2.length === 1 && isDeepStrictEqual(audit2[0].details, { count: 1, [`Журнал «${OFFICIAL}»`]: { from: CUSTOM, to: "стандартное" } }),
      `AuditLog: ${JSON.stringify(audit2.map((row) => row.details))}`
    );

    // «Включён»: работает как раньше — подтверждение, отключение, включение.
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await page.getByRole("switch", { name: "Вести журнал" }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: "Отключить журнал?" });
    await confirm.waitFor({ state: "visible", timeout: 15_000 });
    const confirmText = squash(await confirm.innerText());
    check("toggle-confirm", "AC3", confirmText.includes(`«${OFFICIAL}» перестанет считаться обязательным`) && confirmText.includes("Записи и документы сохраняются"), `подтверждение: ${confirmText.slice(0, 160)}`);
    await confirm.getByRole("button", { name: "Отмена" }).click();
    await confirm.waitFor({ state: "hidden", timeout: 15_000 });
    check(
      "toggle-cancel",
      "AC3",
      (await page.getByRole("switch", { name: "Вести журнал" }).getAttribute("aria-checked")) === "true" &&
        !(await orgRow()).disabledJournalCodes.includes(CODE),
      "«Отмена» — журнал остался включён"
    );
    await page.getByRole("switch", { name: "Вести журнал" }).press("Space");
    await confirm.waitFor({ state: "visible", timeout: 15_000 });
    await confirm.getByRole("button", { name: "Отключить" }).click();
    await page.getByTestId("journal-disabled").waitFor({ state: "visible", timeout: 60_000 });
    check("toggle-off", "AC3", (await orgRow()).disabledJournalCodes.includes(CODE), "Space → «Отключить» — журнал отключён (заглушка «Этот журнал отключён»)");
    await page.getByTestId("journal-enable").click();
    await page.getByRole("switch", { name: "Вести журнал" }).waitFor({ state: "visible", timeout: 60_000 });
    check("toggle-on-again", "AC3", !(await orgRow()).disabledJournalCodes.includes(CODE), "«Включить журнал» — снова включён, переключатель на месте");
    await desk.close();

    // ── Руководитель, 390 ──────────────────────────────────────────────
    const phone = await newContext(browser, PHONE);
    await login(phone, setup.managerEmail);
    const mobile = await phone.newPage();
    watchConsole(mobile, "manager-390");
    await openJournal(mobile);
    const g390 = await geometry(mobile);
    checkCompact("390", g390, before["before-manager-390.png"]);
    const beforeQrGap =
      before["before-manager-390.png"]?.indicator && before["before-manager-390.png"]?.h1
        ? before["before-manager-390.png"].indicator.y + before["before-manager-390.png"].indicator.h - (before["before-manager-390.png"].h1.y + before["before-manager-390.png"].h1.h)
        : null;
    check(
      "phone-row-saved",
      "AC3",
      Boolean(g390.h1 && g390.qr) && g390.qr!.y - g390.h1!.bottom <= 24,
      `390: от низа заголовка до «QR-точки» ${g390.qr && g390.h1 ? g390.qr.y - g390.h1.bottom : "—"}px (раньше под заголовком шла строка пилюли +${beforeQrGap ?? "—"}px)`
    );
    await shot(mobile, "after-manager-390.png", "AC3");
    await mobile.getByRole("button", { name: "Переименовать журнал" }).click();
    const sheet = dialogOf(mobile);
    await sheet.waitFor({ state: "visible", timeout: 15_000 });
    await shot(mobile, "rename-dialog-390.png", "AC1");
    await sheet.getByLabel("Название журнала в вашей организации").fill(CUSTOM);
    await sheet.getByRole("button", { name: "Сохранить" }).click();
    await sheet.waitFor({ state: "hidden", timeout: 30_000 });
    await mobile.waitForFunction(
      (name) => (document.querySelector("h1")?.textContent ?? "").startsWith(name),
      CUSTOM,
      { timeout: 30_000 }
    );
    const g390Renamed = await geometry(mobile);
    check(
      "phone-renamed",
      "AC1",
      squash(await mobile.locator("h1").first().innerText()).startsWith(CUSTOM) && Boolean(g390Renamed.toggle),
      `390: H1 «${squash(await mobile.locator("h1").first().innerText())}»`
    );
    await mobile.waitForTimeout(800);
    await shot(mobile, "renamed-390.png", "AC1");
    await phone.close();

    // ── Повар, 390 и API ───────────────────────────────────────────────
    const cookContext = await newContext(browser, PHONE);
    await login(cookContext, setup.cookEmail);
    const cookPage = await cookContext.newPage();
    watchConsole(cookPage, "cook-390");
    await openJournal(cookPage);
    const cookH1 = squash(await cookPage.locator("h1").first().innerText());
    check("cook-no-pencil", "AC2", (await cookPage.getByRole("button", { name: "Переименовать журнал" }).count()) === 0, "у повара карандаша нет");
    check("cook-no-switch", "AC2", (await cookPage.getByRole("switch").count()) === 0 && cookH1.includes("Включён"), "переключателя нет, только статус «Включён»");
    check("cook-sees-custom", "AC1", cookH1.startsWith(CUSTOM), `сотрудник видит своё название: «${cookH1}»`);
    await shot(cookPage, "after-cook-390.png", "AC2");
    const cookPatch = await cookContext.request.patch(`${BASE}/api/settings/custom-names`, {
      data: { journals: { [CODE]: "Повар переименовал" } },
      timeout: NAV_TIMEOUT,
    });
    const cookPut = await cookContext.request.put(`${BASE}/api/settings/custom-names`, {
      data: { journals: { [CODE]: "Повар переименовал" }, sections: {} },
      timeout: NAV_TIMEOUT,
    });
    const cookPatchText = squash(await cookPatch.text());
    check(
      "cook-api-403",
      "AC2",
      cookPatch.status() === 403 && cookPut.status() === 403 && cookPatchText.includes("Это действие доступно руководителю"),
      `повар: PATCH → ${cookPatch.status()} ${cookPatchText}, PUT → ${cookPut.status()}`
    );
    // Контроль: тот же запрос руководителя тем же способом проходит — 403
    // у повара именно из-за прав.
    const managerApi = await browser.newContext();
    await login(managerApi, setup.managerEmail);
    const managerPatch = await managerApi.request.patch(`${BASE}/api/settings/custom-names`, {
      data: { journals: { [CODE]: CUSTOM } },
      timeout: NAV_TIMEOUT,
    });
    check("manager-api-control", "AC2", managerPatch.status() === 200, `руководитель тем же запросом: PATCH → ${managerPatch.status()} ${squash(await managerPatch.text()).slice(0, 120)}`);
    await managerApi.close();
    const anonymous = await browser.newContext();
    const anonPatch = await anonymous.request.patch(`${BASE}/api/settings/custom-names`, {
      data: { journals: { [CODE]: "Аноним" } },
      timeout: NAV_TIMEOUT,
    });
    check("anon-api-401", "AC2", anonPatch.status() === 401, `без входа: PATCH → ${anonPatch.status()}`);
    await anonymous.close();
    const afterCook = (await orgRow()).customNamesJson as { journals?: Record<string, string> };
    check("cook-nothing-saved", "AC2", afterCook.journals?.[CODE] === CUSTOM, `после попыток повара в базе: «${afterCook.journals?.[CODE]}»`);
    await cookContext.close();
  } finally {
    await browser.close();
    // Возвращаем организацию в исходное состояние.
    await pool.query(`update "Organization" set "customNamesJson" = $2::jsonb where id = $1`, [
      setup.organizationId,
      JSON.stringify(STORED_BEFORE),
    ]);
    await pool.end();
  }

  const failed = checks.filter((item) => !item.ok);
  const result = {
    finishedAt: new Date().toISOString(),
    base: BASE,
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.map((item) => item.id),
    checks,
    consoleErrors,
  };
  writeFileSync(path.join(EVIDENCE, "e2e-results.json"), JSON.stringify(result, null, 2));
  console.log(`\n${result.passed}/${result.total} проверок, ошибок консоли: ${consoleErrors.length}`);
  for (const line of consoleErrors) console.log("  console:", line);
  if (failed.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  writeFileSync(
    path.join(EVIDENCE, "e2e-results.json"),
    JSON.stringify({ crashed: String(error?.stack ?? error), checks, consoleErrors }, null, 2)
  );
  process.exit(1);
});
