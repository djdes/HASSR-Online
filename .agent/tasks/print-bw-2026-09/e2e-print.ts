/**
 * Печать с сайта (нужны база и сессия): dev-сервер :3142 (NEXT_DIST_DIR=.next-e2e),
 * своя база wesetup_wt_bwprint. Одна организация «ООО «Ромашка»», 6 сотрудников,
 * документы за май 2026 (выходные, праздники 1, 9, 11 мая, сокращённый 8 мая):
 * гигиена, здоровье, уборка, температура холодильников (с отклонениями).
 *
 * Что снимается (в OUT/<метка>/):
 *   • экран: сетка гигиены с выходными — светлая и тёмная тема (PNG);
 *   • печать браузером (`page.pdf`, как «Печать» в Chrome, фон по умолчанию
 *     выключен — печатается только то, что помечено print-color-adjust:
 *     exact): документы журналов, лист A4 для проверяющих, приказ;
 *   • PDF с сервера: сертификат организации, сертификат сотрудника, сводка
 *     проверяющего, отчёт за период, PDF документов журналов;
 *   • скан цвета (`color-scan.ts`) всех PDF, кроме PDF документов журналов
 *     (их рендер тот же, что в `scan-docs.ts`, где известна плитка QR).
 *
 * Запуск (из корня репо): npx tsx .agent/tasks/print-bw-2026-09/e2e-print.ts <метка>
 * Пишет только в OUT (вне проекта: запись в .agent пересобирает dev-сервер).
 */
import fs from "node:fs";
import path from "node:path";

import bcrypt from "bcryptjs";
import pg from "pg";
import { chromium, type BrowserContext, type Page } from "playwright-core";

import { scanPdfOperators, scanPdfRaster, type BoxMm, type ExcludeMap } from "./color-scan";
import { openPdf, renderRegion, savePng } from "../journal-qr-header-2026-09/qr-sim";

const BASE = process.env.E2E_BASE ?? "http://localhost:3142";
const OUT = path.resolve(process.env.E2E_OUT ?? "D:/wt-build/tmp-bwprint/e2e");
const STATE_FILE = path.join(OUT, "state.json");
const PASSWORD = "BwPrint2026!";
const PERIOD = { from: "2026-05-01", to: "2026-05-31" };

function databaseUrl(): string {
  const env = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  const match = env.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!match) throw new Error("DATABASE_URL не найден в .env");
  return match[1];
}

const pool = new pg.Pool({ connectionString: databaseUrl() });
const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

function chromePath(): string {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dir = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .pop();
  if (!dir) throw new Error("Chromium от Playwright не найден");
  return path.join(root, dir, "chrome-win64", "chrome.exe");
}

type State = {
  owner: { id: string; email: string };
  orgId: string;
  staff: string[];
  docs: Record<string, string>;
};

function dayKeys(): string[] {
  const out: string[] = [];
  const cursor = new Date(`${PERIOD.from}T00:00:00Z`);
  const end = new Date(`${PERIOD.to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

async function login(context: BrowserContext, email: string) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 300000 })).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password: PASSWORD, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
    timeout: 300000,
  });
  const ok = (await context.cookies()).some((c) => c.name.includes("session-token"));
  if (!ok) throw new Error(`вход не удался: ${res.status()}`);
}

let entrySeq = 0;
const entryId = () => `bwp${Date.now().toString(36)}${(entrySeq++).toString(36).padStart(4, "0")}`;

async function setup(context: BrowserContext): Promise<State> {
  const run = Date.now().toString(36);
  const email = `bw-owner-${run}@example.com`;
  const reg = await context.request.post(`${BASE}/api/auth/instant-register`, { data: { email, consent: true }, timeout: 300000 });
  if (reg.status() !== 200) throw new Error(`регистрация: ${reg.status()} ${await reg.text()}`);
  const [me] = await sql<{ id: string; organizationId: string; legalVersion: string | null }>(
    'select id, "organizationId", "legalVersion" from "User" where email = $1',
    [email],
  );
  const hash = bcrypt.hashSync(PASSWORD, 10);
  await sql('update "Organization" set name = $1, inn = $2, address = $3, "disabledJournalCodes" = $4 where id = $5', [
    "ООО «Ромашка»",
    "7701234567",
    "125009, г Москва, ул Тверская, д 1",
    JSON.stringify([]),
    me.organizationId,
  ]);
  await sql('update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3, "positionTitle" = $4, "journalAccessMigrated" = true where id = $5', [
    "Иванова Мария Петровна",
    "+79990001122",
    hash,
    "Заведующая производством",
    me.id,
  ]);
  const people: Array<[string, string, string]> = [
    ["Петров Сергей Иванович", "head_chef", "Шеф-повар"],
    ["Сидорова Анна Викторовна", "cook", "Повар горячего цеха"],
    ["Кузнецов Дмитрий Олегович", "cook", "Повар холодного цеха"],
    ["Смирнова Ольга Николаевна", "waiter", "Официант"],
    ["Васильев Игорь Павлович", "cook", "Кондитер"],
  ];
  const staff: string[] = [];
  for (const [index, [name, role, title]] of people.entries()) {
    const id = `bwu${run}${index}`;
    await sql(
      'insert into "User" (id, email, name, phone, "passwordHash", role, "positionTitle", "organizationId", "journalAccessMigrated", "showWhatsNew", "legalVersion") values ($1,$2,$3,$4,$5,$6,$7,$8,true,false,$9)',
      [id, `bw-${run}-${index}@example.com`, name, `+7999000${String(2000 + index)}`, hash, role, title, me.organizationId, me.legalVersion],
    );
    staff.push(id);
  }
  // Холодильники: тип и нормы — документ температуры берёт их в config.
  const areaId = `bwa${run}`;
  await sql('insert into "Area" (id, name, "organizationId") values ($1,$2,$3)', [areaId, "Горячий цех", me.organizationId]);
  for (const [index, [name, type, min, max]] of ([
    ["Холодильник № 1 (мясо)", "refrigerator", 0, 4],
    ["Холодильник № 2 (молочка)", "refrigerator", 2, 6],
    ["Морозильный ларь", "freezer", -20, -18],
  ] as Array<[string, string, number, number]>).entries()) {
    await sql('insert into "Equipment" (id, name, type, "tempMin", "tempMax", "areaId") values ($1,$2,$3,$4,$5,$6)', [
      `bwe${run}${index}`,
      name,
      type,
      min,
      max,
      areaId,
    ]);
  }

  await login(context, email);
  const docs: Record<string, string> = {};
  for (const code of ["hygiene", "health_check", "cleaning", "cold_equipment_control"]) {
    const res = await context.request.post(`${BASE}/api/journal-documents`, {
      data: { templateCode: code, title: "", dateFrom: PERIOD.from, dateTo: PERIOD.to, force: true },
      timeout: 300000,
    });
    const body = (await res.json().catch(() => null)) as { document?: { id: string }; id?: string } | null;
    const id = body?.document?.id ?? body?.id;
    if (!res.ok() || !id) throw new Error(`документ ${code}: ${res.status()} ${JSON.stringify(body).slice(0, 300)}`);
    docs[code] = id;
  }
  // Новый документ гигиены — форма Приложения № 1 (без колонок дней); сетка
  // «сотрудник × день» с заливкой выходных — у прежней формы, которую ведут
  // все прежние документы. Снимаем на ней.
  await sql('update "JournalDocument" set config = config - $1 where id = $2', ["hygieneFormVersion", docs.hygiene]);

  // Записи: гигиена и здоровье — все сотрудники в рабочие дни (выходные и
  // праздники — отметка «выходной»), холодильники — ежедневно, с отклонениями.
  const everyone = [me.id, ...staff];
  const keys = dayKeys().filter((k) => k <= "2026-05-20");
  const weekendLike = (k: string) => {
    const day = new Date(`${k}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6 || ["2026-05-01", "2026-05-09", "2026-05-11"].includes(k);
  };
  for (const key of keys) {
    for (const [index, userId] of everyone.entries()) {
      const off = weekendLike(key) && index % 2 === 1;
      await sql(
        'insert into "JournalDocumentEntry" (id, "documentId", "employeeId", date, data, "updatedAt") values ($1,$2,$3,$4,$5,now()) on conflict ("documentId", "employeeId", date) do update set data = excluded.data, "updatedAt" = now()',
        [entryId(), docs.hygiene, userId, `${key}T00:00:00Z`, JSON.stringify(off ? { status: "day_off" } : { status: "healthy", temperatureAbove37: false })],
      );
      if (!off) {
        await sql(
          'insert into "JournalDocumentEntry" (id, "documentId", "employeeId", date, data, "updatedAt") values ($1,$2,$3,$4,$5,now()) on conflict ("documentId", "employeeId", date) do update set data = excluded.data, "updatedAt" = now()',
          [entryId(), docs.health_check, userId, `${key}T00:00:00Z`, JSON.stringify({ signed: true, measures: null })],
        );
      }
    }
  }
  const [cold] = await sql<{ config: { equipment: Array<{ id: string; min: number | null; max: number | null }> } }>(
    'select config from "JournalDocument" where id = $1',
    [docs.cold_equipment_control],
  );
  for (const [dayIndex, key] of keys.entries()) {
    const temperatures: Record<string, number> = {};
    cold.config.equipment.forEach((item, i) => {
      const min = item.min ?? 0;
      const max = item.max ?? 4;
      // Каждый 4-й день у одного из холодильников — отклонение.
      const deviate = (dayIndex + i) % 4 === 0;
      temperatures[item.id] = deviate ? max + 3.5 : +(min + (max - min) * 0.5).toFixed(1);
    });
    await sql(
      'insert into "JournalDocumentEntry" (id, "documentId", "employeeId", date, data, "updatedAt") values ($1,$2,$3,$4,$5,now()) on conflict ("documentId", "employeeId", date) do update set data = excluded.data, "updatedAt" = now()',
      [entryId(), docs.cold_equipment_control, staff[0], `${key}T00:00:00Z`, JSON.stringify({ responsibleTitle: "Шеф-повар", temperatures })],
    );
  }
  const state: State = { owner: { id: me.id, email }, orgId: me.organizationId, staff, docs };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  return state;
}

async function quietPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  return page;
}

async function open(page: Page, url: string, selector: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300000 });
    try {
      await page.waitForSelector(selector, { timeout: 180000 });
      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(800);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function setTheme(context: BrowserContext, userId: string, theme: "light" | "dark") {
  await sql('update "User" set "themePreference" = $1 where id = $2', [theme, userId]);
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem("wesetup-theme-mode", t);
      window.localStorage.setItem("wesetup-app-theme", t);
    } catch {}
  }, theme);
}

type ScanRow = {
  name: string;
  kind: "browser-print" | "server-pdf";
  pages: number;
  coloredOps: number;
  coloredOutsideQr: number;
  rasterColored: number;
  rasterVisible: number;
  palette: Record<string, number>;
  examples: unknown[];
  excluded: string;
};

async function scanFile(file: string, name: string, kind: ScanRow["kind"], exclude: ExcludeMap, excluded: string): Promise<ScanRow> {
  const buffer = new Uint8Array(fs.readFileSync(file));
  const ops = await scanPdfOperators(buffer, exclude);
  const raster = await scanPdfRaster(buffer, exclude);
  return {
    name,
    kind,
    pages: ops.pages,
    coloredOps: ops.coloredOps,
    coloredOutsideQr: ops.coloredOutsideQr,
    rasterColored: raster.colored,
    rasterVisible: raster.coloredVisible,
    palette: ops.palette,
    examples: ops.examples,
    excluded,
  };
}

/** Зоны исключения — все картинки PDF (QR-плитка сертификата — PNG). */
async function imagesAsExclusion(file: string): Promise<ExcludeMap> {
  const ops = await scanPdfOperators(new Uint8Array(fs.readFileSync(file)));
  const map: ExcludeMap = new Map();
  for (const img of ops.images) map.set(img.page, [...(map.get(img.page) ?? []), img.box]);
  return map;
}

async function firstPagePng(file: string, png: string, dpi = 110, page = 1) {
  const doc = await openPdf(fs.readFileSync(file));
  try {
    const p = await doc.getPage(page);
    const vp = p.getViewport({ scale: 1 });
    const raster = await renderRegion(doc, page, { x0: 0, y0: 0, x1: (vp.width / 72) * 25.4, y1: (vp.height / 72) * 25.4 }, dpi);
    savePng(raster, png);
  } finally {
    await doc.close();
  }
}

async function main() {
  const label = process.argv[2];
  if (!label) throw new Error("метка: before | after");
  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--use-gl=swiftshader", "--no-sandbox"],
  });
  const results: ScanRow[] = [];
  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
    console.log(line);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
    let state: State;
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
      await login(context, state.owner.email);
    } else {
      state = await setup(context);
    }
    note(`организация ${state.orgId}, документы ${JSON.stringify(state.docs)}`);

    const only = process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(",")) : null;
    const want = (part: string) => !only || only.has(part);

    // ---------------- экран: сетки с выходными, светлая и тёмная ----------------
    const screens: Array<{ name: string; url: string; table: string; legend?: boolean }> = [
      { name: "hygiene", url: `/journals/hygiene/documents/${state.docs.hygiene}`, table: "table.hygiene-grid" },
      { name: "health_check", url: `/journals/health_check/documents/${state.docs.health_check}`, table: "table.health-grid" },
      { name: "cleaning", url: `/journals/cleaning/documents/${state.docs.cleaning}`, table: "table[data-journal-grid]", legend: true },
    ];
    for (const theme of want("screens") ? (["light", "dark"] as const) : []) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Moscow", storageState: await context.storageState() });
      await setTheme(ctx, state.owner.id, theme);
      for (const screen of screens) {
        const page = await quietPage(ctx);
        await open(page, screen.url, screen.table);
        const shell = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme"));
        const grid = page.locator(screen.table).first();
        await grid.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        const box = await grid.boundingBox();
        if (box) {
          // Легенда уборки — под таблицей: кадр захватывает и её.
          const extra = screen.legend ? 70 : 0;
          const clip = { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1400 - box.x, box.width + 8), height: Math.min(460, box.height + 8) + extra };
          await page.screenshot({ path: path.join(dir, `screen-${screen.name}-${theme}.png`), clip });
        }
        // Фоны ячеек дней по классу заливки (выходной / сокращённый).
        const colors = await page.evaluate((sel) => {
          const out: Record<string, string[]> = {};
          const cells = [...document.querySelectorAll(`${sel} td, ${sel} th`)] as HTMLElement[];
          for (const cell of cells) {
            const key = /bg-\[#[0-9a-f]{6}\]/i.exec(cell.className)?.[0];
            if (!key) continue;
            const bg = getComputedStyle(cell).backgroundColor;
            out[key] = [...new Set([...(out[key] ?? []), bg])].slice(0, 3);
          }
          return out;
        }, screen.table);
        note(`экран ${screen.name} ${theme}: data-app-theme=${shell}, фоны ячеек по классу: ${JSON.stringify(colors)}`);
        fs.writeFileSync(path.join(dir, `screen-${screen.name}-${theme}-colors.json`), JSON.stringify({ theme: shell, colors }, null, 1));
        await page.close();
      }
      await ctx.close();
    }
    await sql('update "User" set "themePreference" = $1 where id = $2', ["light", state.owner.id]);

    // ---------------- печать браузером ----------------
    const printCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Moscow", storageState: await context.storageState() });
    await setTheme(printCtx, state.owner.id, "light");
    const printTargets: Array<{ name: string; url: string; selector: string }> = [
      { name: "print-hygiene", url: `/journals/hygiene/documents/${state.docs.hygiene}`, selector: "table.hygiene-grid" },
      { name: "print-health_check", url: `/journals/health_check/documents/${state.docs.health_check}`, selector: "table.health-grid" },
      { name: "print-cleaning", url: `/journals/cleaning/documents/${state.docs.cleaning}`, selector: "table[data-journal-grid]" },
      { name: "print-cold_equipment_control", url: `/journals/cold_equipment_control/documents/${state.docs.cold_equipment_control}`, selector: "table" },
      { name: "print-order-haccp-responsible", url: `/orders/haccp-responsible`, selector: "article" },
    ];
    for (const target of want("print") ? printTargets : []) {
      const page = await quietPage(printCtx);
      await open(page, target.url, target.selector);
      for (const background of [false, true]) {
        const file = path.join(dir, `${target.name}${background ? "-bg" : ""}.pdf`);
        await page.pdf({ path: file, preferCSSPageSize: true, printBackground: background });
        const row = await scanFile(file, `${target.name}${background ? " (фон вкл.)" : ""}`, "browser-print", new Map(), "—");
        results.push(row);
        note(`${row.name}: стр. ${row.pages}, оп. ${row.coloredOutsideQr}, пикс ${row.rasterColored} (${row.rasterVisible}) ${JSON.stringify(row.palette)}`);
      }
      await page.close();
    }

    // ---------------- печать из тёмной темы: заливки дней на листе ----------------
    // В тёмной теме ячейки дней — полупрозрачный белый; на бумаге должны
    // выйти те же серые, что в светлой (правило печати в app-theme.css).
    if (want("printdark")) {
      const darkCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Moscow", storageState: await context.storageState() });
      await setTheme(darkCtx, state.owner.id, "dark");
      const page = await quietPage(darkCtx);
      await open(page, `/journals/hygiene/documents/${state.docs.hygiene}`, "table.hygiene-grid");
      const probe = async () =>
        page.evaluate(() => {
          const out: Record<string, string[]> = {};
          for (const cell of [...document.querySelectorAll("table.hygiene-grid td, table.hygiene-grid th")] as HTMLElement[]) {
            const key = /bg-\[#[0-9a-f]{6}\]/i.exec(cell.className)?.[0];
            if (!key) continue;
            out[key] = [...new Set([...(out[key] ?? []), getComputedStyle(cell).backgroundColor])].slice(0, 3);
          }
          return { theme: document.querySelector(".app-shell")?.getAttribute("data-app-theme"), colors: out };
        });
      const screenColors = await probe();
      await page.emulateMedia({ media: "print" });
      const printColors = await probe();
      const file = path.join(dir, "print-hygiene-dark.pdf");
      await page.pdf({ path: file, preferCSSPageSize: true, printBackground: false });
      const row = await scanFile(file, "print-hygiene (тёмная тема)", "browser-print", new Map(), "—");
      results.push(row);
      note(`тёмная тема: экран ${JSON.stringify(screenColors)}; печать ${JSON.stringify(printColors)}`);
      note(`${row.name}: стр. ${row.pages}, оп. ${row.coloredOutsideQr}, пикс ${row.rasterColored} (${row.rasterVisible}) ${JSON.stringify(row.palette)}`);
      fs.writeFileSync(path.join(dir, "print-hygiene-dark-colors.json"), JSON.stringify({ screen: screenColors, print: printColors }, null, 1));
      await firstPagePng(file, path.join(dir, "print-hygiene-dark-p1.png"));
      await darkCtx.close();
      await sql('update "User" set "themePreference" = $1 where id = $2', ["light", state.owner.id]);
    }

    // ---------------- сертификат (создаёт QR проверяющего) ----------------
    const certFile = path.join(dir, "server-certificate.pdf");
    const staffCertFile = path.join(dir, "server-certificate-staff.pdf");
    if (want("cert")) {
    const cert = await context.request.get(`${BASE}/api/certificate?from=${PERIOD.from}&to=${PERIOD.to}`, { timeout: 600000 });
    fs.writeFileSync(certFile, await cert.body());
    note(`сертификат: ${cert.status()} ${cert.headers()["content-type"]}`);
    const staffCert = await context.request.get(`${BASE}/api/certificate/staff?userId=${state.staff[1]}`, { timeout: 300000 });
    fs.writeFileSync(staffCertFile, await staffCert.body());
    note(`сертификат сотрудника: ${staffCert.status()}`);
    }

    // ---------------- лист A4 для проверяющих + сводный PDF ----------------
    const [token] = await sql<{ id: string }>(
      'select id from "InspectorToken" where "organizationId" = $1 and "revokedAt" is null order by "createdAt" desc limit 1',
      [state.orgId],
    );
    let inspectorUrl = "";
    if (token && (want("inspector") || want("server"))) {
      const page = await quietPage(printCtx);
      await page.setViewportSize({ width: 794, height: 1123 });
      await open(page, `/inspector-sheet/${token.id}`, "[data-inspector-sheet]");
      inspectorUrl = (await page.locator("[data-sheet-url]").innerText()).trim();
      // Замер места QR и сам PDF — в режиме печати (page.pdf после
      // emulateMedia("screen") печатал бы экранную вёрстку).
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(300);
      const qrBox = await page.locator("[data-sheet-qr]").boundingBox();
      const file = path.join(dir, "print-inspector-sheet.pdf");
      await page.pdf({ path: file, preferCSSPageSize: true, printBackground: false });
      const px = 25.4 / 96;
      const exclude: ExcludeMap = new Map();
      let excluded = "—";
      if (qrBox) {
        const box: BoxMm = { x0: qrBox.x * px - 1, y0: qrBox.y * px - 1, x1: (qrBox.x + qrBox.width) * px + 1, y1: (qrBox.y + qrBox.height) * px + 1 };
        exclude.set(1, [box]);
        excluded = `QR ${box.x0.toFixed(0)}–${box.x1.toFixed(0)} × ${box.y0.toFixed(0)}–${box.y1.toFixed(0)} мм`;
      }
      const row = await scanFile(file, "print-inspector-sheet", "browser-print", exclude, excluded);
      if (want("inspector")) results.push(row);
      note(`${row.name}: стр. ${row.pages}, оп. ${row.coloredOutsideQr}, пикс ${row.rasterColored} (${row.rasterVisible}) ${JSON.stringify(row.palette)} ${excluded}`);
      await page.close();
    }
    const inspectorToken = inspectorUrl.split("/").pop()?.split("?")[0] ?? "";
    const serverFiles: Array<{ name: string; url: string }> = [
      { name: "server-inspector-summary", url: `/api/inspector/${inspectorToken}/pdf?p=custom&from=${PERIOD.from}&to=${PERIOD.to}` },
      { name: "server-report-hygiene", url: `/api/reports/pdf?template=hygiene&from=${PERIOD.from}&to=${PERIOD.to}` },
      { name: "server-report-cold", url: `/api/reports/pdf?template=cold_equipment_control&from=${PERIOD.from}&to=${PERIOD.to}` },
    ];
    for (const item of want("server") ? serverFiles : []) {
      const res = await context.request.get(`${BASE}${item.url}`, { timeout: 600000 });
      const file = path.join(dir, `${item.name}.pdf`);
      fs.writeFileSync(file, await res.body());
      note(`${item.name}: ${res.status()} ${res.headers()["content-type"]}`);
    }
    for (const [name, file] of [
      ["server-certificate", certFile],
      ["server-certificate-staff", staffCertFile],
      ["server-inspector-summary", path.join(dir, "server-inspector-summary.pdf")],
      ["server-report-hygiene", path.join(dir, "server-report-hygiene.pdf")],
      ["server-report-cold", path.join(dir, "server-report-cold.pdf")],
    ] as const) {
      if (!want("server") && !(want("cert") && name.startsWith("server-certificate"))) continue;
      if (!fs.existsSync(file) || !fs.readFileSync(file).subarray(0, 5).toString().startsWith("%PDF")) {
        note(`${name}: не PDF`);
        continue;
      }
      const exclude = await imagesAsExclusion(file);
      const row = await scanFile(file, name, "server-pdf", exclude, exclude.size ? "картинки (QR-плитка PNG)" : "—");
      results.push(row);
      note(`${row.name}: стр. ${row.pages}, оп. ${row.coloredOutsideQr}, пикс ${row.rasterColored} (${row.rasterVisible}) ${JSON.stringify(row.palette)}`);
    }

    // ---------------- PDF документов журналов с сервера ----------------
    for (const [code, id] of want("docs") ? Object.entries(state.docs) : []) {
      const res = await context.request.get(`${BASE}/api/journal-documents/${id}/pdf`, { timeout: 600000 });
      fs.writeFileSync(path.join(dir, `server-doc-${code}.pdf`), await res.body());
      note(`PDF документа ${code}: ${res.status()}`);
    }

    // ---------------- растры первых страниц для доказательств ----------------
    for (const name of (want("png") ? [
      "print-hygiene",
      "print-cleaning",
      "print-cold_equipment_control",
      "print-inspector-sheet",
      "server-certificate",
      "server-certificate-staff",
      "server-inspector-summary",
      "server-report-hygiene",
      "server-doc-hygiene",
      "server-doc-cold_equipment_control",
      "server-doc-cleaning",
    ] : [])) {
      const file = path.join(dir, `${name}.pdf`);
      if (fs.existsSync(file) && fs.readFileSync(file).subarray(0, 5).toString().startsWith("%PDF")) {
        await firstPagePng(file, path.join(dir, `${name}-p1.png`));
      }
    }
    await context.close();
    await printCtx.close();
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(dir, "e2e-results.json"), JSON.stringify(results, null, 1));
    fs.writeFileSync(path.join(dir, "e2e-log.txt"), log.join("\n") + "\n");
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
