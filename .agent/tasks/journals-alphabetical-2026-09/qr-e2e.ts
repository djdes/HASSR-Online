// Страница «Настройки → QR-коды»: все списки по алфавиту (по видимому
// названию, в том числе переименованному), поиск как у журналов.
// Стенд 3022 на e2e-базе. Запуск:
//   node --import tsx .agent/tasks/journals-alphabetical-2026-09/qr-e2e.ts
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

import { compareJournalNames } from "../../../src/lib/journal-sort";

const url = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
if (!/@localhost:5432\/wesetup_e2e\b/.test(url)) throw new Error("not e2e db");
const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: url })) });

const BASE = "http://localhost:3022";
const SHOTS = "d:/wt/tmp/alpha-qr";
const ORG_A = "e2e-org-a";
const CUSTOM = "Аптечка — наш журнал";
const HIDE_DEV =
  "try{localStorage.setItem(\"page-guide:qr-posters-v2\",\"1\")}catch(e){};" +
  "document.addEventListener(\"DOMContentLoaded\",function(){var s=document.createElement(\"style\");" +
  "s.textContent=\"nextjs-portal,div:has(> [data-testid=legal-update-modal]){display:none!important}\";document.head.appendChild(s)})";
const DARK =
  "try{localStorage.setItem(\"wesetup-theme-mode\",\"dark\");localStorage.setItem(\"wesetup-app-theme\",\"dark\")}catch(e){}";

async function signIn(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext();
  const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()) as { csrfToken: string };
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
  const state = await ctx.storageState();
  await ctx.close();
  if (!state.cookies.some((c) => /session/i.test(c.name))) throw new Error(`sign-in failed: ${email}`);
  return state;
}

type State = Awaited<ReturnType<typeof signIn>>;

async function open(browser: Browser, state: State, width: number, height: number, path: string, dark = false) {
  const ctx: BrowserContext = await browser.newContext({ storageState: state, viewport: { width, height } });
  await ctx.addInitScript(HIDE_DEV);
  if (dark) await ctx.addInitScript(DARK);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForSelector("[data-qr-page]", { timeout: 300000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}

/** Названия карточек секции — первая строка подписи каждой карточки. */
async function labels(page: Page, section: string): Promise<string[]> {
  return page.$$eval(`[data-qr-section="${section}"] [data-qr-poster] label`, (nodes) =>
    nodes.map((node) => ((node as HTMLElement).innerText || "").split("\n")[0].trim())
  );
}

function assertSorted(list: string[], what: string) {
  for (let i = 1; i < list.length; i++) {
    assert.ok(compareJournalNames(list[i - 1], list[i]) <= 0, `${what}: «${list[i - 1]}» раньше «${list[i]}»`);
  }
}

async function chosen(page: Page): Promise<number> {
  const text = await page.locator("[data-qr-summary]").innerText();
  return Number(/Выбрано:\s*(\d+)/.exec(text)?.[1] ?? NaN);
}

async function search(page: Page, query: string) {
  await page.getByLabel("Поиск по QR-кодам").fill(query);
  await page.waitForTimeout(400);
}

async function main() {
  const out: Record<string, unknown> = {};
  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { customNamesJson: true, disabledJournalCodes: true } });
  const disabled = new Set((org.disabledJournalCodes as string[] | null) ?? []);
  // Переименовываем журнал, который по официальному названию стоит далеко
  // от начала алфавита: после переименования он должен встать первым.
  const templates = await db.journalTemplate.findMany({ where: { isActive: true }, select: { code: true, name: true } });
  const candidate = templates
    .filter((t) => !disabled.has(t.code) && !["hygiene", "health_check", "cold_equipment_control", "climate_control", "uv_lamp_runtime", "journal_fill_hub"].includes(t.code))
    .sort((a, b) => compareJournalNames(b.name, a.name))[0];
  out.renamed = { code: candidate.code, official: candidate.name, custom: CUSTOM };
  const current = (org.customNamesJson ?? {}) as { journals?: Record<string, string>; sections?: Record<string, string> };
  await db.organization.update({
    where: { id: ORG_A },
    data: { customNamesJson: { journals: { ...(current.journals ?? {}), [candidate.code]: CUSTOM }, sections: current.sections ?? {} } },
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const ownerA = await signIn(browser, "owner-a@e2e.local", "E2eTest2026!");
    const demo = await signIn(browser, "owner@cafe-demo.local", "DemoShots2026!");

    // 1. Общий экран, десктоп: порядок секций и переименованный журнал.
    {
      const { ctx, page } = await open(browser, ownerA, 1366, 900, "/settings/qr-posters");
      const main = await labels(page, "main");
      const journals = await labels(page, "journals");
      const objects = await labels(page, "objects");
      out.overviewMain = main;
      out.overviewJournals = journals;
      out.overviewObjects = objects;
      assert.equal(main[0], "Все журналы", "универсальные первыми");
      assertSorted(journals, "журналы");
      assertSorted(objects, "журналы объектов");
      assert.ok(journals.indexOf(CUSTOM) >= 0 && journals.indexOf(CUSTOM) < 3, "переименованный журнал встал по новому названию — в начало списка");
      assert.ok(!journals.includes(candidate.name), "официальное название на карточке не показано");
      await page.screenshot({ path: `${SHOTS}/overview-desktop.png`, fullPage: true });

      // 2. Поиск: по официальному названию переименованного журнала тоже находит.
      const firstWord = candidate.name.split(/\s+/).find((w) => w.length > 4) ?? candidate.name;
      await search(page, firstWord.slice(0, 6));
      out.searchOfficial = { query: firstWord.slice(0, 6), found: await labels(page, "journals") };
      assert.ok((await labels(page, "journals")).includes(CUSTOM));

      await search(page, "гигиен журнал");
      out.searchHygiene = {
        journals: await labels(page, "journals"),
        main: await labels(page, "main"),
        count: await page.locator("[data-search-count]").innerText(),
        objectsSection: await page.locator('[data-qr-section="objects"]').count(),
      };
      assert.equal(out.searchHygiene && (out.searchHygiene as { objectsSection: number }).objectsSection, 0, "секция без совпадений скрыта");
      await page.screenshot({ path: `${SHOTS}/overview-search-desktop.png`, fullPage: true });

      // 3. Отметки переживают поиск; «Отметить найденные».
      await page.getByLabel("Поиск по QR-кодам").fill("");
      await page.waitForTimeout(300);
      const before = await chosen(page);
      await page.locator('[data-qr-section="journals"] [data-qr-poster] input[type=checkbox]').first().check();
      const withOne = await chosen(page);
      assert.equal(withOne, before + 1);
      await search(page, "журнал бракераж");
      assert.equal(await chosen(page), withOne, "скрытая отметка осталась в счётчике");
      const foundRows = page.locator('[data-qr-section="journals"] [data-qr-poster]');
      const foundTotal = await foundRows.count();
      const foundUnchecked = await page.locator('[data-qr-section="journals"] [data-qr-poster][data-qr-selected="false"]').count();
      const selectFound = page.locator('[data-qr-section="journals"] button', { hasText: "Отметить найденные" });
      out.selection = { before, withOne, foundTotal, foundUnchecked, selectFoundButton: await selectFound.count() };
      if (foundTotal > 1) {
        await selectFound.click();
        assert.equal(await chosen(page), withOne + foundUnchecked, "отмечены только найденные");
        assert.equal(await page.locator('[data-qr-section="journals"] button', { hasText: "Снять найденные" }).count(), 1);
      }
      await page.screenshot({ path: `${SHOTS}/overview-select-found-desktop.png` });
      // Escape очищает запрос.
      await page.getByLabel("Поиск по QR-кодам").press("Escape");
      await page.waitForTimeout(300);
      assert.equal(await page.getByLabel("Поиск по QR-кодам").inputValue(), "");
      assert.equal((await labels(page, "journals")).length, journals.length);
      out.afterEscapeChosen = await chosen(page);

      // 4. Ничего не нашли.
      await search(page, "zzqq несуществующее");
      assert.equal(await page.locator("[data-qr-empty-search]").count(), 1);
      await page.screenshot({ path: `${SHOTS}/overview-empty-desktop.png` });
      await ctx.close();
    }

    // 5a. Телефон 390 без запроса: низ страницы не под полосой выбора.
    {
      const { ctx, page } = await open(browser, ownerA, 390, 844, "/settings/qr-posters");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      const geo = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("[data-qr-section] a, [data-qr-poster]"));
        const last = rows[rows.length - 1]?.getBoundingClientRect();
        const bar = document.querySelector("[data-selection-bar]")?.getBoundingClientRect();
        return { lastBottom: last?.bottom ?? 0, barTop: bar?.top ?? 9999 };
      });
      out.phoneNoQuery = geo;
      assert.ok(geo.lastBottom <= geo.barTop, "последняя строка не под полосой выбора");
      await page.screenshot({ path: `${SHOTS}/overview-phone-bottom.png` });
      await ctx.close();
    }

    // 5. Телефон 390: поиск, полоса выбора не закрывает последние строки.
    for (const dark of [false, true]) {
      const { ctx, page } = await open(browser, ownerA, 390, 844, "/settings/qr-posters", dark);
      await search(page, "журнал");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      const geo = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("[data-qr-poster]"));
        const last = rows[rows.length - 1]?.getBoundingClientRect();
        const bar = document.querySelector("[data-selection-bar]")?.getBoundingClientRect();
        return { lastBottom: last?.bottom ?? 0, barTop: bar?.top ?? 9999, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
      });
      out[dark ? "phoneDark" : "phone"] = geo;
      assert.ok(geo.lastBottom <= geo.barTop, "последняя строка не под полосой выбора");
      assert.ok(geo.scrollW <= geo.clientW, "нет горизонтальной прокрутки");
      await page.screenshot({ path: `${SHOTS}/overview-search-phone${dark ? "-dark" : ""}-bottom.png` });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByLabel("Поиск по QR-кодам").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/overview-search-phone${dark ? "-dark" : ""}.png` });
      await ctx.close();
    }

    // 6. 360 px: поле во всю ширину.
    {
      const { ctx, page } = await open(browser, ownerA, 360, 780, "/settings/qr-posters");
      const box = await page.getByLabel("Поиск по QR-кодам").boundingBox();
      const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      out.w360 = { inputWidth: box?.width, scroll };
      assert.ok(scroll[0] <= scroll[1]);
      assert.ok((box?.width ?? 0) >= 300, "поле во всю ширину");
      await page.screenshot({ path: `${SHOTS}/overview-360.png` });
      await ctx.close();
    }

    // 7. Наклейки оборудования и помещений (демо): по названию, поиск по цеху.
    for (const kind of ["equipment", "rooms"] as const) {
      for (const [w, h, tag] of [[1366, 900, "desktop"], [390, 844, "phone"]] as const) {
        const { ctx, page } = await open(browser, demo, w, h, `/settings/qr-posters?kind=${kind}&layout=sheet`);
        const list = await labels(page, "object");
        out[`demo-${kind}-${tag}`] = list;
        assertSorted(list, kind);
        await page.screenshot({ path: `${SHOTS}/${kind}-${tag}.png`, fullPage: tag === "desktop" });
        out[`${kind}SearchShown`] = await page.getByLabel("Поиск по QR-кодам").count();
        if (tag === "desktop" && kind === "rooms") {
          // Поиск по точке: у помещений место — здание.
          const where = await db.room.findFirst({ where: { building: { organization: { name: { contains: "Демо" } } } }, select: { building: { select: { name: true } } } });
          assert.equal(out.roomsSearchShown, 1, "у 6 помещений есть поиск");
          await search(page, where!.building.name);
          out.roomsByBuilding = { building: where!.building.name, found: await labels(page, "object") };
          assert.equal((await labels(page, "object")).length, list.length, "поиск по точке находит её помещения");
          await search(page, "склад");
          out.roomsSklad = await labels(page, "object");
          await page.screenshot({ path: `${SHOTS}/rooms-search-desktop.png` });
        }
        await ctx.close();
      }
    }

    // 8. Демо: общий экран и экран журнала объектов.
    {
      const { ctx, page } = await open(browser, demo, 1366, 900, "/settings/qr-posters");
      const journals = await labels(page, "journals");
      out.demoJournals = journals;
      assertSorted(journals, "демо журналы");
      await page.screenshot({ path: `${SHOTS}/demo-overview-desktop.png` });
      await ctx.close();
      const phone = await open(browser, demo, 390, 844, "/settings/qr-posters");
      await phone.page.screenshot({ path: `${SHOTS}/demo-overview-phone.png` });
      await phone.ctx.close();
      const cold = await open(browser, demo, 1366, 900, "/settings/qr-posters?journal=cold_equipment_control");
      const coldList = await labels(cold.page, "object");
      out.demoColdObjects = coldList;
      assertSorted(coldList, "наклейки журнала холодильников");
      await cold.page.screenshot({ path: `${SHOTS}/journal-cold-desktop.png`, fullPage: true });
      await cold.ctx.close();
    }
    // 9. Экран журнала гигиены: основные, дополнительные по документам.
    {
      const { ctx, page } = await open(browser, ownerA, 1366, 900, "/settings/qr-posters?journal=hygiene");
      const extra = await labels(page, "extra");
      out.hygieneExtra = extra;
      await page.screenshot({ path: `${SHOTS}/journal-hygiene-desktop.png`, fullPage: true });
      await ctx.close();
      const phone = await open(browser, ownerA, 390, 844, "/settings/qr-posters?journal=hygiene");
      await phone.page.screenshot({ path: `${SHOTS}/journal-hygiene-phone.png` });
      await phone.ctx.close();
    }
    out.ok = true;
  } finally {
    await browser.close();
    // Убираем только своё название: другие сессии на этой же базе могут
    // в это время держать свои переименования.
    const now = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { customNamesJson: true } });
    const names = (now.customNamesJson ?? {}) as { journals?: Record<string, string> };
    if (names.journals?.[candidate.code] === CUSTOM) delete names.journals[candidate.code];
    await db.organization.update({ where: { id: ORG_A }, data: { customNamesJson: names } });
    await db.$disconnect();
    writeFileSync(".agent/tasks/journals-alphabetical-2026-09/qr-e2e.json", JSON.stringify(out, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
