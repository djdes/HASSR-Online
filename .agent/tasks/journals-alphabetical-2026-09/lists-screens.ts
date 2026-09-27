// «Журналы везде по алфавиту» — проверка на стенде 3021 (e2e-база).
// Один журнал e2e-организации временно переименован («Настройки → Названия»),
// чтобы доказать: переименованный встаёт по своему названию. Название
// возвращается в finally.
// Запуск: node --import tsx .agent/tasks/journals-alphabetical-2026-09/lists-screens.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { compareJournalNames } from "../../../src/lib/journal-sort";

const url = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
if (!/@localhost:5432\/wesetup_e2e\b/.test(url)) throw new Error("not e2e db");
const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: url })) });

const BASE = "http://localhost:3021";
const SHOTS = "d:/wt/tmp/alpha-lists";
const ORG_A = "e2e-org-a";
const RENAMED_CODE = "hygiene";
const RENAMED_TO = "Утренний осмотр поваров";

const HIDE_DEV =
  'try{localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){};' +
  'document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");' +
  's.textContent="nextjs-portal{display:none!important}";document.head.appendChild(s)})';

async function signIn(ctx: BrowserContext, email: string, password: string) {
  const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()) as { csrfToken: string };
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
  const cookies = await ctx.cookies(BASE);
  if (!cookies.some((c) => /session/i.test(c.name))) throw new Error(`sign-in failed for ${email}`);
}

/** Модалка «Мы обновили условия» закрывает экран — принимаем один раз (e2e-база). */
async function acceptTerms(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(1500);
  const box = page.getByRole("dialog").locator('input[type="checkbox"], button[role="checkbox"]').first();
  if (await box.count()) {
    await box.click();
    await page.getByRole("button", { name: "Принять и продолжить" }).click();
    await page.waitForTimeout(1500);
  }
  await page.close();
}

/**
 * Названия журналов в тексте страницы — в порядке появления. Если на
 * странице несколько списков (две тепловые карты в отчётах), каждый
 * начинается заново — это один «перелом» на список.
 */
async function namesInOrder(page: Page, known: Set<string>): Promise<string[]> {
  const text = await page.locator("main").first().innerText().catch(() => page.locator("body").innerText());
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (known.has(line) && out[out.length - 1] !== line) out.push(line);
  }
  return out;
}

/** Сколько раз порядок «ломается» — для списка без групп должно быть 0. */
function descents(names: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 1; i < names.length; i++) {
    if (compareJournalNames(names[i - 1], names[i]) > 0) out.push([names[i - 1], names[i]]);
  }
  return out;
}

type Screen = { key: string; path: string; groups: number; minNames?: number; open?: (page: Page) => Promise<void> };

async function shoot(browser: Browser, storage: string, screens: Screen[], known: Set<string>, prefix: string, out: Record<string, unknown>) {
  for (const [label, viewport] of [
    ["desktop", { width: 1366, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    const ctx = await browser.newContext({ storageState: storage, viewport });
    await ctx.addInitScript(HIDE_DEV);
    const page = await ctx.newPage();
    for (const screen of screens) {
      await page.goto(`${BASE}${screen.path}`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(1500);
      if (screen.open) await screen.open(page);
      const names = await namesInOrder(page, known);
      const breaks = descents(names);
      await page.screenshot({ path: `${SHOTS}/${prefix}-${screen.key}-${label}.png`, fullPage: false });
      if (label === "desktop") {
        out[`${prefix}:${screen.key}`] = { path: new URL(page.url()).pathname, count: names.length, breaks, first: names.slice(0, 6) };
        // Группы (обязательные/рекомендуем/остальные, заполнить/готово)
        // допускают по одному «перелому» на границе группы.
        assert.ok(breaks.length <= screen.groups - 1, `${prefix} ${screen.key}: не по алфавиту ${JSON.stringify(breaks)}`);
        if (screen.minNames) assert.ok(names.length >= screen.minNames, `${prefix} ${screen.key}: мало названий ${names.length}`);
      }
    }
    await ctx.close();
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { customNamesJson: true } });
  const original = org.customNamesJson;
  const out: Record<string, unknown> = {};
  const browser = await chromium.launch({ headless: true });
  try {
    const base = (original && typeof original === "object" && !Array.isArray(original) ? original : {}) as Record<string, unknown>;
    const journals = { ...((base.journals as Record<string, string>) ?? {}), [RENAMED_CODE]: RENAMED_TO };
    await db.organization.update({ where: { id: ORG_A }, data: { customNamesJson: { ...base, journals } } });
    const written = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { customNamesJson: true } });
    out.customNamesDuringRun = written.customNamesJson;

    const templates = await db.journalTemplate.findMany({ where: { isActive: true }, select: { code: true, name: true } });
    const known = new Set<string>([...templates.map((t) => t.name), ...Object.values(journals)]);
    const officialHygiene = templates.find((t) => t.code === RENAMED_CODE)?.name ?? "";

    // Вход один раз на пользователя — дальше storageState.
    const loginCtx = await browser.newContext();
    await signIn(loginCtx, "owner-a@e2e.local", "E2eTest2026!");
    const storageA = `${SHOTS}/.state-a.json`;
    await acceptTerms(loginCtx);
    await loginCtx.storageState({ path: storageA });

    // API: поиск и мини-приложение отдают журналы по алфавиту.
    const search = (await (await loginCtx.request.get(`${BASE}/api/search?q=${encodeURIComponent("журнал")}`)).json()) as {
      hits?: Array<{ kind: string; label: string }>;
    };
    const searchNames = (search.hits ?? []).filter((h) => h.kind === "template").map((h) => h.label);
    out.searchJournalHits = searchNames;
    assert.deepEqual(descents(searchNames), [], "поиск: журналы по алфавиту");
    const home = (await (await loginCtx.request.get(`${BASE}/api/mini/home`)).json()) as { all?: Array<{ name: string }> };
    const homeNames = (home.all ?? []).map((j) => j.name);
    out.miniHomeCount = homeNames.length;
    assert.deepEqual(descents(homeNames), [], "мини-приложение: журналы по алфавиту");
    const progress = (await (await loginCtx.request.get(`${BASE}/api/journals/today-status`)).json()) as { items?: Array<{ name: string }> };
    out.todayStatus = (progress.items ?? []).map((i) => i.name);
    assert.deepEqual(descents((progress.items ?? []).map((i) => i.name)), [], "today-status по алфавиту");
    const catchUp = (await (await loginCtx.request.get(`${BASE}/api/dashboard/catch-up`)).json()) as { rows?: Array<{ templateName: string }> };
    out.catchUp = (catchUp.rows ?? []).map((r) => r.templateName);
    assert.deepEqual(descents((catchUp.rows ?? []).map((r) => r.templateName)), [], "catch-up по алфавиту");
    await loginCtx.close();

    const ownerA = await db.user.findFirstOrThrow({ where: { email: "cook-a@e2e.local" }, select: { id: true } });

    // Переименованный журнал на /journals: стоит среди «У», не среди «Г».
    {
      const ctx = await browser.newContext({ storageState: storageA, viewport: { width: 1366, height: 900 } });
      await ctx.addInitScript(HIDE_DEV);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(1500);
      const names = await namesInOrder(page, known);
      out.journalsPage = names;
      assert.ok(names.includes(RENAMED_TO), "своё название на карточке");
      assert.ok(!names.includes(officialHygiene), "официальное название не показано");
      // Крошка-переключатель журналов на странице журнала.
      await page.goto(`${BASE}/journals/${RENAMED_CODE}`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(1500);
      const trigger = page.locator('nav[aria-label="Хлебные крошки"] [aria-haspopup]').last();
      out.switcherTriggers = await page.locator('nav[aria-label="Хлебные крошки"] [aria-haspopup]').count();
      await trigger.click();
      await page.waitForTimeout(800);
      const menuItems = await page.locator('[role="menuitem"]').allInnerTexts();
      const menuNames = menuItems.map((t) => t.split("\n")[0].trim()).filter((t) => known.has(t));
      out.switcherMenu = menuNames;
      await page.screenshot({ path: `${SHOTS}/a-switcher-desktop.png` });
      assert.ok(menuNames.includes(RENAMED_TO), "в переключателе своё название");
      assert.deepEqual(descents(menuNames), [], "переключатель журналов по алфавиту");
      await ctx.close();
    }

    const screens: Screen[] = [
      { key: "journals", path: "/journals", groups: 4, minNames: 5 },
      { key: "dashboard", path: "/dashboard", groups: 2 },
      { key: "settings-journals", path: "/settings/journals", groups: 3, minNames: 5 },
      { key: "journal-responsibles", path: "/settings/journal-responsibles", groups: 10 },
      { key: "journal-periods", path: "/settings/journal-periods", groups: 1, minNames: 5 },
      { key: "journal-bonuses", path: "/settings/journal-bonuses", groups: 1, minNames: 5 },
      { key: "journal-pipelines", path: "/settings/journal-pipelines", groups: 1, minNames: 5 },
      { key: "journals-by-position", path: "/settings/journals-by-position", groups: 1 },
      { key: "names", path: "/settings/names", groups: 1, minNames: 5 },
      { key: "auto-journals", path: "/settings/auto-journals", groups: 1 },
      { key: "journal-access", path: "/settings/journal-access", groups: 1 },
      { key: "journal-checklists", path: "/settings/journal-checklists", groups: 2 },
      { key: "journal-difficulty", path: "/settings/journal-difficulty", groups: 1 },
      { key: "journal-task-mode", path: "/settings/journal-task-mode", groups: 1 },
      { key: "staff-hierarchy", path: "/settings/staff-hierarchy", groups: 1 },
      { key: "workload-balance", path: "/settings/workload-balance", groups: 99 },
      { key: "onboarding", path: "/settings/onboarding", groups: 1 },
      // Тепловые карты ранжируют журналы по пропускам (аналитика «худшие
      // сверху»), по алфавиту — только при равенстве; выбор журнала в
      // выгрузке — по алфавиту.
      { key: "reports", path: "/reports", groups: 99 },
      { key: "catch-up", path: "/dashboard/catch-up", groups: 1 },
      { key: "journals-progress", path: "/journals-progress", groups: 3 },
      { key: "user-access", path: `/settings/users/${ownerA.id}/access`, groups: 1 },
      { key: "audit", path: "/settings/audit", groups: 1 },
    ];
    await shoot(browser, storageA, screens, known, "a", out);

    // Публичные страницы — без входа.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await ctx.newPage();
      for (const [key, path] of [["blanki", "/blanki"], ["calc", "/calc/journals"]] as const) {
        await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 300000 });
        await page.waitForTimeout(1000);
        const names = await namesInOrder(page, known);
        out[`public:${key}`] = { count: names.length, breaks: descents(names) };
        await page.screenshot({ path: `${SHOTS}/public-${key}-desktop.png` });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: `${SHOTS}/public-${key}-phone.png` });
        await page.setViewportSize({ width: 1366, height: 900 });
      }
      await ctx.close();
    }

    // Демо-организация: главные списки.
    {
      const loginDemo = await browser.newContext();
      await signIn(loginDemo, "owner@cafe-demo.local", "DemoShots2026!");
      await acceptTerms(loginDemo);
      const storageDemo = `${SHOTS}/.state-demo.json`;
      await loginDemo.storageState({ path: storageDemo });
      await loginDemo.close();
      await shoot(
        browser,
        storageDemo,
        [
          { key: "journals", path: "/journals", groups: 4, minNames: 5 },
          { key: "settings-journals", path: "/settings/journals", groups: 3, minNames: 5 },
        ],
        known,
        "demo",
        out,
      );
    }
    out.ok = true;
  } finally {
    await browser.close();
    await db.organization.update({
      where: { id: ORG_A },
      data: { customNamesJson: original === null ? Prisma.DbNull : (original as Prisma.InputJsonValue) },
    });
    const restored = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { customNamesJson: true } });
    out.customNamesRestored = JSON.stringify(restored.customNamesJson) === JSON.stringify(original);
    fs.writeFileSync(".agent/tasks/journals-alphabetical-2026-09/lists-screens.json", JSON.stringify(out, null, 2));
    for (const f of [".state-a.json", ".state-demo.json"]) fs.rmSync(`${SHOTS}/${f}`, { force: true });
    await db.$disconnect();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
