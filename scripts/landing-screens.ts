/**
 * `npm run screens:landing` — снимки кабинета для слайдера «Кабинет
 * руководителя» на главной (и картинки на «О нас»).
 *
 * Только локальная демо-база — на проде данные клиентов. Порядок:
 *   1. Пустая база PostgreSQL на localhost, `.env` с ней (`DATABASE_URL`) и с
 *      пустыми ключами Telegram/DaData/Tuya; `npx prisma db push`.
 *   2. `npm run dev` с этим же `.env` (по умолчанию http://localhost:3000;
 *      другой адрес — `SCREENS_BASE`).
 *   3. `npm run screens:landing -- --seed` — первый раз, с сидами; дальше
 *      можно без `--seed` (шаги повторяемы: «сегодня» обновится, лишнего не
 *      добавится).
 * Снимки — в `public/landing/screens/<дата>/` (`--out` — другая папка).
 * Потом поменять `SHOWCASE_SCREENS_DIR` (src/components/landing/showcase-screens.ts)
 * и удалить прежнюю папку: картинки `/landing/*` кэшируются на неделю без
 * хеша, новая съёмка — новая папка.
 *
 * Что снимается: «Столовая «Берёзка»» (18 журналов столовой, записи за месяц,
 * мониторинг ~67 %) — Сводка, Мониторинг, Журналы, журнал холодильников,
 * QR-коды, «Пришла проверка»; «Сотрудники» — вымышленная «ООО «Пример»» с
 * нейтральными должностями (docs/brand-content.md). Подробно —
 * `.agent/tasks/landing-screens-tariffs-2026-11-21/screens.md`.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import bcrypt from "bcryptjs";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright";
import sharp from "sharp";

import { evaluateChecklistRun } from "@/lib/custom-checklist-runtime";
import { allChecklistQuestions, checklistDefinitionSchema, type ChecklistAnswers } from "@/lib/custom-checklists";
import { db } from "@/lib/db";
import { AUTOMATION_ALL_ON } from "@/lib/journal-controls";
import { updateJournalControls } from "@/lib/journal-controls.server";
import { isSignificantHazard } from "@/lib/ppk/haccp";

const BASE = (process.env.SCREENS_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const ARGS = process.argv.slice(2);
const SEED = ARGS.includes("--seed");
const OUT_ARG = ARGS[ARGS.indexOf("--out") + 1];
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
const OUT = path.resolve(ARGS.includes("--out") && OUT_ARG ? OUT_ARG : `public/landing/screens/${TODAY}`);
const TMP = path.join(OUT, ".png");

const FOOD = { email: "admin@haccp.local", password: "admin1234", org: "Столовая «Берёзка»" };
const NEUTRAL = { email: "owner@example.local", password: "demo12345", org: "ООО «Пример»" };
/** 18 журналов столовой; остальные — в `disabledJournalCodes`. */
const FOOD_JOURNALS = [
  "hygiene", "health_check", "general_cleaning", "equipment_maintenance", "finished_product", "perishable_rejection",
  "daily_samples", "incoming_control", "vitaminization", "staff_training", "cleaning", "pest_control",
  "disinfectant_usage", "fryer_oil", "uv_lamp_runtime", "cold_equipment_control", "climate_control", "med_books",
];
/** Полевые журналы: записи за сегодня для «Мониторинга» после снимка «Сегодня». */
const FIELD_JOURNALS = ["daily_samples", "incoming_control", "disinfectant_usage", "staff_training", "vitaminization", "finished_product"];
const TYPICAL_CHECKLISTS = ["sanpin", "haccp", "territorial-manager"];

/** Служебное поверх кабинета, которого в рекламном кадре быть не должно. */
const HIDE_CSS = `nextjs-portal, [data-bug-report-ignore], [data-fab-dock], [data-testid="today-next-sticky"] { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }`;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const MOBILE: BrowserContextOptions = { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

function step(message: string) {
  console.log(`\n→ ${message}`);
}

function guard() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Нет DATABASE_URL");
  const host = new URL(raw).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Съёмка — только на локальной демо-базе, а DATABASE_URL указывает на ${host}`);
  }
}

function seed() {
  for (const file of ["prisma/seed.ts", "prisma/seed-haccp-demo.ts", "prisma/seed.ts", "prisma/seed-job-positions.ts"]) {
    step(`сид ${file}`);
    const result = spawnSync("npx", ["tsx", file], { stdio: "inherit", env: process.env });
    if (result.status !== 0) throw new Error(`${file} завершился с кодом ${result.status}`);
  }
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    // Браузер этой версии Playwright не скачан — берём установленный Chromium.
    const fallback = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
    if (!existsSync(fallback)) throw error;
    return chromium.launch({ executablePath: fallback });
  }
}

/** Вход, принятие обновлённых условий; состояние сессии — для контекстов съёмки. */
async function login(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 300_000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator("button[type=submit]").last().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 300_000 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 300_000 });
  await page.waitForTimeout(3000);
  const terms = page.locator("[role=dialog]").filter({ hasText: /условия/i });
  if (await terms.count()) {
    await terms.locator("input[type=checkbox], button[role=checkbox]").first().click();
    await terms.getByRole("button", { name: /Принять/ }).click();
    await page.waitForTimeout(2000);
  }
  return { ctx, page };
}

async function api(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ([method, url, body]) => {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        // текстовый ответ
      }
      return { status: response.status, json };
    },
    [method, url, body] as const,
  );
}

async function ensureBuilding(page: Page, organizationId: string, name: string, address: string) {
  const existing = await db.building.findFirst({ where: { organizationId, kind: "point" } });
  if (existing) return existing.id;
  const result = await api(page, "POST", "/api/settings/buildings", { name, address, sortOrder: 0 });
  const id = (result.json as { building?: { id: string } }).building?.id;
  if (!id) throw new Error(`Объект не создан: ${result.status} ${JSON.stringify(result.json)}`);
  return id;
}

/** Снимок одного экрана на ПК и на телефоне. `scroll` — px или `text:Надпись`. */
async function capture(browser: Browser, state: Awaited<ReturnType<BrowserContext["storageState"]>>, id: string, route: string, scroll: { desktop?: number | string; mobile?: number | string } = {}) {
  for (const [variant, options] of [["desktop", DESKTOP], ["mobile", MOBILE]] as const) {
    const ctx = await browser.newContext({ ...options, storageState: state, reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Moscow" });
    const page = await ctx.newPage();
    await page.goto(BASE + route, { waitUntil: "load", timeout: 300_000 });
    await page.waitForTimeout(4000);
    await page.addStyleTag({ content: HIDE_CSS });
    await page.evaluate(() => {
      for (const link of document.querySelectorAll<HTMLElement>("header a")) {
        const label = (link.getAttribute("aria-label") || link.getAttribute("title") || link.textContent || "").trim();
        if (label === "MAX") link.style.display = "none";
      }
    });
    const target = scroll[variant] ?? 0;
    await page.evaluate((target) => {
      if (typeof target === "number") {
        window.scrollTo(0, target);
        return;
      }
      const wanted = target.replace(/^text:/, "");
      const element = [...document.querySelectorAll("main *")].find((node) => node.childElementCount === 0 && node.textContent?.trim() === wanted);
      const header = document.querySelector("header");
      const offset = header && getComputedStyle(header).position !== "static" ? header.getBoundingClientRect().height : 0;
      if (element) window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - offset - 20);
    }, target);
    await page.waitForTimeout(1200);
    const png = path.join(TMP, `${id}-${variant}.png`);
    await page.screenshot({ path: png });
    const webp = path.join(OUT, `${id}-${variant}.webp`);
    const image = sharp(png);
    if (variant === "desktop") await image.resize(2400, 1500).webp({ quality: 78 }).toFile(webp);
    else await image.webp({ quality: 80 }).toFile(webp);
    console.log(`  ${path.relative(process.cwd(), webp)}`);
    await ctx.close();
  }
}

async function prepareFood(page: Page, organizationId: string) {
  step("организация «Столовая «Берёзка»», 18 журналов столовой");
  const templates = await db.journalTemplate.findMany({ select: { code: true } });
  await db.organization.update({
    where: { id: organizationId },
    data: { name: FOOD.org, disabledJournalCodes: templates.map((item) => item.code).filter((code) => !FOOD_JOURNALS.includes(code)) },
  });
  step("журналы: кабинет заводит документы при первом открытии");
  for (const code of FOOD_JOURNALS) {
    await page.goto(`${BASE}/journals/${code}`, { waitUntil: "load", timeout: 300_000 });
    await page.waitForTimeout(2500);
  }
  return ensureBuilding(page, organizationId, FOOD.org, "г. Москва, ул. Садовая, д. 12");
}

/** Записи за месяц: автоматика догоняет период по сегодня, потом снимается. */
async function backfill(page: Page, organizationId: string) {
  step("записи за месяц (автозаполнение по сегодня)");
  await updateJournalControls(organizationId, { automation: { ...AUTOMATION_ALL_ON } });
  await db.organization.update({
    where: { id: organizationId },
    data: { journalAutomationJson: Object.fromEntries(FOOD_JOURNALS.map((code) => [code, { autoCreate: true, autoFill: true }])) },
  });
  await db.journalDocument.updateMany({ where: { organizationId, status: "active" }, data: { autoFill: true } });
  for (const code of FOOD_JOURNALS) {
    const result = await api(page, "POST", "/api/organizations/auto-journals/apply", { code });
    if (result.status === 200) console.log(`  ${code}: ${JSON.stringify(result.json)}`);
  }
  // Автоматика журналов снята, спецрежим оставлен: на «Сегодня» видна «Автозаполнить».
  await db.organization.update({ where: { id: organizationId }, data: { journalAutomationJson: {} } });
  await db.journalDocument.updateMany({ where: { organizationId }, data: { autoFill: false } });
}

/** «Мониторинг»: записи полевых журналов, ППК и проведённые чек-листы за сегодня. */
async function monitoringData(page: Page, organizationId: string, buildingId: string, ownerId: string) {
  step("мониторинг: записи полевых журналов за сегодня");
  const filledToday = await db.journalEntry.findMany({
    where: { organizationId, createdAt: { gte: new Date(`${TODAY}T00:00:00+03:00`) } },
    select: { template: { select: { code: true } } },
  });
  const already = new Set(filledToday.map((entry) => entry.template.code));
  const templates = await db.journalTemplate.findMany({ where: { code: { in: FIELD_JOURNALS } }, select: { code: true, fields: true } });
  for (const template of templates) {
    if (already.has(template.code)) continue;
    const data: Record<string, unknown> = {};
    for (const field of (template.fields ?? []) as Array<{ key: string; type: string; options?: Array<{ value: string }> }>) {
      data[field.key] =
        field.type === "select" ? field.options?.[0]?.value ?? ""
        : field.type === "date" ? TODAY
        : field.type === "number" ? 1
        : field.type === "boolean" ? true
        : field.type === "employee" ? ownerId
        : field.type === "time" ? "10:30"
        : "Без замечаний";
    }
    const result = await api(page, "POST", "/api/journals", { templateCode: template.code, data });
    console.log(`  ${template.code}: ${result.status}`);
  }

  step("мониторинг: ППК — стартовый набор, группа ХАССП, политика, решения по опасностям");
  if ((await db.ppkRecord.count({ where: { organizationId, block: "products" } })) === 0) {
    await api(page, "POST", "/api/production-control/starter", { kind: "canteen" });
  }
  if ((await db.ppkRecord.count({ where: { organizationId, block: "team" } })) === 0) {
    const leaders = await db.user.findMany({ where: { organizationId, isActive: true, role: { in: ["technologist", "manager"] } }, orderBy: { role: "desc" }, take: 3 });
    const roles = ["leader", "deputy", "member"] as const;
    for (const [index, user] of leaders.entries()) {
      await api(page, "POST", "/api/production-control/records", { block: "team", data: { userId: user.id, role: roles[index], duties: "Группа ХАССП" } });
    }
  }
  const policy = await db.ppkRecord.findFirst({ where: { organizationId, block: "policy" } });
  const policyData = (policy?.data ?? {}) as { text?: string; approvedAt?: string | null };
  if (policy && !policyData.approvedAt) {
    await api(page, "PATCH", `/api/production-control/records/${policy.id}`, { data: { text: policyData.text ?? "", approvedById: ownerId, approvedAt: TODAY } });
  }
  const hazards = await db.ppkRecord.findMany({ where: { organizationId, block: "hazards" }, orderBy: { sortOrder: "asc" } });
  const decided = new Set(
    (await db.ppkRecord.findMany({ where: { organizationId, block: "control-points" } })).map((row) => (row.data as { hazardId?: string }).hazardId),
  );
  const responsible = (await db.user.findFirst({ where: { organizationId, role: "technologist", isActive: true } }))?.id ?? ownerId;
  let critical = 0;
  for (const hazard of hazards) {
    const data = hazard.data as { probability: number; severity: number };
    if (!isSignificantHazard(data.probability, data.severity) || decided.has(hazard.id)) continue;
    // Две ККТ и две ОПП, остальное — программы предварительных условий.
    const kind = critical < 2 ? "ccp" : critical < 4 ? "oprp" : "prp";
    const number = kind === "ccp" ? `ККТ-${critical + 1}` : kind === "oprp" ? `ОПП-${critical - 1}` : "";
    critical += 1;
    await api(page, "POST", "/api/production-control/records", {
      block: "control-points",
      data: {
        hazardId: hazard.id, kind, answers: { q1: kind !== "prp", q2: kind === "ccp" ? true : null, q3: null, q4: null }, number,
        limits: kind === "prp" ? "" : "По технологической карте", monitoring: kind === "prp" ? "" : "Каждая партия", frequency: kind === "prp" ? "" : "Каждая партия",
        responsibleId: kind === "prp" ? null : responsible, corrective: kind === "prp" ? "" : "Остановить выдачу, разобрать причину",
        journalCode: null, limitMin: null, limitMax: null, unit: "",
      },
    });
  }

  step("мониторинг: чек-листы — типовые шаблоны, назначения на объект, проверки за сегодня");
  const templateIds: string[] = [];
  for (const key of TYPICAL_CHECKLISTS) {
    const result = await api(page, "POST", "/api/checklists/templates/typical", { key });
    const id = (result.json as { template?: { id: string } }).template?.id;
    if (id) templateIds.push(id);
  }
  let assignments = await db.checklistAssignment.findMany({ where: { organizationId, targetId: buildingId }, orderBy: { createdAt: "asc" } });
  if (assignments.length === 0) {
    const plan: Array<[number, "daily" | "weekly", string]> = [[0, "daily", "11:00"], [0, "daily", "20:00"], [1, "daily", "16:00"], [2, "daily", "18:00"], [1, "weekly", "17:00"], [2, "weekly", "19:00"]];
    const weekday = ((new Date(`${TODAY}T12:00:00+03:00`).getUTCDay() + 6) % 7) + 1;
    for (const [template, frequency, dueTime] of plan) {
      await api(page, "POST", "/api/checklists/assignments", {
        templateId: templateIds[template], targetKind: "building", targetId: buildingId, frequency, dueTime, remindTelegram: false,
        ...(frequency === "weekly" ? { weekday } : {}),
      });
    }
    assignments = await db.checklistAssignment.findMany({ where: { organizationId, targetId: buildingId }, orderBy: { createdAt: "asc" } });
  }
  // Созданное сегодня назначение сегодняшний период не считает — «создано» месяц назад.
  await db.checklistAssignment.updateMany({ where: { organizationId }, data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  for (const [index, assignment] of assignments.slice(0, 4).entries()) {
    const doneToday = await db.checklistInspection.count({ where: { assignmentId: assignment.id, status: "completed", completedAt: { gte: new Date(`${TODAY}T00:00:00+03:00`) } } });
    if (doneToday > 0) continue;
    const template = await db.checklistTemplate.findUniqueOrThrow({ where: { id: assignment.templateId } });
    const definition = checklistDefinitionSchema.parse(template.definition);
    const completedAt = new Date(Date.now() - (index + 1) * 40 * 60 * 1000);
    const answers: ChecklistAnswers = {};
    for (const question of allChecklistQuestions(definition)) {
      if (question.type === "yes_no") answers[question.id] = "yes";
      else if (question.type === "checkbox") answers[question.id] = true;
      else if (question.type === "number" || question.type === "scale") answers[question.id] = question.max;
      else if (question.type === "choice" && question.options[0]) answers[question.id] = question.options[0].value;
      else if (question.type === "multi" && question.options[0]) answers[question.id] = [question.options[0].value];
      else if (question.type === "datetime") answers[question.id] = completedAt.toISOString().slice(0, 16);
      else if (question.type === "text") answers[question.id] = "Без замечаний";
    }
    const result = evaluateChecklistRun(definition, answers);
    await db.checklistInspection.create({
      data: {
        organizationId, templateId: template.id, templateVersion: template.version, title: template.title,
        snapshot: template.definition ?? {}, answers, result: JSON.parse(JSON.stringify(result)),
        createdById: owner.id, createdByName: owner.name ?? "", assignmentId: assignment.id,
        status: "completed", completedAt, completedById: owner.id, completedByName: owner.name ?? "",
      },
    });
  }
}

/** «ООО «Пример»» для экрана «Сотрудники»: нейтральные должности, вымышленные люди. */
async function seedNeutral() {
  step("нейтральная организация для экрана «Сотрудники»");
  const positions = [
    { key: "lead", categoryKey: "management", name: "Руководитель", sortOrder: 0 },
    { key: "admin", categoryKey: "staff", name: "Администратор", sortOrder: 0 },
    { key: "specialist", categoryKey: "staff", name: "Специалист", sortOrder: 1 },
    { key: "cleaner", categoryKey: "staff", name: "Уборщик", sortOrder: 2 },
  ];
  const users = [
    { email: NEUTRAL.email, name: "Иванова Анна Сергеевна", role: "owner", position: "lead", phone: "+79000000000" },
    { email: "admin@example.local", name: "Петров Олег Викторович", role: "manager", position: "admin" },
    { email: "specialist@example.local", name: "Смирнова Елена Игоревна", role: "operator", position: "specialist" },
    { email: "cleaner1@example.local", name: "Кузнецова Ольга Петровна", role: "operator", position: "cleaner" },
    { email: "cleaner2@example.local", name: "Соколов Игорь Николаевич", role: "operator", position: "cleaner" },
    { email: "cleaner3@example.local", name: "Попова Мария Андреевна", role: "operator", position: "cleaner" },
  ];
  const passwordHash = await bcrypt.hash(NEUTRAL.password, 10);
  const organization =
    (await db.organization.findFirst({ where: { name: NEUTRAL.org } })) ??
    (await db.organization.create({ data: { name: NEUTRAL.org, type: "other", subscriptionPlan: "pro", subscriptionEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) } }));
  const ids = new Map<string, string>();
  for (const position of positions) {
    const row =
      (await db.jobPosition.findFirst({ where: { organizationId: organization.id, name: position.name } })) ??
      (await db.jobPosition.create({ data: { organizationId: organization.id, categoryKey: position.categoryKey, name: position.name, sortOrder: position.sortOrder } }));
    ids.set(position.key, row.id);
  }
  for (const user of users) {
    // Телефон владельца — без него кабинет просит «Завершите регистрацию».
    const data = { name: user.name, role: user.role, organizationId: organization.id, jobPositionId: ids.get(user.position)!, passwordHash, isActive: true, ...(user.phone ? { phone: user.phone } : {}) };
    await db.user.upsert({ where: { email: user.email }, update: data, create: { email: user.email, ...data } });
  }
  return organization.id;
}

async function main() {
  guard();
  const health = await fetch(`${BASE}/robots.txt`).catch(() => null);
  if (!health?.ok) throw new Error(`Кабинет не отвечает на ${BASE}: запустите npm run dev с той же базой (SCREENS_BASE — другой адрес)`);
  if (SEED) seed();
  mkdirSync(TMP, { recursive: true });
  const browser = await launch();
  try {
    const food = await db.user.findUniqueOrThrow({ where: { email: FOOD.email } });
    const { ctx, page } = await login(browser, FOOD.email, FOOD.password);
    const buildingId = await prepareFood(page, food.organizationId);
    await backfill(page, food.organizationId);
    const foodState = await ctx.storageState();
    step("съёмка: Сегодня, Журналы, журнал холодильников, QR-коды, Пришла проверка");
    await capture(browser, foodState, "dashboard", "/dashboard");
    await capture(browser, foodState, "journals", "/journals");
    const cold = await db.journalDocument.findFirstOrThrow({
      where: { organizationId: food.organizationId, status: "active", template: { code: "cold_equipment_control" } },
      select: { id: true },
    });
    await capture(browser, foodState, "grid", `/journals/cold_equipment_control/documents/${cold.id}`, { desktop: 290 });
    await capture(browser, foodState, "qr", "/settings/qr-posters?origin=https://wesetup.ru", { mobile: 330 });
    await capture(browser, foodState, "inspection", "/inspection");
    await monitoringData(page, food.organizationId, buildingId, food.id);
    step("съёмка: Мониторинг");
    await capture(browser, foodState, "monitoring", "/monitoring", { mobile: "text:Журналы" });
    await ctx.close();

    const neutralId = await seedNeutral();
    const neutral = await login(browser, NEUTRAL.email, NEUTRAL.password);
    await ensureBuilding(neutral.page, neutralId, "Филиал на Тверской", "г. Москва, ул. Тверская, д. 7");
    step("съёмка: Сотрудники");
    await capture(browser, await neutral.ctx.storageState(), "staff", "/settings/users");
    await neutral.ctx.close();
  } finally {
    await browser.close();
    rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\nГотово: ${path.relative(process.cwd(), OUT)}. Поменяйте SHOWCASE_SCREENS_DIR и удалите прежнюю папку.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
