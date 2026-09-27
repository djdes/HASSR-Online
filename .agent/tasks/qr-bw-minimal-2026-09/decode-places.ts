/**
 * Распознавание новой плитки во всех местах выдачи, кроме журналов (их —
 * `decode-journals.ts`): плакаты A4/A5, наклейки (самая узкая, самый длинный
 * адрес), лист проверяющих, карточка «Личный вход», печать окна
 * QR-регистрации, сертификат (PDF), подвал шаблона Word (DOCX → LibreOffice →
 * PDF); экран — окна приглашений, сопряжения, киоска, превью плаката, QR
 * входа, наклейки лендинга (×1/×2/×3).
 *
 * Печать: место рисуется один раз «как принтер» — 600 dpi (SVG и <img> —
 * Chromium в мм, PDF — pdf.js), дальше снимки как в `qr-sim.ts`: 300 и
 * 150 dpi — clean (усреднение по пикселю), bw (порог), bw-print (порог при
 * 600 dpi → снимок), phone / bw-phone (перспектива 4 %, поворот 5–10°,
 * σ 0,6 px, JPEG 90), phone-hard / bw-phone-hard (стресс). Приёмка: 300 dpi —
 * оба декодера, 150 dpi — zxing-cpp. Экран: CSS px × плотность, clean и
 * «телефон» с того же экрана; приёмка — оба декодера при ×2 и ×3, ×1 — стресс.
 *
 *   QR_VERIFY_DIR=D:/wt-build/verify-bwqr node --import tsx \
 *     .agent/tasks/qr-bw-minimal-2026-09/decode-places.ts
 * Растры — в BWQR_TMP (D:/wt-build/tmp-bwqr/places); итог — raw/decode-places.json.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.NEXTAUTH_URL = "https://wesetup.ru";
process.env.TELEGRAM_BOT_USERNAME ||= "wesetupbot";

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import {
  PHONE,
  PHONE_HARD,
  decodeJsQr,
  decodeZxing,
  downsample,
  openPdf,
  phoneCapture,
  renderRegion,
  savePng,
  threshold,
  type Raster,
} from "../journal-qr-header-2026-09/qr-sim";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-bw-minimal-2026-09");
const OUT = path.resolve(process.env.BWQR_TMP ?? "D:/wt-build/tmp-bwqr/places");
const SOFFICE = process.env.SOFFICE ?? "C:/Program Files/LibreOffice/program/soffice.exe";
const ORIGIN = "https://wesetup.ru";
const MASTER = 600;

type Source =
  | { type: "svg"; svg: string; widthMm: number }
  | { type: "img"; dataUrl: string; widthPx: number }
  | { type: "html"; html: string; widthPx: number }
  | { type: "pdf"; pdf: Buffer; crop: { x0: number; y0: number; x1: number; y1: number } };
type Place = { id: string; place: string; kind: "print" | "screen"; url: string; source: Source; size: string; densities?: number[] };

const cuid = (seed: string) => `cm${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 23)}`;
const fluidSvg = (svg: string) => svg.replace(/ width="\d+" height="\d+"/, ' style="display:block;width:100%;height:auto"');

async function buildPlaces(): Promise<Place[]> {
  const { brandQrLayout, brandQrPngDataUrl, brandQrSvg } = await import("@/lib/brand-qr");
  const { qrFillUrl } = await import("@/lib/qr-fill-poster");
  const { journalFillSubject } = await import("@/lib/journal-fill");
  const { personalLoginUrl } = await import("@/lib/personal-login");
  const { inspectorQrUrl } = await import("@/lib/inspector-qr-service");
  const { buildTelegramInviteUrl } = await import("@/lib/staff-telegram-invite");
  const { generateBotInviteRaw } = await import("@/lib/bot-invite-tokens");
  const { generateInviteToken } = await import("@/lib/invite-tokens");
  const { BLANK_QR_LINES } = await import("@/lib/blank-qr-token");
  const { renderJournalDocumentDocx } = await import("@/lib/document-docx");
  const { buildJournalSampleInput } = await import("@/lib/journal-sample-fixtures");
  const { docxQrUrl } = await import("./docx-templates");
  const { jsPDF } = await import("jspdf");

  const org = cuid("org");
  const urls = {
    journalMain: qrFillUrl(ORIGIN, "journal", journalFillSubject(org, "hygiene")),
    // Самый длинный адрес продукта: допуск гигиены по документу до конца периода (+ &view=all).
    journalLongest: qrFillUrl(ORIGIN, "journal", journalFillSubject(org, "hygiene", cuid("doc"), { validUntil: "2026-09-30" })) + "&view=all",
    equipment: qrFillUrl(ORIGIN, "equipment", cuid("fridge")),
    personal: personalLoginUrl(crypto.randomBytes(24).toString("base64url")),
    inspector: inspectorQrUrl(cuid("inspector")),
    tgInvite: buildTelegramInviteUrl(process.env.TELEGRAM_BOT_USERNAME ?? "wesetupbot", generateBotInviteRaw()),
    pair: `${ORIGIN}/pair/${generateInviteToken()}`,
    join: `${ORIGIN}/join/${generateInviteToken()}`,
    kiosk: `${ORIGIN}/api/kiosk/claim/${generateInviteToken()}`,
    landing: "https://wesetup.ru/#qr",
  };
  const places: Place[] = [];
  const svgPrint = async (id: string, place: string, url: string, widthMm: number) =>
    places.push({ id, place, kind: "print", url, source: { type: "svg", svg: await brandQrSvg(url), widthMm }, size: `${widthMm} мм` });
  await svgPrint("poster-a4", "Плакат A4 журнала (основной QR)", urls.journalMain, 105);
  await svgPrint("poster-a4-longest", "Плакат A4, самый длинный адрес", urls.journalLongest, 105);
  await svgPrint("poster-a5-longest", "Плакат A5, самый длинный адрес", urls.journalLongest, 78);
  await svgPrint("sticker-object", "Наклейка на холодильник (самая широкая)", urls.equipment, 36);
  await svgPrint("sticker-longest-min", "Наклейка, самый длинный адрес, самая узкая", urls.journalLongest, 29);
  await svgPrint("inspector-sheet", "Лист A4 «Для проверяющих»", urls.inspector, 73);
  await svgPrint("personal-card", "Карточка «Личный вход» (печать)", urls.personal, 70);
  places.push({
    id: "join-print",
    place: "QR-регистрация сотрудника (печать окна)",
    kind: "print",
    url: urls.join,
    source: { type: "img", dataUrl: await brandQrPngDataUrl(urls.join, { width: 640 }), widthPx: 320 },
    size: "320 CSS px = 84,7 мм",
  });

  // Сертификат: PNG помощника в jsPDF, как в /api/certificate (50 мм, верх 187 мм).
  const certPng = await brandQrPngDataUrl(urls.inspector, { width: 1000 });
  const cert = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const props = cert.getImageProperties(certPng);
  const certH = (50 * props.height) / props.width;
  cert.addImage(certPng, "PNG", 80, 187, 50, certH);
  places.push({
    id: "certificate",
    place: "Сертификат соответствия (PDF, A4)",
    kind: "print",
    url: urls.inspector,
    source: { type: "pdf", pdf: Buffer.from(cert.output("arraybuffer")), crop: { x0: 72, y0: 179, x1: 138, y1: 187 + certH + 8 } },
    size: "50 мм",
  });

  // Word: подвал шаблона → LibreOffice → PDF (самый плотный адрес /qb с почтой).
  const docxUrl = docxQrUrl("hygiene");
  const docx = await renderJournalDocumentDocx(buildJournalSampleInput("hygiene"), "hygiene", {
    footer: { qrUrl: docxUrl, lines: BLANK_QR_LINES },
  });
  const docxDir = path.join(OUT, "docx");
  fs.mkdirSync(docxDir, { recursive: true });
  const docxFile = path.join(docxDir, "blank-hygiene.docx");
  fs.writeFileSync(docxFile, docx.buffer);
  const profile = `file:///${path.join(OUT, "lo-profile").replace(/\\/g, "/")}`;
  const run = spawnSync(SOFFICE, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", docxDir, docxFile], {
    encoding: "utf8",
    timeout: 300_000,
  });
  const docxPdf = path.join(docxDir, "blank-hygiene.pdf");
  if (!fs.existsSync(docxPdf)) throw new Error(`LibreOffice: ${run.stderr || run.stdout}`);
  places.push({
    id: "docx-footer",
    place: "Подвал шаблона Word (DOCX → LibreOffice → PDF)",
    kind: "print",
    url: docxUrl,
    source: { type: "pdf", pdf: fs.readFileSync(docxPdf), crop: { x0: 146, y0: 236, x1: 204, y1: 294 } },
    size: "81 px Word ≈ 21,4 мм",
  });

  // Экран: CSS px × плотность.
  const screenPng = async (id: string, place: string, url: string, css: number, width: number) =>
    places.push({
      id,
      place,
      kind: "screen",
      url,
      source: { type: "img", dataUrl: await brandQrPngDataUrl(url, { width }), widthPx: css },
      size: `${css} CSS px`,
      densities: [1, 2, 3],
    });
  places.push({
    id: "login-screen",
    place: "QR входа на экране (карточка сотрудника)",
    kind: "screen",
    url: urls.personal,
    source: { type: "html", html: fluidSvg(await brandQrSvg(urls.personal)), widthPx: 180 },
    size: "180 CSS px",
    densities: [1, 2, 3],
  });
  await screenPng("tg-invite", "Приглашение в Telegram (окно сотрудника)", urls.tgInvite, 220, 440);
  await screenPng("tg-invite-thumb", "Приглашение в Telegram (миниатюра в «Доступе»)", urls.tgInvite, 128, 440);
  await screenPng("pair", "Сопряжение (окно)", urls.pair, 280, 560);
  await screenPng("join-dialog", "QR-регистрация (окно)", urls.join, 260, 640);
  await screenPng("kiosk", "Планшет-киоск (окно)", urls.kiosk, 220, 600);
  places.push({
    id: "poster-preview-dialog",
    place: "Превью плаката в окне журнала",
    kind: "screen",
    url: urls.equipment,
    source: { type: "html", html: fluidSvg(await brandQrSvg(urls.equipment)), widthPx: 184 },
    size: "184 CSS px",
    densities: [1, 2, 3],
  });
  const bare = fluidSvg(await brandQrSvg(urls.landing, { caption: false }));
  places.push({
    id: "landing-sticker",
    place: "Золотая наклейка лендинга (без полосы)",
    kind: "screen",
    url: urls.landing,
    source: {
      type: "html",
      widthPx: 240,
      html: `<div style="font-size:30px;width:240px"><div style="border-radius:0.95em;padding:0.42em;background:linear-gradient(135deg,#fff3c4 0%,#fcd34d 40%,#f5b301 75%,#dc9d00 100%)"><div style="background:#fff;border-radius:0.6em;padding:0.4em">${bare}</div><div style="margin-top:0.35em;color:#5b3a00;font-weight:700;font-size:0.66em;text-align:center">Отсканируйте</div></div></div>`,
    },
    size: "240 CSS px",
    densities: [1, 2],
  });
  const printed = fluidSvg(await brandQrSvg(urls.landing));
  places.push({
    id: "landing-video-sticker",
    place: "Наклейка в ролике лендинга (как печатает продукт)",
    kind: "screen",
    url: urls.landing,
    source: { type: "html", html: printed, widthPx: 150 },
    size: "150 CSS px",
    densities: [1, 2],
  });
  // Модуль у каждого места — для таблицы.
  for (const p of places) {
    const layout = brandQrLayout(p.url, { caption: p.id !== "landing-sticker" });
    const across = layout.width;
    const width = p.source.type === "svg" ? p.source.widthMm : p.id === "certificate" ? 50 : p.id === "docx-footer" ? (81 * 25.4) / 96 : p.id === "join-print" ? (320 * 25.4) / 96 : null;
    p.size += `; H v${layout.version}, ${layout.size} мод.` + (width ? `; модуль ${(width / across).toFixed(3)} мм` : `; ${((("widthPx" in p.source ? p.source.widthPx : 0) as number) / across).toFixed(2)} CSS px/мод.`);
  }
  return places;
}

async function pngToRaster(file: string): Promise<Raster> {
  const image = await loadImage(fs.readFileSync(file));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
}

type Row = { id: string; kind: string; dpi: number; shot: string; jsqr: boolean; zxing: boolean; acceptance: "both" | "zxing" | "stress" };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const places = await buildPlaces();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const rows: Row[] = [];
  const add = async (p: Place, dpi: number, shot: string, raster: Raster, acceptance: Row["acceptance"]) => {
    const jsqr = decodeJsQr(raster) === p.url;
    const zxing = (await decodeZxing(raster)) === p.url;
    rows.push({ id: p.id, kind: p.kind, dpi, shot, jsqr, zxing, acceptance });
    if ((acceptance === "both" && (!jsqr || !zxing)) || (acceptance === "zxing" && !zxing)) savePng(raster, path.join(OUT, "fail", `${p.id}-${dpi}-${shot}.png`));
    return `${dpi}${shot}:${jsqr ? "J" : "-"}${zxing ? "Z" : "-"}`;
  };
  try {
    let index = 0;
    for (const p of places) {
      const angle = (5 + (index % 6)) * (index % 2 === 0 ? 1 : -1);
      index += 1;
      const marks: string[] = [];
      const passes = p.kind === "print" ? [MASTER] : (p.densities ?? [1, 2]).map((d) => d * 96);
      for (const dpi of passes) {
        const file = path.join(OUT, `${p.id}@${dpi}.png`);
        if (p.source.type === "pdf") {
          const doc = await openPdf(p.source.pdf);
          savePng(await renderRegion(doc, 1, p.source.crop, dpi), file);
          await doc.close();
        } else {
          const context = await browser.newContext({ deviceScaleFactor: dpi / 96, viewport: { width: 1200, height: 1600 } });
          const page = await context.newPage();
          const body =
            p.source.type === "svg"
              ? `<div style="width:${p.source.widthMm}mm">${fluidSvg(p.source.svg)}</div>`
              : p.source.type === "img"
                ? `<img src="${p.source.dataUrl}" style="display:block;width:${p.source.widthPx}px;height:auto">`
                : `<div style="width:${p.source.widthPx}px">${p.source.html}</div>`;
          // Вокруг — белый лист 6 мм, как поле бумаги или окна.
          await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><div id="c" style="display:inline-block;padding:6mm;background:#fff">${body}</div></body></html>`);
          await page.evaluate(async () => {
            await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => null)));
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          await page.locator("#c").screenshot({ path: file });
          await context.close();
        }
        const raster = await pngToRaster(file);
        if (p.kind === "print") {
          const bw = threshold(raster);
          for (const shotDpi of [300, 150]) {
            const accept = shotDpi >= 300 ? "both" : "zxing";
            const clean = downsample(raster, MASTER / shotDpi);
            marks.push(await add(p, shotDpi, "clean", clean, accept));
            marks.push(await add(p, shotDpi, "bw", threshold(clean), accept));
            marks.push(await add(p, shotDpi, "bw-print", downsample(bw, MASTER / shotDpi), accept));
            marks.push(await add(p, shotDpi, "phone", await phoneCapture(raster, MASTER, shotDpi, { ...PHONE, angle }), accept));
            marks.push(await add(p, shotDpi, "bw-phone", await phoneCapture(bw, MASTER, shotDpi, { ...PHONE, angle }), accept));
            marks.push(await add(p, shotDpi, "phone-hard", await phoneCapture(raster, MASTER, shotDpi, { ...PHONE_HARD, angle }), "stress"));
            marks.push(await add(p, shotDpi, "bw-phone-hard", await phoneCapture(bw, MASTER, shotDpi, { ...PHONE_HARD, angle }), "stress"));
          }
        } else {
          // Экран: приёмка — плотность ×2 и выше (ретина, телефоны); ×1 — стресс,
          // как в qr-brand-2026-09 (у миниатюр и превью там 2,4–2,6 px на модуль).
          const accept = dpi >= 192 ? "both" : "stress";
          marks.push(await add(p, dpi, "screen", raster, accept));
          marks.push(await add(p, dpi, "screen-phone", await phoneCapture(raster, dpi, dpi, { ...PHONE, angle }), accept));
        }
      }
      console.log(`${p.id.padEnd(22)} ${p.size} | ${marks.join(" ")}`);
    }
  } finally {
    await browser.close();
  }
  const misses = rows.filter((r) => (r.acceptance === "both" && (!r.jsqr || !r.zxing)) || (r.acceptance === "zxing" && !r.zxing));
  const table = places.map((p) => {
    const own = rows.filter((r) => r.id === p.id);
    const group = (filter: (r: Row) => boolean) => {
      const list = own.filter(filter);
      return { n: list.length, jsqr: list.filter((r) => r.jsqr).length, zxing: list.filter((r) => r.zxing).length };
    };
    return {
      id: p.id,
      place: p.place,
      kind: p.kind,
      size: p.size,
      accept300: group((r) => r.kind === "print" && r.dpi === 300 && r.acceptance !== "stress"),
      accept150: group((r) => r.kind === "print" && r.dpi === 150 && r.acceptance !== "stress"),
      screen: group((r) => r.kind === "screen" && r.acceptance === "both"),
      screen1x: group((r) => r.kind === "screen" && r.dpi < 192),
      stress: group((r) => r.acceptance === "stress"),
    };
  });
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  fs.writeFileSync(path.join(TASK_DIR, "raw", "decode-places.json"), JSON.stringify({ table, misses, rows }, null, 1));
  console.log(`\nприёмка: ${rows.filter((r) => r.acceptance !== "stress").length} снимков, мимо: ${misses.length}`);
  for (const m of misses) console.log(`  не прочитано: ${m.id} ${m.dpi} ${m.shot} jsQR=${m.jsqr} zxing=${m.zxing}`);
  process.exit(misses.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
