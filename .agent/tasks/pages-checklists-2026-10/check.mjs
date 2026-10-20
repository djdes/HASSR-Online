// Проверка раздела «Чек-листы» в браузере (pages-checklists-2026-10).
// Запуск из корня worktree (tsx — чтобы взять генератор ответов из src):
//   node --import tsx .agent/tasks/pages-checklists-2026-10/check.mjs [base] [сценарии через запятую]
// Сценарии: api (права API и крон без секрета), flow (типовой → назначить повару → «Назначено вам» →
// проверка → «Выполнено» → проверяющий «Принять»; dryRun напоминаний), pages (страницы × роли × 1440/390,
// Mini App). Пишет скриншоты и results-<сценарий>.json в raw/.
// Настоящие сообщения в Telegram не отправляются: крон — только ?dryRun=1, у dev-сервера пустой
// TELEGRAM_BOT_TOKEN, chat id — заведомо фальшивые.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Модули src — CommonJS через tsx: берём экспорт из `default`, если он там.
const load = async (rel) => {
  const mod = await import(new URL(rel, import.meta.url).href);
  return mod.default && typeof mod.default === "object" ? { ...mod.default, ...mod } : mod;
};
const { checklistAnswerProblem, checklistDefinitionSchema, visibleChecklistQuestions } = await load("../../../src/lib/custom-checklists.ts");
const { checklistConditionMatches, checklistInstancesSchema } = await load("../../../src/lib/custom-checklist-rules.ts");
const { evaluateChecklistRun, expandChecklistDefinition, validateChecklistRun } = await load("../../../src/lib/custom-checklist-runtime.ts");

const BASE = process.argv[2] || "http://localhost:3075";
const ONLY = (process.argv[3] || "api,flow,pages").split(",");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
fs.mkdirSync(RAW, { recursive: true });
const PASSWORD = "admin1234";
const ROLES = {
  owner: { title: "руководитель", email: "admin@haccp.local" },
  headchef: { title: "заведующая", email: "chef@haccp.local" },
  cook: { title: "повар", email: "hotcook1@haccp.local" },
};
const CRON_SECRET = (() => {
  const env = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  return (/^CRON_SECRET="?([^"\n]+)"?/m.exec(env)?.[1] ?? "").trim();
})();
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
  } catch {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    for (const dir of ["chromium-1243", "chromium_headless_shell-1243"]) {
      const exe = dir.startsWith("chromium_headless_shell")
        ? path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe")
        : path.join(base, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
    throw new Error("нет браузера");
  }
}

const problems = [];
/** Сообщения Playwright содержат заголовки запроса — секрет и cookie в лог не пишем. */
function redact(text) {
  return String(text)
    .split("Call log:")[0]
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/session-token=[^;\s]+/g, "session-token=<redacted>")
    .trim();
}
function problem(text) {
  text = redact(text);
  problems.push(text);
  console.log("  ✗", text);
}
function ok(text) {
  console.log("  ✓", text);
}

let lastNavigation = 0;
async function throttle() {
  const wait = lastNavigation + 2_700 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  for (let i = 0; i < 2; i++) {
    const dialog = page.locator('[role="dialog"]').first();
    if ((await dialog.isVisible().catch(() => false)) && !(await page.locator("[data-assignment-dialog]").isVisible().catch(() => false))) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(400);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    response = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    if (response?.status() !== 429) break;
    const retryAfter = Number(response.headers()["retry-after"] || 30);
    console.log(`  … 429 на ${href}, пауза ${retryAfter} с`);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
  }
  await settle(page);
  return response;
}

function watchErrors(page, tag) {
  page.on("pageerror", (error) => problem(`${tag} ${page.url()}: pageerror ${error.message.slice(0, 160)}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && (text.startsWith("[app-error]") || text.includes("MISSING_MESSAGE") || /hydrat/i.test(text))) {
      problem(`${tag} ${page.url()}: ${text.slice(0, 200)}`);
    }
  });
}

async function newContext(browser, kind) {
  const context = await createContext(browser, kind);
  // Первая сборка страницы/маршрута в dev — до нескольких минут.
  context.setDefaultTimeout(600_000);
  return context;
}

async function createContext(browser, kind) {
  const options =
    kind === "desktop"
      ? { viewport: { width: 1440, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" }
      : { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow" };
  return browser.newContext(options);
}

async function signIn(context, page, role, mini = false) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email: ROLES[role].email, password: PASSWORD },
    timeout: 600_000,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${role}: HTTP ${res.status()} ${JSON.stringify(body)}`);
  if (mini) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
}

/** Клик до перехода: до гидратации страницы клик может уйти в пустоту — повторяем. */
async function clickUntilUrl(page, locator, pattern, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    // Кнопка занята (идёт запрос/переход) — ждём перехода, не кликаем повторно.
    if (await locator.isEnabled().catch(() => false)) await locator.click({ timeout: 60_000 }).catch(() => {});
    try {
      await page.waitForURL(pattern, { timeout: 90_000 });
      return true;
    } catch {
      console.log(`  … клик №${i + 1} не увёл на ${pattern}, жду/повторяю`);
    }
  }
  return false;
}

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(RAW, `${name}.png`), fullPage });
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function sidebarItems(page) {
  return page
    .locator('[data-app-sidebar] nav[data-section-menu="checklists"] [data-menu-item]')
    .evaluateAll((els) =>
      els.map((el) => ({ id: el.getAttribute("data-menu-item"), href: el.getAttribute("href"), label: el.textContent.trim(), current: el.getAttribute("aria-current") === "page" })),
    )
    .catch(() => []);
}

/** Минуты «сейчас» по Москве и срок «через час» (не позже 23:59). */
function moscowDue() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const now = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  const due = Math.min(23 * 60 + 59, now + 60);
  return `${String(Math.floor(due / 60)).padStart(2, "0")}:${String(due % 60).padStart(2, "0")}`;
}

/** Ответы без нарушений и критических остановок — как ответил бы аккуратный повар. */
function cleanAnswers(definition) {
  const answers = {};
  const pick = (question) => {
    const candidates = [];
    switch (question.type) {
      case "yes_no": candidates.push("yes", "na", "no"); break;
      case "checkbox": candidates.push(true, false); break;
      case "number":
      case "scale": {
        const step = question.step || 1;
        const snap = (value) => question.min + Math.round((value - question.min) / step) * step;
        // Норма между границами нарушения (например, 2…6 °C) — середина, затем сами границы.
        const v = question.violation;
        if (v && typeof v.value === "number") {
          if (typeof v.upper === "number") candidates.push(snap((v.value + v.upper) / 2));
          candidates.push(v.value, snap(v.value + step), snap(v.value - step));
          if (typeof v.upper === "number") candidates.push(v.upper);
        }
        candidates.push(question.max, question.min, snap((question.max + question.min) / 2));
        break;
      }
      case "choice": candidates.push(...question.options.filter((o) => !o.violation).map((o) => o.value), ...question.options.map((o) => o.value)); break;
      case "multi": candidates.push(...question.options.filter((o) => !o.violation).map((o) => [o.value])); break;
      case "datetime": candidates.push("2026-10-19T10:00"); break;
      case "text": candidates.push("Проверено, замечаний нет"); break;
      case "photo":
      case "signature": candidates.push(PNG); break;
      default: return undefined;
    }
    for (const value of candidates) {
      if (checklistAnswerProblem(question, value, true)) continue;
      if (question.violation && checklistConditionMatches(question.violation, value)) continue;
      if ((question.logic ?? []).some((rule) => checklistConditionMatches(rule.condition, value))) continue;
      if (question.type === "yes_no" && !question.violation && value === "no") continue;
      return value;
    }
    return candidates[0];
  };
  for (let round = 0; round < 6; round++) {
    let added = 0;
    for (const question of visibleChecklistQuestions(definition, answers)) {
      if (answers[question.id] !== undefined) continue;
      const value = pick(question);
      if (value !== undefined) {
        answers[question.id] = value;
        added++;
      }
    }
    if (!added) break;
  }
  return answers;
}

const results = { base: BASE, startedAt: new Date().toISOString() };

// ---- api: права API назначений и крон -----------------------------------------
async function scenarioApi(browser) {
  const out = {};
  const contexts = {};
  for (const role of ["owner", "headchef", "cook"]) {
    const context = await newContext(browser, "desktop");
    const page = await context.newPage();
    await signIn(context, page, role);
    contexts[role] = { context, page };
  }
  const req = (role) => contexts[role].page.request;
  for (const { context } of Object.values(contexts)) context.setDefaultTimeout(600_000);
  const status = async (promise) => (await promise).status();
  out.cookGet = await status(req("cook").get(`${BASE}/api/checklists/assignments`));
  out.cookPost = await status(req("cook").post(`${BASE}/api/checklists/assignments`, { data: {} }));
  out.chefGet = await status(req("headchef").get(`${BASE}/api/checklists/assignments`));
  out.chefPost = await status(req("headchef").post(`${BASE}/api/checklists/assignments`, { data: {} }));
  out.ownerPostInvalid = await status(req("owner").post(`${BASE}/api/checklists/assignments`, { data: { templateId: "x", targetKind: "team", targetId: "y", frequency: "daily", dueTime: "25:00" } }));
  out.ownerPostWeeklyNoDay = await status(req("owner").post(`${BASE}/api/checklists/assignments`, { data: { templateId: "x", targetKind: "user", targetId: "y", frequency: "weekly", dueTime: "10:00" } }));
  out.ownerPostForeignTemplate = await status(req("owner").post(`${BASE}/api/checklists/assignments`, { data: { templateId: "foreign-template-id", targetKind: "user", targetId: "y", frequency: "daily", dueTime: "10:00" } }));
  out.ownerPatchUnknown = await status(req("owner").patch(`${BASE}/api/checklists/assignments/unknown-id`, { data: { active: false } }));
  out.ownerDeleteUnknown = await status(req("owner").delete(`${BASE}/api/checklists/assignments/unknown-id`));
  out.cookReviewUnknown = await status(req("cook").post(`${BASE}/api/checklists/inspections/unknown-id/review`));
  out.cronNoSecret = await status(req("owner").get(`${BASE}/api/cron/checklist-reminders?dryRun=1`));
  out.cronWrongSecret = await status(req("owner").get(`${BASE}/api/cron/checklist-reminders?dryRun=1`, { headers: { Authorization: "Bearer wrong" } }));
  const expected = {
    cookGet: 403, cookPost: 403, chefGet: 200, chefPost: 403, ownerPostInvalid: 400, ownerPostWeeklyNoDay: 400,
    ownerPostForeignTemplate: 404, ownerPatchUnknown: 404, ownerDeleteUnknown: 404, cookReviewUnknown: 404, cronNoSecret: 401, cronWrongSecret: 401,
  };
  for (const [key, want] of Object.entries(expected)) {
    if (out[key] !== want) problem(`api ${key}: ${out[key]}, ждали ${want}`);
    else ok(`api ${key}: ${want}`);
  }
  for (const { context } of Object.values(contexts)) await context.close();
  return out;
}

// ---- flow: типовой → назначение → повар → результат ---------------------------
async function scenarioFlow(browser) {
  const out = {};
  const dueTime = moscowDue();
  out.dueTime = dueTime;

  // 1. Руководитель: добавить типовой «СанПиН».
  console.log("== flow: руководитель добавляет типовой");
  const owner = await newContext(browser, "desktop");
  const op = await owner.newPage();
  watchErrors(op, "owner");
  await signIn(owner, op, "owner");
  await goto(op, "/checklists/templates");
  await shot(op, "flow-01-owner-templates-before");
  const sanpin = op.locator('[data-typical="sanpin"]');
  out.sanpinTitle = (await sanpin.locator("h3").innerText()).trim();
  const addButton = sanpin.getByRole("button", { name: "Добавить в организацию" });
  if (await addButton.isVisible().catch(() => false)) {
    await addButton.click();
    await sanpin.getByText("Уже добавлен").waitFor({ timeout: 120_000 }).catch(() => {});
    await settle(op);
  }
  out.sanpinAdded = await sanpin.getByText("Уже добавлен").isVisible().catch(() => false);
  out.sanpinButtons = await sanpin.locator("a,button").allInnerTexts();
  if (!out.sanpinAdded) problem("типовой СанПиН не добавлен");
  else ok(`типовой добавлен: «${out.sanpinTitle}», кнопки ${out.sanpinButtons.join(" / ")}`);
  await shot(op, "flow-02-owner-templates-added");

  // 2. «Назначить» у шаблона организации → окно с выбранным шаблоном.
  const orgRow = op.locator("[data-org-template]").filter({ hasText: out.sanpinTitle }).first();
  out.templateId = await orgRow.getAttribute("data-org-template");
  await throttle();
  await clickUntilUrl(op, orgRow.getByRole("link", { name: "Назначить" }), new RegExp(`/checklists/assignments\\?template=${out.templateId}`));
  await settle(op);
  const dialog = op.locator("[data-assignment-dialog]");
  await dialog.waitFor({ timeout: 120_000 });
  out.dialogTemplate = (await dialog.locator('[data-field="template"]').innerText()).trim();
  if (!out.dialogTemplate.includes(out.sanpinTitle)) problem(`в окне шаблон «${out.dialogTemplate}»`);
  else ok("окно «Назначить чек-лист» открыто с выбранным шаблоном");

  const pickTarget = async (label) => {
    await dialog.locator('[data-picker="target"]').click();
    const search = op.getByPlaceholder("Найти точку, должность или имя");
    await search.fill(label);
    await op.locator('[data-picker-item^="position:"]').filter({ hasText: new RegExp(`^${label}`) }).first().click();
    await op.waitForTimeout(300);
  };
  // Сначала — должность, где есть человек без доступа и без Telegram: видны оба предупреждения.
  await pickTarget("Официант 2 смена");
  out.warningTargetHint = (await dialog.locator("[data-live-hint]").innerText()).trim();
  out.warnAccess = await dialog.locator('[data-warning="access"]').isVisible();
  out.warnTelegram = await dialog.locator('[data-warning="telegram"]').isVisible();
  await shot(op, "flow-03-dialog-warnings", false);
  if (!out.warnAccess || !out.warnTelegram) problem(`предупреждения: доступ ${out.warnAccess}, Telegram ${out.warnTelegram}`);
  else ok("предупреждения о доступе и Telegram видны, со ссылками");
  out.warnLinks = await dialog.locator("[data-warning] a").evaluateAll((els) => els.map((el) => el.getAttribute("href")));

  // Теперь повар горячего цеха, ежедневно, до срока; проверяет заведующая.
  await pickTarget("Повар горячего цеха");
  await dialog.locator('[data-frequency="daily"]').click();
  await dialog.locator('[data-field="dueTime"]').fill(dueTime);
  await dialog.locator('[data-picker="verifier"]').click();
  await op.getByPlaceholder("Найти по имени или должности").fill("Морозов");
  await op.locator("[data-picker-item]").filter({ hasText: "Морозов" }).first().click();
  await op.waitForTimeout(300);
  out.liveHint = (await dialog.locator("[data-live-hint]").innerText()).trim();
  await shot(op, "flow-04-dialog-cook", false);
  if (!/Получат: 1 человек/.test(out.liveHint) || !out.liveHint.includes("Волкова")) problem(`живая подсказка: ${out.liveHint}`);
  else ok(`живая подсказка: ${out.liveHint.split("\n")[0]}`);
  await dialog.locator('[data-action="save-assignment"]').click();
  await dialog.waitFor({ state: "detached", timeout: 120_000 }).catch(() => {});
  await settle(op);
  const row = op.locator("[data-assignment]").filter({ hasText: out.sanpinTitle }).first();
  out.assignmentId = await row.getAttribute("data-assignment");
  out.rowText = (await row.innerText()).replace(/\s+/g, " ");
  await shot(op, "flow-05-owner-assignments");
  if (!out.assignmentId || !out.rowText.includes(`Ожидает до ${dueTime}`)) problem(`строка назначения: ${out.rowText}`);
  else ok(`назначение создано: ${out.rowText.slice(0, 160)}`);

  // 3. dryRun напоминаний: получатель — повар (фальшивый chat id выставлен в базе до запуска).
  const dry = await op.request.get(`${BASE}/api/cron/checklist-reminders?dryRun=1`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  out.cronDryRunBefore = await dry.json();
  const planned = (out.cronDryRunBefore.reminders ?? []).find((item) => item.assignmentId === out.assignmentId);
  if (!planned || !planned.recipients.some((r) => r.name.includes("Волкова"))) problem(`dryRun: ${JSON.stringify(out.cronDryRunBefore)}`);
  else ok(`dryRun: напоминание ${planned.periodKey} → ${planned.recipients.map((r) => r.name).join(", ")}`);
  await owner.close();

  // 4. Повар: «Назначено вам» → начать → ответы → «Завершить проверку».
  console.log("== flow: повар проводит проверку");
  const cook = await newContext(browser, "desktop");
  const cp = await cook.newPage();
  watchErrors(cp, "cook");
  await signIn(cook, cp, "cook");
  await goto(cp, `/checklists/templates?assignment=${out.assignmentId}`);
  const assigned = cp.locator(`[data-assigned="${out.assignmentId}"]`);
  out.cookAssignedBefore = (await assigned.innerText().catch(() => "")).replace(/\s+/g, " ");
  await shot(cp, "flow-06-cook-assigned");
  if (!out.cookAssignedBefore.includes("Ожидает")) problem(`у повара «Назначено вам»: ${out.cookAssignedBefore}`);
  else ok(`у повара «Назначено вам»: ${out.cookAssignedBefore}`);
  await throttle();
  if (!(await clickUntilUrl(cp, assigned.getByRole("button", { name: /Начать проверку|Продолжить проверку/ }), "**/checklists/inspections/**"))) throw new Error("«Начать проверку» не открыла проверку");
  out.inspectionId = cp.url().split("/").pop();
  await settle(cp);
  const loaded = await (await cp.request.get(`${BASE}/api/checklists/inspections/${out.inspectionId}`)).json();
  out.inspectionAssignmentId = loaded.inspection.assignmentId;
  if (out.inspectionAssignmentId !== out.assignmentId) problem(`проверка без назначения: ${out.inspectionAssignmentId}`);
  else ok("проверка создана с привязкой к назначению");
  const snapshot = checklistDefinitionSchema.parse(loaded.inspection.snapshot);
  const definition = expandChecklistDefinition(snapshot, checklistInstancesSchema.parse(loaded.inspection.categoryInstances ?? {}));
  const answers = cleanAnswers(definition);
  const localErrors = validateChecklistRun(definition, answers, {}, true);
  out.answerCount = Object.keys(answers).length;
  out.localErrors = localErrors;
  out.localResult = evaluateChecklistRun(definition, answers).score;
  const saved = await cp.request.patch(`${BASE}/api/checklists/inspections/${out.inspectionId}`, {
    data: { answers, evidence: {}, categoryInstances: {}, complete: false, updatedAt: loaded.inspection.updatedAt },
  });
  out.draftSave = saved.status();
  if (saved.status() !== 200) problem(`черновик: ${saved.status()} ${await saved.text()}`);
  else ok(`черновик сохранён: ${out.answerCount} ответов (форма проверки — существующая, ответы — тем же API)`);
  await goto(cp, `/checklists/inspections/${out.inspectionId}`);
  await throttle();
  await cp.getByRole("button", { name: "Завершить проверку" }).click();
  await cp.getByText("Завершённая проверка").waitFor({ timeout: 120_000 }).catch(() => {});
  await settle(cp);
  out.completedHeader = await cp.getByText("Завершённая проверка").isVisible().catch(() => false);
  await shot(cp, "flow-07-cook-completed", false);
  if (!out.completedHeader) problem("проверка не завершилась кнопкой «Завершить проверку»");
  else ok("повар завершил проверку кнопкой «Завершить проверку»");
  await goto(cp, "/checklists/templates");
  out.cookAssignedAfter = (await cp.locator(`[data-assigned="${out.assignmentId}"]`).innerText().catch(() => "")).replace(/\s+/g, " ");
  await shot(cp, "flow-08-cook-assigned-done");
  if (!out.cookAssignedAfter.includes("Выполнено")) problem(`после проверки у повара: ${out.cookAssignedAfter}`);
  else ok(`у повара статус: ${out.cookAssignedAfter}`);
  await cook.close();

  // 5. Заведующая (проверяющая): видит результат и «Принять результат».
  console.log("== flow: заведующая принимает результат");
  const chef = await newContext(browser, "desktop");
  const hp = await chef.newPage();
  watchErrors(hp, "headchef");
  await signIn(chef, hp, "headchef");
  await goto(hp, `/checklists/results?inspection=${out.inspectionId}`);
  const resultRow = hp.locator(`[data-inspection="${out.inspectionId}"]`);
  out.chefRowBefore = (await resultRow.innerText().catch(() => "")).replace(/\s+/g, " ");
  await shot(hp, "flow-09-chef-results");
  if (!(await resultRow.locator('[data-action="review"]').isVisible().catch(() => false))) problem(`у заведующей нет «Принять результат»: ${out.chefRowBefore}`);
  else ok(`заведующая видит результат: ${out.chefRowBefore.slice(0, 160)}`);
  await resultRow.locator('[data-action="review"]').click();
  await resultRow.locator("[data-reviewed]").waitFor({ timeout: 120_000 }).catch(() => {});
  out.chefRowAfter = (await resultRow.innerText().catch(() => "")).replace(/\s+/g, " ");
  await shot(hp, "flow-10-chef-reviewed");
  if (!/Принято: Морозов/.test(out.chefRowAfter)) problem(`после «Принять»: ${out.chefRowAfter}`);
  else ok("результат принят: отметка в списке");
  await goto(hp, `/checklists/inspections/${out.inspectionId}`);
  out.chefInspectionBar = (await hp.locator("[data-review-bar]").innerText().catch(() => "")).trim();
  await shot(hp, "flow-11-chef-inspection", false);
  if (!out.chefInspectionBar.startsWith("Результат принят")) problem(`полоса на проверке: ${out.chefInspectionBar}`);
  else ok(`на странице проверки: ${out.chefInspectionBar}`);
  await chef.close();

  // 6. Руководитель: статус «Выполнено»; dryRun больше не напоминает.
  const owner2 = await newContext(browser, "desktop");
  const op2 = await owner2.newPage();
  await signIn(owner2, op2, "owner");
  await goto(op2, "/checklists/assignments");
  out.rowAfter = (await op2.locator(`[data-assignment="${out.assignmentId}"]`).innerText().catch(() => "")).replace(/\s+/g, " ");
  await shot(op2, "flow-12-owner-assignments-done");
  if (!out.rowAfter.includes("Выполнено")) problem(`статус назначения после проверки: ${out.rowAfter}`);
  else ok("у руководителя статус назначения «Выполнено»");
  const dryAfter = await op2.request.get(`${BASE}/api/cron/checklist-reminders?dryRun=1`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  out.cronDryRunAfter = await dryAfter.json();
  if ((out.cronDryRunAfter.reminders ?? []).some((item) => item.assignmentId === out.assignmentId)) problem("dryRun после выполнения всё ещё напоминает");
  else ok("dryRun после выполнения: напоминания по назначению нет");
  await owner2.close();
  return out;
}

// ---- manage: пауза/включить, правка, удаление, дедупликация, фильтры ----------
async function dbClient() {
  const env = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  const url = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)[1];
  if (!/wesetup_pages_checklists/.test(url) || /:5433\//.test(url)) throw new Error("не та база");
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: url.replace("localhost", "127.0.0.1") });
  await client.connect();
  return client;
}

async function scenarioManage(browser) {
  const out = {};
  const context = await newContext(browser, "desktop");
  const page = await context.newPage();
  watchErrors(page, "owner/manage");
  await signIn(context, page, "owner");
  const templates = await (await page.request.get(`${BASE}/api/checklists/templates`)).json();
  const template = templates.templates[0];
  const db = await dbClient();
  try {
    const cookUser = (await db.query(`select id from "User" where email = 'hotcook1@haccp.local'`)).rows[0].id;
    const created = await page.request.post(`${BASE}/api/checklists/assignments`, {
      data: { templateId: template.id, targetKind: "user", targetId: cookUser, frequency: "daily", dueTime: moscowDue(), verifierUserId: null, remindTelegram: true },
    });
    out.createStatus = created.status();
    const id = (await created.json()).assignment?.id;
    out.assignmentId = id;
    const dry = async () => (await (await page.request.get(`${BASE}/api/cron/checklist-reminders?dryRun=1`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })).json()).reminders ?? [];
    const first = (await dry()).find((item) => item.assignmentId === id);
    out.dryRunFirst = first ?? null;
    if (!first) problem("manage: dryRun не видит нового назначения");
    // Крон уже отметил этот период — повтор не напоминает (условие в маршруте, без отправки).
    await db.query(`update "ChecklistAssignment" set "lastReminderPeriodKey" = $1 where id = $2`, [first?.periodKey ?? "x", id]);
    out.dryRunAfterMark = (await dry()).find((item) => item.assignmentId === id) ?? null;
    if (out.dryRunAfterMark) problem("manage: после отметки периода dryRun снова напоминает");
    else ok(`manage: период ${first?.periodKey} отмечен — повторного напоминания нет`);

    await goto(page, "/checklists/assignments");
    const row = page.locator(`[data-assignment="${id}"]`);
    await row.locator('[data-action="toggle"]').click();
    await row.getByText("На паузе").waitFor({ timeout: 120_000 }).catch(() => {});
    out.paused = await row.getByText("На паузе").isVisible().catch(() => false);
    await shot(page, "manage-01-paused", false);
    out.dryRunPaused = (await dry()).some((item) => item.assignmentId === id);
    await row.locator('[data-action="toggle"]').click();
    await row.getByText("На паузе").waitFor({ state: "detached", timeout: 120_000 }).catch(() => {});
    out.resumed = !(await row.getByText("На паузе").isVisible().catch(() => false));
    if (!out.paused || !out.resumed || out.dryRunPaused) problem(`manage: пауза ${out.paused}, включение ${out.resumed}, dryRun на паузе ${out.dryRunPaused}`);
    else ok("manage: «Пауза» → «На паузе» (dryRun молчит) → «Включить»");

    await row.getByRole("button", { name: "Изменить" }).click();
    const dialog = page.locator("[data-assignment-dialog]");
    await dialog.waitFor({ timeout: 60_000 });
    await dialog.locator('[data-frequency="weekly"]').click();
    await page.waitForTimeout(300);
    await shot(page, "manage-02-edit-weekly", false);
    await dialog.locator('[data-action="save-assignment"]').click();
    await dialog.waitFor({ state: "detached", timeout: 120_000 }).catch(() => {});
    await row.getByText(/Каждую неделю/).waitFor({ timeout: 120_000 }).catch(() => {});
    out.rowAfterEdit = (await row.innerText().catch(() => "")).replace(/\s+/g, " ");
    if (!/Каждую неделю/.test(out.rowAfterEdit)) problem(`manage: правка не сохранилась: ${out.rowAfterEdit}`);
    else ok(`manage: правка сохранена: ${out.rowAfterEdit.slice(0, 140)}`);

    await row.getByRole("button", { name: /Удалить/ }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: "Удалить назначение?" });
    await confirm.waitFor({ timeout: 60_000 });
    await shot(page, "manage-03-confirm-delete", false);
    await confirm.getByRole("button", { name: "Удалить", exact: true }).click();
    await page.getByText(/Назначение удалено/).first().waitFor({ timeout: 60_000 }).catch(() => {});
    out.deleteToast = await page.getByText(/Назначение удалено/).first().innerText().catch(() => "");
    await row.waitFor({ state: "detached", timeout: 120_000 }).catch(() => {});
    out.rowGone = !(await row.isVisible().catch(() => false));
    if (!out.rowGone || !out.deleteToast) problem(`manage: удаление: строка ушла ${out.rowGone}, тост «${out.deleteToast}»`);
    else ok(`manage: удалено через ConfirmDialog, тост «${out.deleteToast}»`);
  } finally {
    await db.end();
  }

  // Результаты: фильтры.
  await goto(page, "/checklists/results");
  out.resultsCount = await page.locator("[data-inspection]").count();
  await page.locator('[data-filter="violations"]').click();
  await page.waitForURL(/violations=1/, { timeout: 60_000 }).catch(() => {});
  await settle(page);
  out.violationsUrl = new URL(page.url()).search;
  out.violationsCount = await page.locator("[data-inspection]").count();
  out.violationsEmpty = await page.locator("[data-checklist-empty]").innerText().catch(() => "");
  await shot(page, "manage-04-results-violations");
  await page.locator('[data-period="all"]').click();
  await page.waitForURL(/period=all/, { timeout: 60_000 }).catch(() => {});
  await settle(page);
  out.periodUrl = new URL(page.url()).search;
  if (!out.violationsUrl.includes("violations=1") || !out.periodUrl.includes("period=all")) problem(`manage: фильтры ${out.violationsUrl} / ${out.periodUrl}`);
  else ok(`manage: фильтры в адресе: ${out.periodUrl}; всего ${out.resultsCount}, с нарушениями ${out.violationsCount}`);
  await context.close();
  return out;
}

// ---- pages: роли × ширины × Mini App ------------------------------------------
async function scenarioPages(browser) {
  const out = {};
  const pages = ["/checklists/templates", "/checklists", "/checklists/assignments", "/checklists/results"];
  for (const role of ["owner", "headchef", "cook"]) {
    for (const kind of ["desktop", "phone", "mini"]) {
      const tag = `${role}-${kind === "desktop" ? "1440" : kind === "phone" ? "390" : "mini"}`;
      console.log(`== pages ${tag}`);
      const context = await newContext(browser, kind === "desktop" ? "desktop" : "phone");
      const page = await context.newPage();
      watchErrors(page, tag);
      await signIn(context, page, role, kind === "mini");
      for (const href of pages) {
        const response = await goto(page, href);
        const finalPath = new URL(page.url()).pathname;
        const h1 = await page.locator("main h1, h1").first().innerText().catch(() => "");
        const overflow = await horizontalOverflow(page);
        const items = kind === "desktop" ? await sidebarItems(page) : [];
        const key = `${tag} ${href}`;
        out[key] = { status: response?.status(), finalPath, h1, overflow, items: items.map((item) => `${item.id}${item.current ? "*" : ""}`) };
        if (response?.status() !== 200) problem(`${key}: HTTP ${response?.status()}`);
        if (overflow > 1) problem(`${key}: горизонтальная прокрутка ${overflow}px`);
        const name = `page-${tag}-${href.split("/").filter(Boolean).join("-")}`;
        await shot(page, name, kind !== "desktop");
        ok(`${key} → ${finalPath} «${h1}» overflow ${overflow}${items.length ? ` меню ${out[key].items.join(",")}` : ""}`);
      }
      if (kind === "desktop") {
        // У повара один раздел — сайдбара нет (правило кабинета `showSidebar`), переходы — ссылками на страницах.
        const want = role === "owner" ? "templates,builder,assignments,results" : role === "headchef" ? "templates,builder,results" : "";
        const got = out[`${tag} /checklists/templates`].items.map((id) => id.replace("*", "")).join(",");
        if (got !== want) problem(`${tag}: меню ${got || "(нет)"}, ждали ${want || "(нет)"}`);
        else ok(`${tag}: меню раздела ${got || "(сайдбара нет — один раздел)"}`);
        for (const [href, item] of [["/checklists/templates", "templates"], ["/checklists", "builder"], ["/checklists/assignments", "assignments"], ["/checklists/results", "results"]]) {
          const current = out[`${tag} ${href}`].items.filter((id) => id.endsWith("*")).map((id) => id.replace("*", ""));
          if (want && out[`${tag} ${href}`].finalPath === href && current.join(",") !== item) problem(`${tag} ${href}: подсвечено ${current.join(",") || "ничего"}`);
        }
        if (role !== "owner" && out[`${tag} /checklists/assignments`].finalPath !== "/checklists/templates") problem(`${tag}: «Назначение» открылось`);
        await goto(page, "/checklists/templates");
        out[`${tag} header-links`] = await page.locator('[data-checklists-page="templates"] a[href^="/checklists"]').evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("href").split("?")[0]))]).catch(() => []);
        ok(`${tag}: ссылки по разделу на «Шаблонах»: ${out[`${tag} header-links`].join(", ")}`);
      }
      if (kind === "mini") {
        await goto(page, "/checklists/templates");
        const button = page.locator("[data-section-menu-button]");
        if (role === "cook") {
          out[`${tag} section-menu`] = (await button.isVisible().catch(() => false)) ? "есть кнопка" : "нет кнопки (один раздел)";
          ok(`${tag}: ${out[`${tag} section-menu`]}`);
        } else if (await button.isVisible().catch(() => false)) {
          await button.click();
          await page.waitForTimeout(800);
          await shot(page, `page-${tag}-section-menu`, false);
          out[`${tag} section-menu`] = await page.locator('[role="dialog"] a, [data-section-menu-sheet] a').allInnerTexts().catch(() => []);
          ok(`${tag}: меню раздела в Mini App: ${out[`${tag} section-menu`].join(" / ")}`);
        } else {
          out[`${tag} section-menu`] = "нет кнопки";
          problem(`${tag}: нет кнопки меню раздела`);
        }
      }
      await context.close();
    }
  }
  return out;
}

const browser = await launch();
try {
  for (const name of ONLY) {
    const started = Date.now();
    const scenario = { api: scenarioApi, flow: scenarioFlow, manage: scenarioManage, pages: scenarioPages }[name];
    if (!scenario) continue;
    try {
      results[name] = await scenario(browser);
    } catch (error) {
      problem(`${name}: ${error.message}`);
      results[name] = { error: error.message };
    }
    fs.writeFileSync(path.join(RAW, `results-${name}.json`), JSON.stringify({ ...results[name], seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
  }
} finally {
  await browser.close();
}
results.problems = problems;
results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(RAW, `results-${ONLY.join("-")}.summary.json`), JSON.stringify({ problems, startedAt: results.startedAt, finishedAt: results.finishedAt }, null, 2));
console.log(problems.length ? `\nПРОБЛЕМ: ${problems.length}` : "\nВсё в порядке");
process.exit(problems.length ? 1 : 0);
