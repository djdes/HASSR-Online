// Фильтр по местам на «Сотрудниках», «Журналах точек», «Цехах», «Оборудовании».
// ЛОКАЛЬНАЯ база wesetup_memos (не прод): сиды памяток и QR-наклеек
// (.agent/tasks/memos-point-2026-10-28/raw/seed-local.ts, .agent/tasks/qr-stickers-point-2026-10-28/raw/seed-local.ts).
//   BASE=http://localhost:3026 CHROME=<chrome.exe> node .agent/tasks/place-filter-chips-2026-10-28/raw/e2e.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3026";
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const shot = (name) => fileURLToPath(new URL(name, OUT));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function session(browser, email, { point, viewport = { width: 1440, height: 1000 }, mini = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  const cookies = [];
  if (point) cookies.push({ name: "wesetup.building", value: point, domain: "localhost", path: "/" });
  if (mini) cookies.push({ name: "ws-shell", value: "mini", domain: "localhost", path: "/" });
  if (cookies.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", "Test-12345");
    if ((await page.inputValue("#email")) !== email) continue;
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
      await page.mouse.move(1, viewport.height - 1);
      return { ctx, page };
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  throw new Error(`Не удалось войти: ${email}`);
}

/** Состояние фильтра и групп на странице. */
async function state(page, kind, groupSelector) {
  return page.evaluate(
    ({ kind, groupSelector }) => {
      const nav = document.querySelector(`[data-place-filter="${kind}"]`);
      const chips = nav
        ? Array.from(nav.querySelectorAll("[data-place-chip]")).map((chip) => ({
            id: chip.getAttribute("data-place-chip"),
            current: chip.getAttribute("aria-current") === "true",
            count: chip.querySelector(".tabular-nums")?.textContent ?? "",
          }))
        : null;
      const groups = Array.from(document.querySelectorAll(groupSelector)).map((group) =>
        (group.querySelector("h2, h3, [data-building-name]")?.textContent ?? group.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
      );
      const qr = Array.from(document.querySelectorAll("[data-equipment-qr]")).map((link) => link.getAttribute("href"));
      return { chips, active: chips?.find((chip) => chip.current)?.id ?? null, groups, qr, path: location.pathname + location.search };
    },
    { kind, groupSelector },
  );
}

async function open(page, path, kind) {
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  await page.waitForSelector(`[data-place-filter="${kind}"]`, { timeout: 120000 });
}

async function qrCards(page, href) {
  await page.goto(`${BASE}${href}`, { waitUntil: "load" });
  await page.waitForSelector("[data-qr-page]");
  return page.$$eval("[data-qr-poster]", (nodes) => nodes.map((node) => node.getAttribute("data-qr-id")).sort());
}

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
try {
  // ---------- «Вся организация» в шапке
  const org = await session(browser, "dk-owner@test.local", { point: "org-dk:organization" });
  let page = org.page;

  await open(page, "/settings/areas", "areas");
  let s = await state(page, "areas", '[data-testid="area-building-group"]');
  check("Цеха: фильтр есть, отмечено «Все»", s.active === "all", JSON.stringify(s.chips));
  check("Цеха: чипы точек и «Без точки», без офиса без цехов", JSON.stringify(s.chips.map((c) => c.id)) === JSON.stringify(["all", "b-dk-5", "b-dk-112", "b-dk-mira", "none"]), s.chips.map((c) => `${c.id}:${c.count}`).join(" "));
  check("Цеха: «Все» — все группы (3 точки + без точки)", s.groups.length === 4, s.groups.join(" | "));
  check("Цеха: QR при «Все» — point=all", s.qr.every((href) => href.includes("point=all")), s.qr[0]);
  await page.screenshot({ path: shot("1-areas-all.png"), fullPage: true });

  await page.click('[data-place-filter="areas"] [data-place-chip="b-dk-112"]');
  await page.waitForURL((url) => url.search.includes("place=b-dk-112"));
  await page.waitForSelector('[data-place-filter="areas"] [data-place-chip="b-dk-112"][aria-current="true"]');
  s = await state(page, "areas", '[data-testid="area-building-group"]');
  check("Цеха: точка 112 — её цеха и цеха без точки", s.groups.length === 2, s.groups.join(" | "));
  check("Цеха: QR по точке 112", s.qr.every((href) => href.includes("point=b-dk-112")), s.qr[0]);

  await page.click('[data-place-filter="areas"] [data-place-chip="none"]');
  await page.waitForURL((url) => url.search.includes("place=none"));
  await page.waitForSelector('[data-place-filter="areas"] [data-place-chip="none"][aria-current="true"]');
  s = await state(page, "areas", '[data-testid="area-building-group"]');
  check("Цеха: «Без точки» — только цеха без точки", s.groups.length === 1, s.groups.join(" | "));
  check("Цеха: QR «Без точки» — point=none", s.qr.every((href) => href.includes("point=none")), s.qr[0]);

  await open(page, "/settings/equipment", "equipment");
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  check("Оборудование: отмечено «Все», счётчики", s.active === "all" && s.chips.find((c) => c.id === "all")?.count === "5", s.chips.map((c) => `${c.id}:${c.count}`).join(" "));
  await page.screenshot({ path: shot("2-equipment-all.png"), fullPage: true });
  await page.click('[data-place-filter="equipment"] [data-place-chip="b-dk-112"]');
  await page.waitForSelector('[data-place-filter="equipment"] [data-place-chip="b-dk-112"][aria-current="true"]');
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  check("Оборудование: точка 112 — её и без точки", s.groups.length === 2, s.groups.join(" | "));
  const stickers112 = s.qr.find((href) => href.includes("layout=sheet"));
  let cards = await qrCards(page, stickers112);
  check("QR по точке 112: морозильник 112 и холодильник склада", JSON.stringify(cards) === JSON.stringify(["e-dk-112-freezer", "e-dk-shared-fridge"]), cards.join(","));
  await open(page, "/settings/equipment?place=none", "equipment");
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  cards = await qrCards(page, s.qr.find((href) => href.includes("layout=sheet")));
  check("QR «Без точки»: ровно холодильник склада", JSON.stringify(cards) === JSON.stringify(["e-dk-shared-fridge"]), cards.join(","));

  await open(page, "/journals/points", "point-journals");
  s = await state(page, "point-journals", "[data-point-journals-card]");
  check("Журналы точек: фильтр по точкам, отмечено «Все», все карточки", s.active === "all" && s.groups.length === 3, `${s.chips.map((c) => `${c.id}:${c.count}`).join(" ")} / ${s.groups.length}`);
  await page.screenshot({ path: shot("3-point-journals-all.png"), fullPage: true });
  await page.click('[data-place-filter="point-journals"] [data-place-chip="b-dk-112"]');
  await page.waitForSelector('[data-place-filter="point-journals"] [data-place-chip="b-dk-112"][aria-current="true"]');
  s = await state(page, "point-journals", "[data-point-journals-card]");
  check("Журналы точек: точка 112 — одна карточка", s.groups.length === 1, s.groups.join(" | "));
  await page.screenshot({ path: shot("4-point-journals-112.png"), fullPage: true });
  // Обратно «Все» без перезагрузки: у всех карточек — их журналы, а не пустое состояние.
  await page.click('[data-place-filter="point-journals"] [data-place-chip="all"]');
  await page.waitForSelector('[data-place-filter="point-journals"] [data-place-chip="all"][aria-current="true"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-point-journals-card]").length === 3);
  const cardTexts = await page.$$eval("[data-point-journals-card]", (nodes) => nodes.map((node) => node.textContent ?? ""));
  check("Журналы точек: после «Все» карточки не устаревшие (журналы в работе у всех)", cardTexts.every((text) => /46/.test(text)), cardTexts.map((text) => text.replace(/s+/g, " ").slice(0, 60)).join(" | "));

  await open(page, "/settings/users", "staff");
  s = await state(page, "staff", "[data-staff-row], tbody tr");
  check("Сотрудники: тот же фильтр, при «Вся организация» — «Все»", s.active === "all", s.chips.map((c) => `${c.id}:${c.count}`).join(" "));
  await page.screenshot({ path: shot("5-users-all.png") });
  await org.ctx.close();

  // ---------- в шапке точка № 5
  const p5 = await session(browser, "dk-owner@test.local", { point: "org-dk:b-dk-5" });
  page = p5.page;
  await open(page, "/settings/equipment", "equipment");
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  check("Оборудование: без выбора — точка из шапки (№ 5) и без точки", s.active === "b-dk-5" && s.groups.length === 2, `${s.active} / ${s.groups.join(" | ")}`);
  check("Оборудование: QR по точке № 5", s.qr.every((href) => href.includes("point=b-dk-5")), s.qr[0]);
  await page.screenshot({ path: shot("6-equipment-point5.png"), fullPage: true });
  await page.click('[data-place-filter="equipment"] [data-place-chip="all"]');
  await page.waitForURL((url) => url.search.includes("place=all"));
  await page.waitForSelector('[data-place-filter="equipment"] [data-place-chip="all"][aria-current="true"]');
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  check("Оборудование: «Все» при точке в шапке — все группы", s.groups.length === 4, s.groups.join(" | "));
  cards = await qrCards(page, s.qr.find((href) => href.includes("layout=sheet")));
  check("QR при «Все» и точке в шапке: всё оборудование", cards.length === 5, cards.join(","));

  await open(page, "/settings/areas", "areas");
  s = await state(page, "areas", '[data-testid="area-building-group"]');
  check("Цеха: без выбора — точка из шапки (№ 5)", s.active === "b-dk-5" && s.groups.length === 2, `${s.active} / ${s.groups.join(" | ")}`);

  await open(page, "/settings/users", "staff");
  s = await state(page, "staff", "tbody tr");
  check("Сотрудники: без выбора — точка из шапки (№ 5)", s.active === "b-dk-5", s.chips.map((c) => `${c.id}:${c.count}${c.current ? "*" : ""}`).join(" "));

  await page.goto(`${BASE}/journals/points`, { waitUntil: "load" });
  const closed = await page.locator("[data-place-filter]").count();
  check("Журналы точек при точке в шапке — закрыты, как раньше (фильтра нет)", closed === 0);

  await page.goto(`${BASE}/settings/buildings/b-dk-5`, { waitUntil: "load" });
  const addHref = await page.getAttribute("[data-point-staff-add]", "href", { timeout: 120000 });
  check("Страница точки: «Добавить сотрудника» — с этой точкой в фильтре", addHref === "/settings/users?place=b-dk-5&add=b-dk-5", String(addHref));
  await p5.ctx.close();

  // ---------- руководитель точки № 5: чужих точек нет ни в фильтре, ни через адрес
  const pm = await session(browser, "dk-admin5@test.local");
  page = pm.page;
  await open(page, "/settings/equipment", "equipment");
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  check("Руководитель точки: в фильтре только его точка и «Без точки»", JSON.stringify(s.chips.map((c) => c.id)) === JSON.stringify(["all", "b-dk-5", "none"]), s.chips.map((c) => `${c.id}:${c.count}`).join(" "));
  await open(page, "/settings/equipment?place=b-dk-112", "equipment");
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  check("Руководитель точки: чужая точка в адресе не открывается", s.active === "b-dk-5" && !s.groups.some((g) => g.includes("112")), `${s.active} / ${s.groups.join(" | ")}`);
  await open(page, "/settings/equipment?place=all", "equipment");
  s = await state(page, "equipment", '[data-testid="equipment-building-group"]');
  check("Руководитель точки: «Все» — только его точка и без точки", !s.groups.some((g) => g.includes("112") || g.includes("Мира")), s.groups.join(" | "));
  cards = await qrCards(page, "/settings/qr-posters?kind=equipment&layout=sheet&point=b-dk-112");
  check("Руководитель точки: QR чужой точки через адрес — не печатается", !cards.includes("e-dk-112-freezer"), cards.join(","));
  cards = await qrCards(page, "/settings/qr-posters?kind=equipment&layout=sheet&point=all");
  check("Руководитель точки: QR «вся организация» через адрес — не печатается", !cards.includes("e-dk-112-freezer"), cards.join(","));
  await open(page, "/settings/areas", "areas");
  s = await state(page, "areas", '[data-testid="area-building-group"]');
  check("Руководитель точки: «Цеха» — только его точка и «Без точки»", JSON.stringify(s.chips.map((c) => c.id)) === JSON.stringify(["all", "b-dk-5", "none"]), s.chips.map((c) => c.id).join(","));
  await pm.ctx.close();

  // ---------- Mini App (П-3): те же страницы в оболочке приложения
  const mini = await session(browser, "dk-owner@test.local", { point: "org-dk:organization", viewport: { width: 390, height: 844 }, mini: true });
  await open(mini.page, "/settings/equipment", "equipment");
  s = await state(mini.page, "equipment", '[data-testid="equipment-building-group"]');
  check("Mini App: фильтр на «Оборудовании» тот же", s.active === "all" && s.chips.length === 5, s.chips.map((c) => c.id).join(","));
  await mini.page.screenshot({ path: shot("7-mini-equipment.png"), fullPage: true });
  await mini.ctx.close();
} catch (error) {
  check("скрипт без исключений", false, error?.stack ?? String(error));
} finally {
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  writeFileSync(fileURLToPath(new URL("e2e-result.json", OUT)), JSON.stringify({ base: BASE, total: results.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exitCode = failed.length ? 1 : 0;
}
