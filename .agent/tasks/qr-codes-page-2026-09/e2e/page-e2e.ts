// E2E страницы QR-кодов (C1): каждый старый вход даёт ожидаемый предвыбор,
// смешанная печать (1 A4 + 3 A5 + 13 наклеек = 5 страниц PDF), каждый
// напечатанный QR декодируется в свой `data-qr-url`, самый длинный URL
// (hygiene@verify + документ + &view=all) читается с наклейки 34 мм,
// основной QR сети привязан к активной точке, диалог QR документа
// (основной — первым, документ — «до ДД.ММ»), 360/390/1280 светлая и тёмная
// темы: без горизонтального скролла, цели касания ≥ 44px.
// Стенд: npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/page-setup.ts
// Запуск: BASE=http://localhost:3025 npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/page-e2e.ts
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { journalQrHref } from "../../../../src/lib/journal-qr-target";

const BASE = process.env.BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "../../../..");
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const wants = (id: string) => ONLY.length === 0 || ONLY.some((prefix) => id.startsWith(prefix));

// Секрет QR-токена — тот же, что у dev-сервера (из .env только секреты подписи, не базу).
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const state = JSON.parse(fs.readFileSync(path.join(HERE, "page-state.json"), "utf8"));
const D = state.docs as Record<string, string>;
const EQ = state.equipment as Record<string, string>;

const checks: Array<{ id: string; name: string; ok: boolean; detail?: unknown }> = [];
function check(id: string, name: string, ok: boolean, detail?: unknown) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 700)}` : ""}`);
}

// ---- ZXing из html5-qrcode (уже в node_modules, зависимостей не добавляем)
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ZX: any = require(path.join(ROOT, "node_modules/html5-qrcode/third_party/zxing-js.umd.js"));
/** Усреднение по площади (как у камеры/принтера) до размера tw×th. */
function resampleLuminance(src: Float32Array, w: number, h: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th);
  const sx = w / tw;
  const sy = h / th;
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      const y0 = y * sy;
      const y1 = y0 + sy;
      let sum = 0;
      let area = 0;
      for (let yy = Math.floor(y0); yy < Math.min(h, Math.ceil(y1)); yy += 1) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(w, Math.ceil(x1)); xx += 1) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          sum += src[yy * w + xx] * wx * wy;
          area += wx * wy;
        }
      }
      out[y * tw + x] = sum / area;
    }
  }
  return out;
}

/**
 * Запасной путь: ZXing-js на части кадров не находит finder-паттерны при
 * одной ориентации (исходный QR при этом корректен — так выглядели «плавающие»
 * промахи PR-4 на наклейках 34 мм при 288 dpi). Как телефон, который держат
 * под другим углом: усреднение до нескольких размеров, поворот на 90°, порог.
 */
function decodeLuminanceRobust(png: PNG): string | null {
  const w = png.width;
  const h = png.height;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i += 1) lum[i] = (png.data[i * 4] * 299 + png.data[i * 4 + 1] * 587 + png.data[i * 4 + 2] * 114) / 1000;
  const hints = new Map();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.QR_CODE]);
  for (const factor of [1, 0.77, 0.62, 0.46, 0.41]) {
    const tw = Math.max(60, Math.round(w * factor));
    const th = Math.max(60, Math.round(h * factor));
    const small = factor === 1 ? lum : resampleLuminance(lum, w, h, tw, th);
    for (const rotate of [true, false]) {
      for (const threshold of [false, true]) {
        const pad = Math.round(tw / 20);
        let W = tw + pad * 2;
        let H = th + pad * 2;
        let buf = new Uint8ClampedArray(W * H).fill(255);
        for (let y = 0; y < th; y += 1) {
          for (let x = 0; x < tw; x += 1) {
            const v = small[y * tw + x];
            buf[(y + pad) * W + x + pad] = threshold ? (v < 128 ? 0 : 255) : v;
          }
        }
        if (rotate) {
          const turned = new Uint8ClampedArray(W * H);
          for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) turned[x * H + (H - 1 - y)] = buf[y * W + x];
          buf = turned;
          [W, H] = [H, W];
        }
        for (const Binarizer of [ZX.HybridBinarizer, ZX.GlobalHistogramBinarizer]) {
          try {
            const source = new ZX.RGBLuminanceSource(buf, W, H);
            return new ZX.QRCodeReader().decode(new ZX.BinaryBitmap(new Binarizer(source)), hints).getText();
          } catch {
            // следующий вариант
          }
        }
      }
    }
  }
  return null;
}

function decodePng(buffer: Buffer): string | null {
  const png = PNG.sync.read(buffer);
  // Белое поле вокруг кадра — как бумага вокруг наклейки: скриншот элемента
  // обрезан по краю кода, а тихая зона у кода всего один модуль. ZXing-js
  // капризен к шагу модуля, поэтому пробуем несколько масштабов кадра — как
  // камера телефона видит код с разного расстояния.
  const pad = 16;
  const hints = new Map();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.QR_CODE]);
  for (const scale of [1, 2, 3]) {
    const w0 = Math.floor(png.width / scale);
    const h0 = Math.floor(png.height / scale);
    if (w0 < 60) continue;
    const width = w0 + pad * 2;
    const height = h0 + pad * 2;
    const luminance = new Uint8ClampedArray(width * height).fill(255);
    for (let y = 0; y < h0; y += 1) {
      for (let x = 0; x < w0; x += 1) {
        const i = (y * scale * png.width + x * scale) * 4;
        luminance[(y + pad) * width + x + pad] = (png.data[i] * 299 + png.data[i + 1] * 587 + png.data[i + 2] * 114) / 1000;
      }
    }
    for (const Binarizer of [ZX.HybridBinarizer, ZX.GlobalHistogramBinarizer]) {
      try {
        const source = new ZX.RGBLuminanceSource(luminance, width, height);
        return new ZX.QRCodeReader().decode(new ZX.BinaryBitmap(new Binarizer(source)), hints).getText();
      } catch {
        // следующий вариант
      }
    }
  }
  return decodeLuminanceRobust(png);
}

async function goto(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.goto(url, { waitUntil: "load", timeout: 240_000 }).catch(() => null);
    if (response && response.status() < 500) return response;
    await page.waitForTimeout(3_000);
  }
  return page.goto(url, { waitUntil: "load", timeout: 240_000 });
}

async function login(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await goto(page, `${BASE}/login`);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return page;
  }
  throw new Error(`login failed: ${email}`);
}

type Card = { id: string; url: string; group: string; selected: boolean; format: string; expired: boolean; disabled: boolean };
async function openPage(page: Page, query: string, withOrigin = true) {
  const url = query.startsWith("/") ? `${BASE}${query}` : `${BASE}/settings/qr-posters?${query}`;
  const sep = url.includes("?") ? "&" : "?";
  await goto(page, withOrigin ? `${url}${sep}origin=${encodeURIComponent(BASE)}` : url);
  await page.waitForSelector("[data-qr-page]", { timeout: 120_000 });
  await page.waitForSelector("[data-qr-summary]", { timeout: 30_000 });
}
async function cards(page: Page): Promise<Card[]> {
  return page.$$eval("[data-qr-poster]", (nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-qr-id") ?? "",
      url: node.getAttribute("data-qr-url") ?? "",
      group: node.getAttribute("data-qr-group") ?? "",
      selected: node.getAttribute("data-qr-selected") === "true",
      format: node.getAttribute("data-qr-format") ?? "",
      expired: node.getAttribute("data-qr-expired") === "true",
      disabled: Boolean(node.querySelector("input[type=checkbox]")?.hasAttribute("disabled")),
    }))
  );
}
const selectedIds = (list: Card[]) => list.filter((card) => card.selected).map((card) => card.id).sort();
const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function main() {
  const browser: Browser = await chromium.launch();
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // window.print → счётчик (autoprint проверяем без системного диалога).
  await desk.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints += 1;
    };
  });
  const page = await login(desk, state.users.manager);
  const prints = () => page.evaluate(() => (window as unknown as { __prints: number }).__prints);

  // ------------------------------------------------------------ AC10: входы
  if (wants("IN")) {
    type Case = { id: string; name: string; query: string; screen: string; selected: string[]; present?: string[]; absent?: string[]; format?: Record<string, string>; autoprint?: boolean; expired?: string[] };
    const hyg = D.hygiene;
    const cases: Case[] = [
      {
        id: "IN-01",
        name: "кнопка журнала (journalQrHref) гигиены / баннер гигиены — два основных отмечены, документы нет",
        query: journalQrHref("hygiene").split("?")[1],
        screen: "journal",
        selected: ["hygiene", "hygiene@verify"],
        present: [`hygiene:${hyg}`, `hygiene@verify:${hyg}`],
      },
      {
        id: "IN-02",
        name: "кнопка журнала фритюра — основной отмечен, два действующих документа не отмечены, прошлый не показан",
        query: journalQrHref("fryer_oil").split("?")[1],
        screen: "journal",
        selected: ["fryer_oil"],
        present: [`fryer_oil:${D.fryerA}`, `fryer_oil:${D.fryerB}`],
        absent: [`fryer_oil:${D.fryerOld}`],
      },
      { id: "IN-03", name: "старое kind=journals&ids=fryer_oil — отмечен ровно основной", query: "kind=journals&ids=fryer_oil", screen: "journal", selected: ["fryer_oil"] },
      {
        id: "IN-04",
        name: "старая кнопка гигиены kind=journal&ids=hygiene,hygiene@verify",
        query: "kind=journal&ids=hygiene,hygiene@verify",
        screen: "journal",
        selected: ["hygiene", "hygiene@verify"],
      },
      {
        id: "IN-05",
        name: "старая ссылка документа гигиены — отмечены ровно QR документа",
        query: `kind=journals&ids=hygiene:${hyg},hygiene@verify:${hyg}`,
        screen: "journal",
        selected: [`hygiene:${hyg}`, `hygiene@verify:${hyg}`],
      },
      {
        id: "IN-06",
        name: "qr-fill-preview «Плакат A4» документа — A4, печать сразу",
        query: `kind=journals&layout=poster&ids=${encodeURIComponent(`fryer_oil:${D.fryerA}`)}&autoprint=1`,
        screen: "journal",
        selected: [`fryer_oil:${D.fryerA}`],
        format: { [`fryer_oil:${D.fryerA}`]: "a4" },
        autoprint: true,
      },
      {
        id: "IN-07",
        name: "qr-fill-preview «Наклейка» основного QR журнала",
        query: "kind=journals&layout=sheet&ids=fryer_oil&autoprint=1",
        screen: "journal",
        selected: ["fryer_oil"],
        format: { fryer_oil: "sticker" },
        autoprint: true,
      },
      {
        id: "IN-08",
        name: "закончившийся документ в ids= — строка «срок истёк», не отмечена, печати нет",
        query: `kind=journals&layout=poster&ids=${encodeURIComponent(`fryer_oil:${D.fryerOld}`)}&autoprint=1`,
        screen: "journal",
        selected: [],
        expired: [`fryer_oil:${D.fryerOld}`],
        autoprint: false,
      },
      {
        id: "IN-09",
        name: "qr-fill-preview «Наклейка» холодильника — только он, наклейка, печать сразу",
        query: `kind=equipment&layout=sheet&ids=${EQ.fridge2}&autoprint=1`,
        screen: "objects",
        selected: [EQ.fridge2],
        format: { [EQ.fridge2]: "sticker" },
        autoprint: true,
      },
      { id: "IN-10", name: "«Все коды» журнала (kind=journals) — общий экран, отмечен «Все журналы»", query: "kind=journals", screen: "overview", selected: ["all"], present: ["fryer_oil", "hygiene"] },
      { id: "IN-11", name: "без параметров — общий экран", query: "", screen: "overview", selected: ["all"] },
      {
        id: "IN-12",
        name: "выделение строк холодильников (ids=a,b, layout=sheet)",
        query: `kind=equipment&layout=sheet&ids=${EQ.fridge1},${EQ.fridge2}`,
        screen: "objects",
        selected: [EQ.fridge1, EQ.fridge2],
        format: { [EQ.fridge1]: "sticker", [EQ.fridge2]: "sticker" },
      },
      {
        id: "IN-13",
        name: "меню холодильников (kind=equipment&doc=) — экран журнала: основной + наклейки документа",
        query: `kind=equipment&doc=${D.cold}`,
        screen: "journal",
        selected: ["cold_equipment_control", EQ.fridge1],
        absent: [EQ.fridge2],
      },
      {
        id: "IN-14",
        name: "меню климата (kind=rooms&doc=) — экран климата, в документе нет помещений",
        query: `kind=rooms&doc=${D.climate}`,
        screen: "journal",
        selected: ["climate_control"],
      },
      {
        id: "IN-15",
        name: "старая кнопка журнала объектов (kind=equipment&layout=sheet&journal=&doc=)",
        query: `kind=equipment&layout=sheet&journal=cold_equipment_control&doc=${D.cold}`,
        screen: "journal",
        selected: ["cold_equipment_control", EQ.fridge1],
        format: { [EQ.fridge1]: "sticker", cold_equipment_control: "a4" },
      },
      { id: "IN-16", name: "журнал объектов в ids= (бывший редирект)", query: "kind=journals&ids=cold_equipment_control", screen: "journal", selected: ["cold_equipment_control", EQ.fridge1] },
      { id: "IN-17", name: "УФ-лампа — основной + наклейка лампы", query: journalQrHref("uv_lamp_runtime").split("?")[1], screen: "journal", selected: ["uv_lamp_runtime", EQ.lamp] },
      { id: "IN-18", name: "/settings/equipment «Наклейки» — всё оборудование, наклейки", query: "kind=equipment&layout=sheet", screen: "objects", selected: ["*17"] },
      { id: "IN-19", name: "/settings/equipment «Плакаты» — всё оборудование, A4", query: "kind=equipment", screen: "objects", selected: ["*17"], format: { [EQ.fridge1]: "a4" } },
      { id: "IN-20", name: "/settings/buildings — помещения", query: "kind=rooms", screen: "objects", selected: [state.rooms.room] },
      { id: "IN-21", name: "несколько журналов в ids= — общий экран с этими отметками", query: "kind=journals&ids=all,fryer_oil", screen: "overview", selected: ["all", "fryer_oil"] },
      { id: "IN-22", name: "старый /settings/equipment/qr-sheet — наклейки оборудования", query: "/settings/equipment/qr-sheet", screen: "objects", selected: ["*17"], format: { [EQ.fridge1]: "sticker" } },
      { id: "IN-23", name: "document-actions-bar «QR-наклейки объектов» (journal=&doc=)", query: journalQrHref("cold_equipment_control", { documentId: D.cold }).split("?")[1], screen: "journal", selected: ["cold_equipment_control", EQ.fridge1] },
    ];
    for (const item of cases) {
      await openPage(page, item.query);
      await page.waitForTimeout(item.autoprint !== undefined ? 1200 : 150);
      const list = await cards(page);
      const screen = await page.getAttribute("[data-qr-page]", "data-qr-page");
      const selected = selectedIds(list);
      const ids = list.map((card) => card.id);
      const problems: string[] = [];
      if (screen !== item.screen) problems.push(`screen ${screen}`);
      if (item.selected[0]?.startsWith("*")) {
        if (selected.length !== Number(item.selected[0].slice(1)) || selected.length !== list.length) problems.push(`selected ${selected.length}/${list.length}`);
      } else if (!sameSet(selected, item.selected)) problems.push(`selected ${JSON.stringify(selected)}`);
      for (const id of item.present ?? []) if (!ids.includes(id)) problems.push(`нет ${id}`);
      for (const id of item.absent ?? []) if (ids.includes(id)) problems.push(`лишний ${id}`);
      for (const [id, format] of Object.entries(item.format ?? {})) {
        const card = list.find((c) => c.id === id);
        if (card?.format !== format) problems.push(`${id} формат ${card?.format}`);
      }
      for (const id of item.expired ?? []) {
        const card = list.find((c) => c.id === id);
        if (!card?.expired || !card.disabled || card.selected) problems.push(`${id} не «срок истёк»`);
      }
      if (item.autoprint !== undefined) {
        const count = await prints();
        if (item.autoprint ? count !== 1 : count !== 0) problems.push(`print ${count}`);
      }
      // Экранные карточки: у всех есть data-qr-url (читают e2e).
      if (list.some((card) => !card.url.startsWith(BASE))) problems.push("пустой data-qr-url");
      check(item.id, item.name, problems.length === 0, { problems, selected, ids });
    }

    // Бейдж «до ДД.ММ.ГГГГ» у дополнительных.
    await openPage(page, journalQrHref("fryer_oil").split("?")[1]);
    const [y, m, d] = state.periods.curMonthTo.split("-");
    const badge = await page.locator(`[data-qr-id="fryer_oil:${D.fryerA}"]`).innerText();
    check("IN-24", "у дополнительного QR бейдж «до ДД.ММ.ГГГГ»", badge.includes(`до ${d}.${m}.${y}`), badge);
    const tokenId = await page.$eval(`[data-qr-id="fryer_oil:${D.fryerA}"]`, (node) => node.getAttribute("data-qr-url"));
    const { verifyJournalFillToken } = await import("../../../../src/lib/journal-fill");
    const check1 = verifyJournalFillToken(new URL(tokenId as string).searchParams.get("token") ?? "", state.org, "fryer_oil");
    check("IN-25", "токен дополнительного QR несёт документ и срок dateTo", check1.ok && check1.documentId === D.fryerA && check1.validUntil === state.periods.curMonthTo, check1);
    const mainUrl = await page.$eval('[data-qr-id="fryer_oil"]', (node) => node.getAttribute("data-qr-url"));
    const check2 = verifyJournalFillToken(new URL(mainUrl as string).searchParams.get("token") ?? "", state.org, "fryer_oil");
    check("IN-26", "основной QR без точек — бессрочный, без документа", check2.ok && !check2.documentId && !check2.validUntil && !check2.buildingId, check2);
    // Галка и формат: отметка → формат виден, счётчик листов меняется.
    const row = page.locator(`[data-qr-id="fryer_oil:${D.fryerB}"]`);
    await row.locator("label").first().click();
    await row.locator('[data-qr-format-option="a5"]').click();
    const after = await cards(page);
    const summary = await page.locator("[data-qr-summary]").innerText();
    check(
      "IN-27",
      "галка в строке-label включает карточку, формат — radiogroup (не tablist), «Выбрано: N · M листов»",
      after.find((c) => c.id === `fryer_oil:${D.fryerB}`)?.selected === true &&
        after.find((c) => c.id === `fryer_oil:${D.fryerB}`)?.format === "a5" &&
        (await page.locator('[role="tablist"]').count()) === 0 &&
        (await page.locator('[role="radiogroup"]').count()) >= 2 &&
        /Выбрано: 2 · 2 листа/.test(summary),
      { summary }
    );
    // Снять всё — «Распечатать» неактивна.
    await page.getByRole("button", { name: "Снять выделение" }).click();
    check("IN-28", "при 0 выбранных «Распечатать» неактивна", (await page.locator("[data-qr-print]").isDisabled()) && /Выбрано: 0/.test(await page.locator("[data-qr-summary]").innerText()));
    // Длинного абзаца нет, гайд свёрнут, домен — только не на wesetup.ru.
    const guideOpen = await page.getByText("Дополнительные QR ведут в один документ").isVisible().catch(() => false);
    const originShown = await page.locator("[data-qr-origin]").count();
    await openPage(page, `${journalQrHref("fryer_oil").split("?")[1]}&origin=${encodeURIComponent("https://wesetup.ru")}`, false);
    const originOnProd = await page.locator("[data-qr-origin]").count();
    const oldParagraph = await page.getByText("Коды бессрочные: распечатали один раз").count();
    check("IN-29", "PageGuide свёрнут, старого абзаца нет, «Домен ссылок» только не на wesetup.ru", !guideOpen && originShown === 1 && originOnProd === 0 && oldParagraph === 0, {
      guideOpen,
      originShown,
      originOnProd,
      oldParagraph,
    });
  }

  // ------------------------------------------------ AC3/AC12: смешанная печать
  if (wants("PR")) {
    page.setDefaultTimeout(90_000);
    console.log("PR: open");
    await openPage(page, "kind=equipment&layout=sheet");
    const list = await cards(page);
    const order = list.map((card) => card.id);
    // 1 A4, 3 A5, остальные 13 — наклейки.
    await page.locator(`[data-qr-id="${order[0]}"] [data-qr-format-option="a4"]`).click();
    for (const id of order.slice(1, 4)) await page.locator(`[data-qr-id="${id}"] [data-qr-format-option="a5"]`).click();
    const mixed = await cards(page);
    const counts = mixed.reduce<Record<string, number>>((acc, card) => ({ ...acc, [card.format]: (acc[card.format] ?? 0) + (card.selected ? 1 : 0) }), {});
    const summary = await page.locator("[data-qr-summary]").innerText();
    check("PR-1", "выбор 1 A4 + 3 A5 + 13 наклеек, полоса «Выбрано: 17 · 5 листов»", counts.a4 === 1 && counts.a5 === 3 && counts.sticker === 13 && /Выбрано: 17 · 5 листов/.test(summary), { counts, summary });

    console.log("PR: print media");
    await page.emulateMedia({ media: "print" });
    const geometry = await page.evaluate(() => {
      const root = document.querySelector("[data-qr-print-root]") as HTMLElement | null;
      const sheets = Array.from(document.querySelectorAll("[data-qr-sheet]")) as HTMLElement[];
      return {
        rootParentIsBody: root?.parentElement === document.body,
        rootDisplay: root ? getComputedStyle(root).display : null,
        sheetsAreDirectChildren: sheets.every((sheet) => sheet.parentElement === root),
        sheetFormats: sheets.map((sheet) => sheet.getAttribute("data-qr-sheet")),
        heightsMm: sheets.map((sheet) => Math.round((sheet.getBoundingClientRect().height * 25.4) / 96)),
        display: sheets.map((sheet) => getComputedStyle(sheet).display),
        lastBreak: sheets.length ? getComputedStyle(sheets[sheets.length - 1]).breakAfter : null,
        firstBreak: sheets.length ? getComputedStyle(sheets[0]).breakAfter : null,
        forbidden: root ? root.querySelectorAll("header, footer, nav, aside, table").length : -1,
        svgMm: Array.from(root?.querySelectorAll("svg") ?? []).every((svg) => /mm$/.test(svg.getAttribute("width") ?? "") && /mm$/.test(svg.getAttribute("height") ?? "")),
        codes: root ? root.querySelectorAll("[data-qr-print-code]").length : 0,
        screenHidden: Array.from(document.body.children).filter((el) => el !== root && getComputedStyle(el).display !== "none").length,
      };
    });
    check(
      "PR-2",
      "печатное дерево: корень в body, листы — его прямые блочные дети, ≤ 250 мм, последний без разрыва, без header/footer/nav/aside/table, SVG в мм",
      geometry.rootParentIsBody &&
        geometry.rootDisplay === "block" &&
        geometry.sheetsAreDirectChildren &&
        geometry.sheetFormats.join(",") === "a4,a5,a5,sticker,sticker" &&
        geometry.heightsMm.every((h) => h <= 250) &&
        geometry.display.every((d) => d === "block") &&
        geometry.lastBreak === "auto" &&
        geometry.firstBreak === "page" &&
        geometry.forbidden === 0 &&
        geometry.svgMm &&
        geometry.codes === 17 &&
        geometry.screenHidden === 0,
      geometry
    );
    console.log("PR: pdf");
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    fs.writeFileSync(path.join(SHOTS, "print-mixed.pdf"), pdf);
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    check("PR-3", "page.pdf(preferCSSPageSize): 1 A4 + 3 A5 + 13 наклеек = 5 страниц", pageCount === 5, { pageCount });
    await page.setViewportSize({ width: 900, height: 1200 });
    await page.screenshot({ path: path.join(SHOTS, "print-mixed-media.png"), fullPage: true });

    console.log("PR: decode");
    // Каждый напечатанный QR декодируется в свой data-qr-url. Печать —
    // 300 dpi и выше: снимаем в контексте с deviceScaleFactor 3 (≈ 288 dpi)
    // тот же выбор, что на экране (сессия та же).
    const hi = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 3, storageState: await desk.storageState() });
    const hiPage = await hi.newPage();
    await openPage(hiPage, "kind=equipment&layout=sheet");
    await hiPage.locator(`[data-qr-id="${order[0]}"] [data-qr-format-option="a4"]`).click();
    for (const id of order.slice(1, 4)) await hiPage.locator(`[data-qr-id="${id}"] [data-qr-format-option="a5"]`).click();
    await hiPage.emulateMedia({ media: "print" });
    // Токен минтится при каждой отрисовке (в нём время) — сверяем с картами этой же страницы.
    const selectedUrls = new Set((await cards(hiPage)).filter((card) => card.selected).map((card) => card.url));
    const codes = hiPage.locator("[data-qr-print-code]");
    const n = await codes.count();
    const failures: unknown[] = [];
    const failDir = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/6bdc8fdd-ce53-4489-a636-2e1b1e95d14d/scratchpad/c";
    fs.mkdirSync(failDir, { recursive: true });
    const decodedUrls = new Set<string>();
    for (let i = 0; i < n; i += 1) {
      const node = codes.nth(i);
      const expected = await node.getAttribute("data-qr-print-url");
      const shot = await node.screenshot();
      const text = decodePng(shot);
      if (text) decodedUrls.add(text);
      if (!text) fs.writeFileSync(path.join(failDir, `hifail-${i}.png`), shot);
      if (!text || text !== expected) failures.push({ i, expected, text });
    }
    check("PR-4", `каждый напечатанный QR (${n}) декодируется в свой адрес (≈ 288 dpi)`, n === 17 && failures.length === 0, failures.slice(0, 3));
    check("PR-5", "напечатаны ровно выбранные карточки (data-qr-url экрана)", sameSet(Array.from(decodedUrls), Array.from(selectedUrls)), {
      decoded: decodedUrls.size,
      selected: selectedUrls.size,
    });
    await hi.close();
    await page.emulateMedia({ media: "screen" });
    await page.setViewportSize({ width: 1280, height: 900 });

    // Самый длинный URL: допуск гигиены по документу (+ &view=all) на наклейке 34 мм.
    await openPage(page, `kind=journals&layout=sheet&ids=${encodeURIComponent(`hygiene@verify:${D.hygiene}`)}`);
    const longUrl = (await cards(page)).find((card) => card.id === `hygiene@verify:${D.hygiene}`)?.url ?? "";
    await page.emulateMedia({ media: "print" });
    const sticker = page.locator("[data-qr-print-code]").first();
    const mm = await sticker.getAttribute("data-qr-print-mm");
    const box = await sticker.boundingBox();
    // Масштаб 1 CSS px = 1 px (96 dpi) — грубее любого принтера (300+ dpi).
    const lowRes = decodePng(await sticker.screenshot());
    await page.screenshot({ path: path.join(SHOTS, "print-sticker-longest.png"), clip: { x: 0, y: 0, width: 800, height: 300 } });
    check(
      "PR-6",
      `самый длинный URL (${longUrl.length} символов, hygiene@verify + документ + &view=all) читается с наклейки 34 мм при 96 dpi`,
      mm === "34" && longUrl.includes("view=all") && lowRes === longUrl && Math.round(((box?.width ?? 0) * 25.4) / 96) === 34,
      { mm, box, lowRes, longUrl }
    );
    await page.emulateMedia({ media: "screen" });
  }

  // ------------------------------------------- основной QR сети — на активную точку
  if (wants("LOC")) {
    const locContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const locPage = await login(locContext, state.users.managerLoc);
    await openPage(locPage, journalQrHref("fryer_oil").split("?")[1]);
    const list = await cards(locPage);
    const main = list.find((card) => card.id === "fryer_oil");
    const { verifyJournalFillToken } = await import("../../../../src/lib/journal-fill");
    const tokenCheck = verifyJournalFillToken(new URL(main?.url ?? "http://x").searchParams.get("token") ?? "", state.orgLoc, "fryer_oil");
    const text = await locPage.locator('[data-qr-id="fryer_oil"]').innerText();
    check(
      "LOC-1",
      "в сети точек основной QR привязан к активной точке (b~), точка — в подписи",
      tokenCheck.ok && tokenCheck.buildingId === state.buildings.b2 && text.includes("Точка на Мира"),
      { tokenCheck, text }
    );
    const extra = list.find((card) => card.id === `fryer_oil:${D.locFryerB2}`);
    check("LOC-2", "дополнительный QR документа точки — в списке, точка в подписи", Boolean(extra) && (await locPage.locator(`[data-qr-id="fryer_oil:${D.locFryerB2}"]`).innerText()).includes("Точка на Мира"));
    await locContext.close();
  }

  // ------------------------------------------------------ AC11: диалог документа
  if (wants("DLG")) {
    await goto(page, `${BASE}/journals/fryer_oil/documents/${D.fryerA}`);
    await page.waitForLoadState("networkidle").catch(() => null);
    // Инструкция по заполнению открывается сама при первом заходе — закрыть.
    const guide = page.locator('[aria-labelledby="fill-guide-title"]');
    if (await guide.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
      if (await guide.isVisible().catch(() => false)) await guide.getByRole("button", { name: "Закрыть" }).last().click({ force: true });
      await guide.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
    }
    await page.getByRole("button", { name: "Ещё действия" }).first().click({ timeout: 60_000 });
    await page.getByText("QR: заполнить с телефона").last().click();
    await page.waitForSelector('[data-qr-preview-id] [data-qr-valid-until], [data-qr-preview-id] .qr-fill-preview-box svg', { timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-qr-preview-id] .qr-fill-preview-box svg").length === 2, null, { timeout: 60_000 });
    const previews = await page.$$eval("[data-qr-preview-id]", (nodes) =>
      nodes.map((node) => ({ id: node.getAttribute("data-qr-preview-id"), text: node.textContent ?? "", until: node.querySelector("[data-qr-valid-until]")?.getAttribute("data-qr-valid-until") ?? null }))
    );
    const [, m, d] = state.periods.curMonthTo.split("-");
    check(
      "DLG-1",
      "диалог QR документа: первым основной QR («Код бессрочный»), вторым QR документа «до ДД.ММ»",
      previews.length === 2 &&
        previews[0].id === "fryer_oil" &&
        previews[0].text.includes("Код бессрочный") &&
        !previews[0].until &&
        previews[1].id === `fryer_oil:${D.fryerA}` &&
        previews[1].until === state.periods.curMonthTo &&
        previews[1].text.includes(`до ${d}.${m}`) &&
        !previews[1].text.includes("Код бессрочный"),
      previews.map((p) => ({ ...p, text: p.text.slice(0, 200) }))
    );
    await page.screenshot({ path: path.join(SHOTS, "dialog-document-qr-1280.png") });
    await page.keyboard.press("Escape");
  }

  // --------------------------------- AC14: 360/390/1280, светлая и тёмная темы
  if (wants("VP")) {
    const results: unknown[] = [];
    let allOk = true;
    for (const theme of ["light", "dark"] as const) {
      await db.user.update({ where: { email: state.users.manager }, data: { themePreference: theme } });
      for (const width of [360, 390, 1280]) {
        const context = await browser.newContext({
          viewport: { width, height: width < 800 ? 800 : 900 },
          colorScheme: theme,
          ...(width < 800 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
        });
        // Тема кабинета: выбор «светлая/тёмная» хранится на устройстве.
        await context.addInitScript((mode) => {
          try {
            window.localStorage.setItem("wesetup-theme-mode", mode);
            window.localStorage.setItem("wesetup-app-theme", mode);
          } catch {
            /* storage blocked */
          }
        }, theme);
        const vp = await login(context, state.users.manager);
        for (const [slug, query] of [
          ["hygiene", journalQrHref("hygiene").split("?")[1]],
          ["cold", journalQrHref("cold_equipment_control").split("?")[1]],
          ["overview", ""],
        ] as const) {
          await openPage(vp, query);
          // Первая строка документа отмечена — виден её формат.
          if (slug === "hygiene") await vp.locator('[data-qr-group="extra"] label').first().click();
          await vp.waitForTimeout(300);
          const metrics = await vp.evaluate(() => {
            const scope = [document.querySelector("[data-qr-page]"), document.querySelector("[data-selection-bar]")].filter(Boolean) as Element[];
            const small: string[] = [];
            for (const root of scope) {
              for (const el of Array.from(root.querySelectorAll("a, button, [role=radio], label"))) {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                const style = getComputedStyle(el);
                if (style.visibility === "hidden" || style.display === "none") continue;
                // Ссылка внутри текста абзаца — не отдельная цель касания.
                if (el.tagName === "A" && el.closest("p")) continue;
                if (Math.min(rect.width, rect.height) < 44 - 0.5) small.push(`${el.tagName}:${(el.textContent ?? "").trim().slice(0, 30)}:${Math.round(rect.width)}x${Math.round(rect.height)}`);
              }
            }
            return {
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              small,
              theme: document.querySelector(".app-shell")?.getAttribute("data-app-theme"),
            };
          });
          const ok = metrics.scrollWidth <= metrics.innerWidth && metrics.small.length === 0 && metrics.theme === theme;
          if (!ok) allOk = false;
          results.push({ wanted: theme, width, slug, ...metrics });
          await vp.screenshot({ path: path.join(SHOTS, `page-${slug}-${width}-${theme}.png`), fullPage: width !== 1280 || slug !== "overview" });
        }
        await context.close();
      }
    }
    await db.user.update({ where: { email: state.users.manager }, data: { themePreference: "light" } });
    check("VP-1", "360/390/1280 × светлая/тёмная: без горизонтального скролла, цели касания ≥ 44px", allOk, results.filter((r) => {
      const x = r as { scrollWidth: number; innerWidth: number; small: string[]; theme: string; wanted: string };
      return x.scrollWidth > x.innerWidth || x.small.length > 0 || x.theme !== x.wanted;
    }));
  }

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(HERE, "page-e2e.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
