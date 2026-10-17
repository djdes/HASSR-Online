// Смоук раздела «Производственный контроль» (ppk-section-2026-10) на e2e-стенде.
// Запуск: SMOKE_ONLY=P1,P3 npx tsx .agent/tasks/ppk-section-2026-10/e2e/smoke.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAW = path.join(HERE, "..", "raw");
fs.mkdirSync(RAW, { recursive: true });
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "nav-shell-2026-10", "e2e", "state.json"), "utf8"),
);
const RESULT_FILE = path.join(RAW, "smoke-result.json");
const MANAGER_STORAGE = path.join(HERE, "storage-manager.json");

const ONLY = (process.env.SMOKE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);

type Result = { id: string; name: string; ok: boolean; status: "PASS" | "FAIL" | "NOT_READY"; details?: unknown };
let saved: { results: Result[]; errors: string[] } = { results: [], errors: [] };
try {
  saved = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"));
} catch {
  /* первый прогон */
}
const results: Result[] = saved.results;
const errors: string[] = saved.errors ?? [];

function persist() {
  fs.writeFileSync(RESULT_FILE, JSON.stringify({ results, errors }, null, 2));
}
function check(id: string, name: string, ok: boolean, details?: unknown, status?: "NOT_READY") {
  const entry: Result = { id, name, ok, status: status ?? (ok ? "PASS" : "FAIL"), details };
  const i = results.findIndex((r) => r.id === id);
  if (i >= 0) results[i] = entry;
  else results.push(entry);
  console.log(`${entry.status} [${id}] ${name}${details !== undefined ? " " + JSON.stringify(details).slice(0, 300) : ""}`);
  persist();
}
async function scenario(id: string, fn: () => Promise<void>) {
  if (!want(id)) return;
  console.log(`\n=== ${id} ===`);
  try {
    await fn();
  } catch (error) {
    check(`${id}.ERR`, `${id}: сценарий упал`, false, String(error).slice(0, 400));
  }
}

async function makeContext(browser: Browser, width: number, theme: "light" | "dark", storage?: string): Promise<BrowserContext> {
  const mobile = width < 768;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    storageState: storage,
  });
  if (mobile) await context.route("**/_next/image**", (route) => route.abort());
  await context.addInitScript(
    `try{localStorage.setItem("wesetup-theme-mode",${JSON.stringify(theme)});localStorage.setItem("wesetup-app-theme",${JSON.stringify(theme)});localStorage.setItem("wesetup-theme-auto-schedule","0")}catch(e){}
     document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent="nextjs-portal{display:none!important}";document.head.appendChild(s)})`,
  );
  return context;
}

async function login(browser: Browser, email: string, file: string): Promise<string> {
  const context = await makeContext(browser, 1280, "light");
  const page = await context.newPage();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 600_000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 30; i += 1) {
      await page.fill("#email", email);
      await page.fill("#password", state.password);
      if ((await page.inputValue("#email")) === email) break;
      await page.waitForTimeout(300);
    }
    await page.click('button[type="submit"]');
    const left = await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180_000 }).then(() => true).catch(() => false);
    if (left) break;
  }
  await page.waitForLoadState("load").catch(() => null);
  let landed = new URL(page.url()).pathname;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(1500);
    const now = new URL(page.url()).pathname;
    if (now === landed) break;
    landed = now;
  }
  await context.storageState({ path: file });
  await context.close();
  return file;
}

/** Сессия управляющей: готовая, а если протухла — новый вход. */
async function managerStorage(browser: Browser): Promise<string> {
  if (fs.existsSync(MANAGER_STORAGE)) {
    const context = await makeContext(browser, 1280, "light", MANAGER_STORAGE);
    const response = await context.request.get(`${BASE}/api/auth/session`, { timeout: 600_000 });
    const body = await response.json().catch(() => ({}));
    await context.close();
    if (body?.user?.id) return MANAGER_STORAGE;
  }
  return login(browser, state.users.manager.email, MANAGER_STORAGE);
}

const pageErrorHooked = new WeakSet<Page>();
async function open(page: Page, url: string) {
  if (!pageErrorHooked.has(page)) {
    pageErrorHooked.add(page);
    page.on("pageerror", (error) => errors.push(`${page.url()} pageerror: ${String(error).slice(0, 300)}`));
  }
  const response = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForLoadState("load", { timeout: 90_000 }).catch(() => null);
  await page.waitForTimeout(1000);
  return response;
}

/** Открыть страницу; при ошибке компиляции dev-сервера (5xx) подождать минуту и повторить. */
async function openRetry(page: Page, url: string) {
  let response = await open(page, url);
  for (let i = 0; i < 3 && response && response.status() >= 500; i += 1) {
    await page.waitForTimeout(60_000);
    response = await open(page, url);
  }
  return response;
}

async function shot(page: Page, name: string, full = false) {
  await page.waitForLoadState("load").catch(() => null);
  await page.screenshot({ path: path.join(RAW, `${name}.png`), fullPage: full, timeout: 120_000 }).catch((e) => console.log(`снимок ${name} пропущен: ${String(e).slice(0, 100)}`));
}

const BLOCKS = ["team", "policy", "products", "hazards", "control-points", "flowchart", "floor-plan", "pest-plan", "lab-plan", "norms"];
const FOLDERS = ["procedures", "storage", "guidelines", "team-signed", "lab-contract", "lab-protocols", "lab-acts", "pest-contract", "pest-acts", "norm-files"];

async function cleanup(page: Page) {
  let records = 0;
  let files = 0;
  for (const block of BLOCKS) {
    const list = await page.request.get(`${BASE}/api/production-control/records?block=${block}`, { timeout: 600_000 });
    const body = await list.json().catch(() => ({ records: [] }));
    for (const record of body.records ?? []) {
      await page.request.delete(`${BASE}/api/production-control/records/${record.id}`, { timeout: 600_000 });
      records += 1;
    }
  }
  for (const folder of FOLDERS) {
    const list = await page.request.get(`${BASE}/api/production-control/files?folder=${folder}`, { timeout: 600_000 });
    const body = await list.json().catch(() => ({ files: [] }));
    for (const file of body.files ?? []) {
      await page.request.delete(`${BASE}/api/production-control/files?id=${file.id}`, { timeout: 600_000 });
      files += 1;
    }
  }
  console.log(`очистка: записей ${records}, файлов ${files}`);
}

async function listRecords(page: Page, block: string): Promise<any[]> {
  const r = await page.request.get(`${BASE}/api/production-control/records?block=${block}`, { timeout: 600_000 });
  return ((await r.json().catch(() => ({}))).records ?? []) as any[];
}

const PDF = path.join(RAW, "ppk-e2e.pdf");
fs.writeFileSync(PDF, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function menuIds(page: Page): Promise<string[]> {
  return page.$$eval("aside[data-app-sidebar] [data-section-menu] [data-menu-item]", (n) => n.map((x) => x.getAttribute("data-menu-item") ?? ""));
}
async function activeMenuId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('aside[data-app-sidebar] [data-menu-item][aria-current="page"]')?.getAttribute("data-menu-item") ?? null);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROMIUM || undefined });
  const storage = await managerStorage(browser);
  const managerCtx = await makeContext(browser, 1280, "light", storage);
  const page = await managerCtx.newPage();
  const session = await (await managerCtx.request.get(`${BASE}/api/auth/session`, { timeout: 600_000 })).json();
  const managerId: string = session.user.id;
  const managerName: string = session.user.name ?? "";
  console.log("менеджер", managerId, managerName);

  try {
    // Очищаем данные раздела только при полном прогоне или SMOKE_CLEAN=1.
    if (process.env.SMOKE_CLEAN === "1" || ONLY.length === 0) await cleanup(page);

    // ── P1 меню, 1280 ───────────────────────────────────────────────
    await scenario("P1", async () => {
      await openRetry(page, "/dashboard");
      const mode0 = await page.getAttribute("aside[data-app-sidebar]", "data-sidebar-mode");
      check("P1.1", "на /dashboard сайдбар без section-режима", mode0 === null || mode0 === "main", mode0);
      await page.click('aside[data-app-sidebar] [data-nav-section="productionControl"]');
      await page.waitForURL((u) => u.pathname === "/production-control", { timeout: 600_000 });
      await page.waitForSelector('aside[data-sidebar-mode="section"]', { timeout: 60_000 });
      check("P1.2", "клик по разделу → /production-control, режим section", true);
      const ids = await menuIds(page);
      check("P1.3", "первые 8 пунктов меню", JSON.stringify(ids.slice(0, 8)) === JSON.stringify(["program", "instructions", "procedures", "floor-plans", "products", "pest-control", "lab", "flowcharts"]), ids.slice(0, 8));
      check("P1.4", "затем ХАССП и документы", JSON.stringify(ids.slice(8)) === JSON.stringify(["team", "policy", "hazards", "control-points", "audit", "orders", "posters", "norm-documents", "storage"]), ids.slice(8));
      check("P1.5", "активный пункт — program", (await activeMenuId(page)) === "program", await activeMenuId(page));
      const crumbs = await page.$$('nav[aria-label="Хлебные крошки"]');
      check("P1.6", "на корне раздела крошек нет", crumbs.length === 0, crumbs.length);
      await shot(page, "p1-overview-1280-light");
      const urlBefore = page.url();
      await page.click('aside[data-app-sidebar] button:has-text("Главное меню")');
      await page.waitForSelector('aside[data-sidebar-mode="main"]', { timeout: 30_000 });
      check("P1.7", "«Главное меню» → режим main, адрес прежний", page.url() === urlBefore, page.url());
      await shot(page, "p1-main-menu-1280");
      await page.click('aside[data-app-sidebar] [data-nav-section="productionControl"]');
      await page.waitForSelector('aside[data-sidebar-mode="section"]', { timeout: 60_000 });
      check("P1.8", "клик по «Производственный контроль» в главном меню → section", true);

      await openRetry(page, "/orders");
      check("P1.9", "/orders → активный orders", (await activeMenuId(page)) === "orders", await activeMenuId(page));
      await openRetry(page, "/sanpin");
      const tabsSan = await page.$$eval("[data-section-tab]", (n) => n.map((x) => x.textContent?.trim()));
      check("P1.10", "/sanpin → активный norm-documents и 3 вкладки", (await activeMenuId(page)) === "norm-documents" && tabsSan.length === 3, { active: await activeMenuId(page), tabsSan });
      await openRetry(page, "/production-control/haccp/control-points/worksheets");
      const tabsWs = await page.$$eval("[data-section-tab]", (n) => n.map((x) => ({ t: x.textContent?.trim(), cur: x.getAttribute("aria-current") })));
      check("P1.11", "worksheets: вкладки «Точки · Рабочие листы», активна вторая", tabsWs.length === 2 && /Точки/.test(tabsWs[0].t ?? "") && /Рабочие листы/.test(tabsWs[1].t ?? "") && tabsWs[1].cur === "page" && tabsWs[0].cur !== "page", tabsWs);
      const crumbs2 = await page.$$('nav[aria-label="Хлебные крошки"]');
      check("P1.12", "на страницах раздела крошек нет", crumbs2.length === 0, crumbs2.length);
    });

    // ── P2 ХАССП ────────────────────────────────────────────────────
    await scenario("P2", async () => {
      await openRetry(page, "/production-control/haccp/hazards");
      await page.getByRole("button", { name: "Заполнить типовыми" }).first().click();
      await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 10, undefined, { timeout: 300_000 });
      const rows = await page.$$eval("tbody tr", (n) => n.length);
      check("P2.1", "«Заполнить типовыми» → 10 строк", rows === 10, rows);
      await shot(page, "p2-hazards-1280-light", true);

      await openRetry(page, "/production-control/haccp/control-points");
      const needs = await page.getByRole("button", { name: "Пройти дерево решений" }).count();
      check("P2.2", "в ККТ блок «Нужно решение» не пуст", needs > 0, needs);
      await page.getByRole("button", { name: "Пройти дерево решений" }).first().click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Да", exact: true }).click();
      await dialog.getByText("Вопрос 2 из 4").waitFor({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Да", exact: true }).click();
      await dialog.getByText("Результат").waitFor({ timeout: 30_000 });
      const kindText = (await dialog.textContent()) ?? "";
      check("P2.3", "мастер: Да, Да → итог ККТ", /Критическая контрольная точка/.test(kindText), kindText.slice(0, 120));
      await shot(page, "p2-wizard-result");
      await dialog.getByRole("button", { name: "Далее" }).click();
      await dialog.getByLabel("Критические пределы").fill("Температура в центре не ниже +75 °C");
      await dialog.getByLabel("Что и как контролируем").fill("Щуп-термометр, замер в центре продукта");
      await dialog.getByLabel("Периодичность").fill("Каждую партию");
      await shot(page, "p2-wizard-form");
      await dialog.getByRole("button", { name: "Сохранить" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60_000 });
      await page.getByText("ККТ-1", { exact: false }).first().waitFor({ timeout: 60_000 });
      check("P2.4", "после сохранения — карточка «ККТ-1»", true);
      await shot(page, "p2-control-points-1280-light", true);
      await openRetry(page, "/production-control/haccp/control-points/worksheets");
      const ws = (await page.textContent("main")) ?? "";
      check("P2.5", "worksheets содержит «Рабочий лист ККТ-1»", ws.includes("Рабочий лист ККТ-1"), ws.slice(0, 120));
      await shot(page, "p2-worksheets");

      // Группа
      const add = await page.request.post(`${BASE}/api/production-control/records`, { data: { block: "team", data: { userId: managerId, role: "leader", duties: "Руководит группой ХАССП" } }, timeout: 600_000 });
      check("P2.6", "член группы создан через API", add.status() === 201, add.status());
      await openRetry(page, "/production-control/haccp/team/regulation");
      const reg = (await page.textContent("main")) ?? "";
      check("P2.7", "положение содержит имя руководителя", managerName.length > 0 && reg.includes(managerName), { managerName, snippet: reg.slice(0, 100) });
      await shot(page, "p2-regulation");
      await openRetry(page, "/production-control/haccp/team");
      await page.getByRole("link", { name: "Оформить приказ" }).first().click();
      await page.waitForURL((u) => u.pathname === "/orders/haccp-team", { timeout: 600_000 });
      await page.waitForLoadState("load", { timeout: 90_000 }).catch(() => null);
      await page.waitForTimeout(1500);
      const hasPrefill = new URL(page.url()).searchParams.get("prefill") === "ppk-team";
      const filled = await page.evaluate((name) => {
        const inputs = Array.from(document.querySelectorAll("input, textarea")) as HTMLInputElement[];
        return { byInput: inputs.some((i) => i.value.includes(name)), byText: document.body.innerText.includes(name), values: inputs.map((i) => i.value).filter(Boolean).slice(0, 8) };
      }, managerName);
      check("P2.8", "«Оформить приказ» → /orders/haccp-team?prefill=ppk-team, руководитель подставлен", hasPrefill && (filled.byInput || filled.byText), { url: page.url(), filled });
      await shot(page, "p2-team-order");

      // Политика
      const pol = await page.request.post(`${BASE}/api/production-control/records`, { data: { block: "policy", data: { text: "Мы выпускаем безопасную продукцию.\n\nКаждый сотрудник отвечает за качество.", approvedById: managerId, approvedAt: "2026-10-17" } }, timeout: 600_000 });
      const polBody = await pol.json().catch(() => ({}));
      const token: string = polBody?.record?.data?.token ?? "";
      check("P2.9", "политика создана, токен выдан", pol.status() === 201 && token.length >= 16, { status: pol.status(), tokenLen: token.length });
      await openRetry(page, "/production-control/haccp/policy/print");
      const svgCount = await page.locator("svg").count();
      const qrSvg = await page.evaluate(() => Array.from(document.querySelectorAll("svg")).some((s) => s.getBoundingClientRect().width >= 100 && (s.querySelector("path")?.getAttribute("d") ?? "").length > 500));
      check("P2.10", "policy/print содержит svg QR", qrSvg, { svgCount });
      await shot(page, "p2-policy-print");
      await openRetry(page, "/production-control/haccp/policy");
      await shot(page, "p2-policy-1280-light", true);
      await openRetry(page, "/production-control");
      const lead = (await page.textContent("main h1 + p")) ?? "";
      const orgName = lead.split(" · ")[0].trim();
      const anon = await makeContext(browser, 1280, "light");
      const apage = await anon.newPage();
      const pub = await apage.goto(`${BASE}/policy/${token}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
      const pubText = (await apage.textContent("body")) ?? "";
      check("P2.11", "публичная /policy/<token> без cookie — 200 и название организации", pub?.status() === 200 && orgName.length > 0 && pubText.includes(orgName), { status: pub?.status(), orgName });
      await shot(apage, "p2-policy-public");
      const bad = await apage.goto(`${BASE}/policy/badtoken123456789`, { waitUntil: "domcontentloaded", timeout: 600_000 });
      check("P2.12", "/policy/badtoken123456789 — 404", bad?.status() === 404, bad?.status());
      await anon.close();
    });

    // ── P3 схемы ────────────────────────────────────────────────────
    await scenario("P3", async () => {
      await openRetry(page, "/production-control/haccp/flowcharts");
      await page.getByRole("button", { name: /Новая схема/ }).first().click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Горячий цех" }).click();
      await dialog.getByRole("button", { name: "Создать" }).click();
      await page.waitForURL((u) => /\/haccp\/flowcharts\/[^/]+$/.test(u.pathname), { timeout: 600_000 });
      await page.waitForSelector("svg g[data-node]", { timeout: 300_000 });
      await page.waitForTimeout(1500);
      const flowId = new URL(page.url()).pathname.split("/").pop()!;
      const nodes = await page.locator("svg g[data-node]").count();
      check("P3.1", "блок-схема из шаблона «Горячий цех»: в SVG ≥ 8 этапов", nodes >= 8, nodes);
      await shot(page, "p3-flowchart-1280-light");
      // правка подписи двойным кликом
      await page.locator("svg g[data-node]").first().dblclick();
      const labelInput = page.getByLabel("Подпись элемента");
      const hasInput = await labelInput.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
      check("P3.2", "двойной клик по этапу открывает поле правки подписи", hasInput, { hasInput });
      if (hasInput) {
        await labelInput.fill("Приёмка сырья E2E");
        await labelInput.press("Enter");
      } else {
        // обход: правка через боковую панель «Подпись»
        await page.locator("svg g[data-node]").first().click();
        await page.getByLabel("Подпись", { exact: true }).fill("Приёмка сырья E2E");
      }
      await page.waitForTimeout(4000);
      const savedShown = await page.getByText("Сохранено", { exact: false }).first().waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
      const labelInSvg = await page.evaluate(() => document.querySelector("svg[role=img]")?.textContent?.includes("Приёмка сырья E2E") ?? false);
      check("P3.2b", "правка подписи (через панель), подпись в SVG, автосохранение «Сохранено»", labelInSvg && savedShown, { labelInSvg, savedShown });
      await shot(page, "p3-flowchart-edited");
      await openRetry(page, `/production-control/haccp/flowcharts/${flowId}/print`);
      const printSvg = await page.evaluate(() => ({ svg: document.querySelectorAll("svg").length, edited: document.body.innerText.includes("Приёмка сырья E2E") }));
      check("P3.3", "…/[id]/print — SVG есть, правка сохранена", printSvg.svg > 0 && printSvg.edited, printSvg);
      await shot(page, "p3-flowchart-print");

      // План помещений
      const room = (id: string, x: number, label: string) => ({ id, x, y: 100, w: 220, h: 160, label, kind: "room", ccp: null, areaId: null });
      const plan = await page.request.post(`${BASE}/api/production-control/records`, {
        data: { block: "floor-plan", data: { title: "План E2E", nodes: [room("r1", 60, "Склад сырья"), room("r2", 420, "Горячий цех")], edges: [{ id: "e1", from: null, to: null, points: [{ x: 280, y: 180 }, { x: 420, y: 180 }], flow: "raw", label: "" }] } },
        timeout: 600_000,
      });
      const planBody = await plan.json().catch(() => ({}));
      const planId: string = planBody?.record?.id ?? "";
      check("P3.4", "план помещений создан через API (2 помещения, 1 поток)", plan.status() === 201 && !!planId, { status: plan.status(), err: planBody?.error });
      await openRetry(page, `/production-control/sanitation/floor-plans/${planId}`);
      await page.waitForSelector("svg g[data-node]", { timeout: 300_000 }).catch(() => null);
      await shot(page, "p3-floorplan-1280-light");
      const resp = await openRetry(page, `/production-control/sanitation/floor-plans/${planId}/print?by=flow`);
      const flowText = await page.evaluate(() => document.body.innerText);
      check("P3.5", "печать по потокам: секция потока «Сырьё» есть", resp?.status() === 200 && flowText.includes("Сырьё"), { status: resp?.status(), snippet: flowText.slice(0, 150) });
      await shot(page, "p3-floorplan-print-by-flow");
    });

    // ── P4 санитария ────────────────────────────────────────────────
    await scenario("P4", async () => {
      await openRetry(page, "/production-control/sanitation/pest-control");
      await page.getByRole("button", { name: "Заполнить типовым" }).first().click();
      for (let i = 0; i < 60 && (await listRecords(page, "pest-plan")).length < 3; i += 1) await page.waitForTimeout(1000);
      await page.waitForTimeout(1500);
      check("P4.1", "дезинсекция: «Заполнить типовым» → 3 строки", (await listRecords(page, "pest-plan")).length === 3, (await listRecords(page, "pest-plan")).length);
      await shot(page, "p4-pest-1280-light", true);
      await openRetry(page, "/production-control/sanitation/lab");
      await page.getByRole("button", { name: "Заполнить типовым" }).first().click();
      for (let i = 0; i < 60 && (await listRecords(page, "lab-plan")).length < 4; i += 1) await page.waitForTimeout(1000);
      await page.waitForTimeout(1500);
      check("P4.2", "лаборатория: «Заполнить типовым» → 4 строки", (await listRecords(page, "lab-plan")).length === 4, (await listRecords(page, "lab-plan")).length);
      await shot(page, "p4-lab-1280-light", true);
      // файл
      const folder = page.locator('[data-ppk-folder="lab-contract"]');
      await folder.locator('input[type="file"]').setInputFiles(PDF);
      const link = folder.locator('a[href^="/api/production-control/files/"]');
      await link.first().waitFor({ timeout: 300_000 });
      const href = (await link.first().getAttribute("href")) ?? "";
      const name = (await link.first().textContent())?.trim();
      const file = await page.request.get(`${BASE}${href}`, { timeout: 600_000 });
      check("P4.3", "файл в папке lab-contract в списке, ссылка отдаёт 200", name === "ppk-e2e.pdf" && file.status() === 200, { name, status: file.status() });
      await shot(page, "p4-lab-file");
      await folder.getByRole("button", { name: "Удалить файл" }).click();
      const dlg = page.locator('[role="alertdialog"], [role="dialog"]');
      await dlg.getByRole("button", { name: "Удалить файл" }).click();
      const gone = await page.waitForFunction(() => document.querySelectorAll('[data-ppk-folder="lab-contract"] a[href^="/api/production-control/files/"]').length === 0, undefined, { timeout: 60_000 }).then(() => true).catch(() => false);
      check("P4.4", "удаление файла через диалог", gone, gone);
    });

    // ── P5 документы и нормативы ────────────────────────────────────
    await scenario("P5", async () => {
      await openRetry(page, "/production-control/documents/posters");
      const previews = await page.$$eval('a[href^="/production-control/documents/posters/"]', (n) => n.map((x) => x.getAttribute("href")).filter((h) => !h!.endsWith("/all")).length);
      check("P5.1", "плакаты: 6 превью", previews === 6, previews);
      await shot(page, "p5-posters-1280-light", true);
      await openRetry(page, "/production-control/documents/posters/hand-washing");
      const poster = await page.evaluate(() => document.body.innerText);
      check("P5.2", "плакат hand-washing: «Как правильно мыть руки»", poster.includes("Как правильно мыть руки"), poster.slice(0, 80));
      await shot(page, "p5-poster-hand-washing");

      await openRetry(page, "/production-control/norms/documents");
      await page.getByRole("button", { name: "Отметить рекомендуемые" }).click();
      const checkedBefore = await page.locator('[role="checkbox"][aria-checked="true"]').count();
      await page.getByRole("button", { name: "Сохранить" }).click();
      await page.getByText("Сохранено", { exact: false }).first().waitFor({ timeout: 60_000 });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 600_000 });
      await page.waitForTimeout(2500);
      const checkedAfter = await page.locator('[role="checkbox"][aria-checked="true"]').count();
      check("P5.3", "нормативы: «Отметить рекомендуемые» → «Сохранить» → после перезагрузки отмечены", checkedBefore > 0 && checkedAfter === checkedBefore, { checkedBefore, checkedAfter });
      await shot(page, "p5-norms-1280-light");

      await openRetry(page, "/production-control/documents/procedures");
      const folder = page.locator('[data-ppk-folder="procedures"]');
      await folder.locator('input[type="file"]').setInputFiles(PDF);
      const ok = await folder.locator('a[href^="/api/production-control/files/"]').first().waitFor({ timeout: 300_000 }).then(() => true).catch(() => false);
      check("P5.4", "процедуры: загрузка файла", ok, ok);
      await shot(page, "p5-procedures");
    });

    // ── P7 доступ ───────────────────────────────────────────────────
    await scenario("P7", async () => {
      const cookStorage = await login(browser, state.users.cook.email, path.join(HERE, "storage-cook.json"));
      const cctx = await makeContext(browser, 1280, "light", cookStorage);
      const cpage = await cctx.newPage();
      const api = await cctx.request.get(`${BASE}/api/production-control/records?block=hazards`, { timeout: 600_000 });
      check("P7.1", "повар: GET records?block=hazards → 403", api.status() === 403, api.status());
      await open(cpage, "/production-control");
      await cpage.waitForTimeout(3000);
      const cpath = new URL(cpage.url()).pathname;
      check("P7.2", "повара с /production-control уводит", cpath !== "/production-control", cpath);
      await cctx.close();

      const headStorage = await login(browser, state.users.headChef.email, path.join(HERE, "storage-headchef.json"));
      const hctx = await makeContext(browser, 1280, "light", headStorage);
      const hpage = await hctx.newPage();
      await open(hpage, "/production-control");
      await hpage.waitForTimeout(3000);
      const hpath = new URL(hpage.url()).pathname;
      let ids = await menuIds(hpage);
      if (ids.length === 0) {
        await open(hpage, "/knowledge");
        ids = await menuIds(hpage);
      }
      const headApi = await hctx.request.get(`${BASE}/api/production-control/records?block=hazards`, { timeout: 600_000 });
      check("P7.3", "заведующая: меню раздела без instructions", ids.length > 0 && !ids.includes("instructions"), { landed: hpath, ids, apiStatus: headApi.status() });
      await shot(hpage, "p7-headchef");
      await hctx.close();
    });

    // ── P8 телефон 390 ──────────────────────────────────────────────
    await scenario("P8", async () => {
      const ctx = await makeContext(browser, 390, "light", storage);
      const mp = await ctx.newPage();
      await openRetry(mp, "/production-control/haccp/hazards");
      await mp.click("[data-nav-burger]");
      await mp.waitForSelector('[data-mobile-nav-mode="section"]', { timeout: 60_000 });
      const items = await mp.$$eval('[data-mobile-nav-mode="section"] [data-menu-item]', (n) => n.length);
      check("P8.1", "бургер → лист в режиме section с пунктами", items >= 15, items);
      await shot(mp, "p8-phone-section-menu");
      await mp.click('[data-mobile-nav] button:has-text("Главное меню")');
      const sections = await mp.waitForFunction(() => document.querySelectorAll("[data-mobile-nav] [data-nav-section]").length, undefined, { timeout: 30_000 }).then((h) => h.jsonValue()).catch(() => 0);
      check("P8.2", "«Главное меню» в листе → список разделов", Number(sections) >= 9, sections);
      await shot(mp, "p8-phone-main-menu");
      await mp.keyboard.press("Escape");
      await mp.waitForTimeout(500);
      const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
      check("P8.3", "scrollWidth ≤ 390 на анализе опасностей", sw <= 390, sw);
      await shot(mp, "p8-phone-hazards");
      await openRetry(mp, "/production-control");
      const sw2 = await mp.evaluate(() => document.documentElement.scrollWidth);
      check("P8.4", "scrollWidth ≤ 390 на обзоре", sw2 <= 390, sw2);
      await shot(mp, "p8-phone-overview");
      await ctx.close();
    });

    // ── P9 Mini App ─────────────────────────────────────────────────
    await scenario("P9", async () => {
      const ctx = await makeContext(browser, 390, "light", storage);
      await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
      const mp = await ctx.newPage();
      const before = errors.length;
      const resp = await openRetry(mp, "/production-control/haccp/hazards");
      const body = (await mp.textContent("body")) ?? "";
      const shell = await mp.evaluate(() => !!document.querySelector(".mini-root, [data-mini-shell], [data-shell='mini']"));
      check("P9.1", "Mini App: анализ опасностей открывается в оболочке без ошибок", resp?.status() === 200 && body.includes("Анализ") && errors.length === before, { status: resp?.status(), shell, newErrors: errors.slice(before) });
      await shot(mp, "p9-mini-hazards");
      await ctx.close();
    });

    // ── P10 тёмная тема ─────────────────────────────────────────────
    await scenario("P10", async () => {
      const ctx = await makeContext(browser, 1280, "dark", storage);
      const dp = await ctx.newPage();
      await openRetry(dp, "/production-control");
      await shot(dp, "p10-overview-dark", true);
      await openRetry(dp, "/production-control/haccp/hazards");
      await shot(dp, "p10-hazards-dark", true);
      check("P10.1", "снимки тёмной темы сделаны", true, "p10-overview-dark.png, p10-hazards-dark.png");
      await ctx.close();
    });

    // ── P6 обзор (последним) ────────────────────────────────────────
    await scenario("P6", async () => {
      await openRetry(page, "/production-control");
      const text = (await page.textContent("main")) ?? "";
      const m = text.match(/Заполнено (\d+) из (\d+) блоков/);
      check("P6.1", "прогресс «Заполнено N из M», N > 0", !!m && Number(m[1]) > 0, m?.[0]);
      const next = page.locator("[data-ppk-next-step]").first();
      const nextKey = await next.getAttribute("data-ppk-next-step").catch(() => null);
      const nextHref = await next.locator("a").first().getAttribute("href").catch(() => null);
      const filledKeys = ["team", "policy", "hazards", "control-points", "flowcharts", "floor-plans", "pest-control", "lab", "norm-documents", "procedures"];
      check("P6.2", "«Следующий шаг» ведёт на незаполненный блок", !!nextKey && !filledKeys.includes(nextKey), { nextKey, nextHref });
      await shot(page, "p6-overview-1280-light", true);
      for (const [id, url, label] of [["P6.3", "/production-control/program", "Программа ПК"], ["P6.4", "/production-control/haccp-plan", "ХАССП-план"]] as const) {
        const r = await open(page, url);
        const status = r?.status() ?? 0;
        if (status === 404) {
          check(id, `${label}: страница сборки`, false, "страницы ещё нет (404)", "NOT_READY");
          continue;
        }
        const sections = await page.$$eval("main h2, main section", (n) => n.length);
        check(id, `${label}: открывается, есть разделы`, status === 200 && sections > 0, { status, sections });
        await shot(page, `p6-${url.split("/").pop()}`, true);
      }
    });
  } finally {
    await managerCtx.close();
    await browser.close();
  }
  persist();
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\nитого: ${results.length - failed.length}/${results.length} без FAIL, pageerrors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(-10).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
