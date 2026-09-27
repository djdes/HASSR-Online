/**
 * AC3: в плитке нет цвета — ни одного цветного оператора PDF, ни одного
 * нечерно-белого пикселя PNG, ни одного цвета SVG, кроме чёрного и белого.
 *
 *   1. PDF, плитка отдельно: `drawBrandQrTilePdf` (с рамкой) и
 *      `drawBrandQrCellPdf` (в ячейке шапки) на пустом листе — поток
 *      страницы: операторы цвета только серые (`g`/`G`), значения 0 или 1;
 *      картинок (`Do`) нет.
 *   2. PDF, настоящие бланки (наборы pages.ts): поток каждой страницы с QR =
 *      поток «пробы» (место под QR оставлено, плитка не нарисована) + операторы
 *      плитки; в этом хвосте — то же правило. У шаблонов (/qb) после плитки
 *      идёт строка копирайта внизу листа (не плитка) — её блок `BT…ET`
 *      отрезается и проверяется, что это она.
 *   3. PNG всех мест (ширины из маршрутов: окна, сертификат, Word): каждый
 *      пиксель — оттенок серого (r = g = b); доля чистых 0/255.
 *   4. SVG (плакаты, наклейки, лендинг, лист проверяющих, личный вход):
 *      цвета fill/stroke — только #000000 и #ffffff; нет <image>, градиентов,
 *      style с цветом.
 *   5. Word: PNG в подвале DOCX — как п. 3.
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/check-color.ts [набор,набор]
 * Итог — raw/check-color.json.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

import { BLANK_QR_LINES } from "@/lib/blank-qr-token";
import { brandQrLayout, brandQrPng, brandQrSvg, drawBrandQrCellPdf, drawBrandQrTilePdf } from "@/lib/brand-qr";
import { renderJournalDocumentDocx } from "@/lib/document-docx";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { docxQrUrl } from "./docx-templates";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-bw-minimal-2026-09");
const ORIGIN = "https://wesetup.ru";
const LONGEST =
  "https://wesetup.ru/journal-fill/cmg1abcdefghijklmnopqrstu/hygiene?token=journal%3Acmg1abcdefghijklmnopqrstu%3Ahygiene%3Acmg2abcdefghijklmnopqrstu%3A2026-09-30.1758900000000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&view=all";

type OpCheck = { grayOps: number; values: string[]; colorOps: string[]; images: number };

/** Операторы цвета и картинки в куске потока содержимого PDF. */
function scanOps(stream: string): OpCheck {
  const colorOps = stream.match(/(?:^|[\s\]])(?:[-\d.]+\s+){1,4}(?:rg|RG|k|K|sc|SC|scn|SCN)(?=\s|$)|\/\w+\s+(?:cs|CS)(?=\s|$)/g) ?? [];
  const gray = Array.from(stream.matchAll(/(?:^|\s)([-\d.]+)\s+[gG](?=\s|$)/g), (m) => Number(m[1]));
  const values = [...new Set(gray.map((v) => String(v)))];
  const images = (stream.match(/\sDo(?=\s|$)/g) ?? []).length;
  return { grayOps: gray.length, values, colorOps: colorOps.map((s) => s.trim()), images };
}

const pureBw = (op: OpCheck) => op.colorOps.length === 0 && op.images === 0 && op.values.every((v) => v === "0" || v === "1");

/** Потоки содержимого страниц несжатого PDF jsPDF, по порядку страниц. */
function pageStreams(pdf: Buffer): string[] {
  const text = pdf.toString("latin1");
  const objects = new Map<number, string>();
  for (const m of text.matchAll(/(\d+) 0 obj\s*<<\s*\/Length \d+\s*>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) objects.set(Number(m[1]), m[2]);
  const pages: string[] = [];
  for (const m of text.matchAll(/<<\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R[\s\S]*?>>/g)) pages.push(objects.get(Number(m[1])) ?? "");
  return pages;
}

async function pixelsOf(png: Buffer) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  let nonGray = 0;
  let extremes = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) nonGray += 1;
    if ((data[i] === 0 || data[i] === 255) && data[i] === data[i + 1] && data[i] === data[i + 2]) extremes += 1;
  }
  const total = data.length / 4;
  return { width: image.width, height: image.height, nonGray, bw: +(extremes / total).toFixed(4) };
}

function svgColors(svg: string) {
  const colors = new Set(Array.from(svg.matchAll(/(?:fill|stroke|stop-color|color)="([^"]+)"/g), (m) => m[1].toLowerCase()));
  colors.delete("none");
  return {
    colors: [...colors].sort(),
    images: (svg.match(/<image/g) ?? []).length,
    gradients: (svg.match(/Gradient/g) ?? []).length,
    styleColors: (svg.match(/style="[^"]*(?:fill|color|stroke)[^"]*"/g) ?? []).length,
  };
}

async function main() {
  const sets = new Set((process.argv[2] ?? "samples,blanks,long,paper,variants,portrait").split(","));
  const report: Record<string, unknown> = {};
  let ok = true;
  const fail = (what: string, details: unknown) => {
    ok = false;
    console.log(`FAIL ${what} ${JSON.stringify(details)}`);
  };

  // 1. Плитка отдельно.
  const isolated: Record<string, OpCheck> = {};
  for (const [name, url] of [
    ["short", `${ORIGIN}/journals-info/hygiene`],
    ["longest", LONGEST],
  ] as const) {
    for (const mode of ["tile", "cell"] as const) {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const fontName = registerJournalUnicodeFont(doc);
      const layout = brandQrLayout(url);
      if (mode === "tile") drawBrandQrTilePdf(doc, layout, 20, 20, 30, { fontName });
      else drawBrandQrCellPdf(doc, layout, { x0: 20, y0: 20, x1: 20 + layout.window.w * 0.4, y1: 20 + (layout.window.h + layout.strip!.h) * 0.4 + 2 }, { fontName });
      const op = scanOps(pageStreams(Buffer.from(doc.output("arraybuffer")))[0]);
      isolated[`${name}-${mode}`] = op;
      if (!pureBw(op)) fail(`плитка ${name}-${mode}`, op);
    }
  }
  report.isolated = isolated;
  console.log("1. плитка отдельно:", JSON.stringify(isolated));

  // 2. Настоящие бланки: хвост потока страницы после пробы.
  const docs: Array<{ set: string; label: string; pages: number; qrPages: number; grayOps: number; values: string[]; colorOps: number; images: number; footerCut: number }> = [];
  for (const item of buildCases(sets)) {
    const stamp = pageStreams(item.render("stamp").buffer);
    const probe = pageStreams(item.render("probe").buffer);
    let qrPages = 0;
    let footerCut = 0;
    const total: OpCheck = { grayOps: 0, values: [], colorOps: [], images: 0 };
    for (let i = 0; i < stamp.length; i += 1) {
      if (!stamp[i].startsWith(probe[i])) {
        fail(`${item.set}:${item.label} стр. ${i + 1}: поток пробы — не начало потока с QR`, { stamp: stamp[i].length, probe: probe[i].length });
        continue;
      }
      let tail = stamp[i].slice(probe[i].length);
      if (!tail.trim()) continue;
      // Строка копирайта шаблона (/qb) — последний блок текста, после плитки.
      if (item.set === "blanks" || item.set === "paper") {
        const cut = tail.lastIndexOf("\nBT");
        const footer = tail.slice(cut);
        if (cut < 0 || !/\sTj|\sTJ/.test(footer)) fail(`${item.set}:${item.label} стр. ${i + 1}: нет строки копирайта в конце`, footer.slice(0, 200));
        tail = tail.slice(0, cut);
        footerCut += 1;
      }
      if (!/\sre\s/.test(tail)) continue; // на странице QR нет (угол занят)
      qrPages += 1;
      const op = scanOps(tail);
      total.grayOps += op.grayOps;
      total.values = [...new Set([...total.values, ...op.values])];
      total.colorOps.push(...op.colorOps);
      total.images += op.images;
      if (!pureBw(op)) fail(`${item.set}:${item.label} стр. ${i + 1}`, op);
    }
    docs.push({ set: item.set, label: item.label, pages: stamp.length, qrPages, grayOps: total.grayOps, values: total.values.sort(), colorOps: total.colorOps.length, images: total.images, footerCut });
  }
  const docsSummary = {
    documents: docs.length,
    pages: docs.reduce((s, d) => s + d.pages, 0),
    qrPages: docs.reduce((s, d) => s + d.qrPages, 0),
    grayOps: docs.reduce((s, d) => s + d.grayOps, 0),
    grayValues: [...new Set(docs.flatMap((d) => d.values))].sort(),
    colorOps: docs.reduce((s, d) => s + d.colorOps, 0),
    images: docs.reduce((s, d) => s + d.images, 0),
  };
  report.documents = docsSummary;
  console.log("2. бланки:", JSON.stringify(docsSummary));

  // 3. PNG мест выдачи (ширины — как в маршрутах).
  const pngPlaces: Array<[string, string, number]> = [
    ["приглашение в Telegram (окно сотрудника)", `${ORIGIN}/api/telegram/start?invite=abcdefghijklmnopqrstuvwxyzABCDEF0123`, 440],
    ["приглашение сотрудника (tg)", "https://t.me/wesetupbot?start=inv_abcdefghijklmnopqrstuvwxyzABCDEF0123", 480],
    ["сопряжение", `${ORIGIN}/pair/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ`, 560],
    ["планшет-киоск", `${ORIGIN}/api/kiosk/claim/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ`, 600],
    ["QR-регистрация", `${ORIGIN}/join/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ`, 640],
    ["сертификат (PNG в PDF)", `${ORIGIN}/inspector/cmg1abcdefghijklmnopqrstu`, 1000],
    ["самый длинный адрес", LONGEST, 600],
  ];
  const png: Record<string, unknown> = {};
  for (const [name, url, width] of pngPlaces) {
    const p = await pixelsOf(await brandQrPng(url, { width }));
    png[name] = { width, ...p };
    if (p.nonGray > 0) fail(`PNG ${name}`, p);
  }
  report.png = png;
  console.log("3. PNG:", JSON.stringify(png));

  // 4. SVG.
  const svgPlaces: Array<[string, string, boolean]> = [
    ["плакат / наклейка, самый длинный адрес", LONGEST, true],
    ["лист проверяющих", `${ORIGIN}/inspector/cmg1abcdefghijklmnopqrstu`, true],
    ["личный вход", `${ORIGIN}/login/qr/abcdefghijklmnopqrstuvwxyzABCDEF`, true],
    ["наклейка лендинга (без полосы)", "https://wesetup.ru/#qr", false],
  ];
  const svg: Record<string, unknown> = {};
  for (const [name, url, caption] of svgPlaces) {
    const s = svgColors(await brandQrSvg(url, { caption }));
    svg[name] = s;
    if (s.colors.some((c) => c !== "#000000" && c !== "#ffffff") || s.images || s.gradients || s.styleColors) fail(`SVG ${name}`, s);
  }
  report.svg = svg;
  console.log("4. SVG:", JSON.stringify(svg));

  // 5. Word.
  const { buffer } = await renderJournalDocumentDocx(buildJournalSampleInput("hygiene"), "hygiene", {
    footer: { qrUrl: docxQrUrl("hygiene"), lines: BLANK_QR_LINES },
  });
  const zip = await JSZip.loadAsync(buffer);
  const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  const word: Record<string, unknown> = {};
  for (const name of media) {
    const p = await pixelsOf(await zip.file(name)!.async("nodebuffer"));
    word[name] = p;
    if (p.nonGray > 0) fail(`Word ${name}`, p);
  }
  report.word = word;
  console.log("5. Word:", JSON.stringify(word));

  report.ok = ok;
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  fs.writeFileSync(path.join(TASK_DIR, "raw", "check-color.json"), JSON.stringify({ report, documents: docs }, null, 1));
  console.log(ok ? "\nOK: в плитке только чёрный и белый" : "\nЕСТЬ ЦВЕТ");
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
