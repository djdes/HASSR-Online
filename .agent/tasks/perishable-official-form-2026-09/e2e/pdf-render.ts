// Печать скоропорта «до» и «после»: образец (витрина) и документы e2e.
// Для каждого: PNG первой страницы (100 dpi) в shots/ и таблица первой
// страницы, прочитанная из самого PDF независимым разборщиком (PyMuPDF
// find_tables, pdf-tables.py) → raw/pdf-<phase>.json: какие колонки
// напечатаны, в каком порядке, и помещается ли таблица на лист.
// PDF-файлы — во временной папке ОС (в репозиторий не кладём).
// Запуск: npx tsx .agent/tasks/perishable-official-form-2026-09/e2e/pdf-render.ts before|after
import "./env";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

import { HERE, ORG_ID, TASK_DIR, db, readState } from "./db";

const DPI = 100;
const phase = process.argv[2] === "after" ? "after" : "before";
const SHOTS = path.join(TASK_DIR, "shots");
const RAW = path.join(TASK_DIR, "raw");
const PDF_DIR = path.join(os.tmpdir(), `perishable-official-form-pdf-${phase}`);

async function rasterFirstPage(buffer: Buffer, file: string) {
  const render = await import("@/lib/journal-preview/render");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = render.workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: render.standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: DPI / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0])
      .promise;
    fs.writeFileSync(file, canvas.toBuffer("image/png"));
  } finally {
    await task.destroy();
  }
}

async function main() {
  // Модули приложения — после ./env: src/lib/db.ts читает DATABASE_URL при загрузке.
  const { loadJournalDocumentPdfInput, renderJournalDocumentPdf } = await import("@/lib/document-pdf");
  const { buildJournalSampleInput } = await import("@/lib/journal-sample-fixtures");
  fs.mkdirSync(PDF_DIR, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });

  const state = readState();
  const rendered: Array<{ label: string; pdf: string; png: string; widthWarnings: string[] }> = [];
  const capture = async (label: string, make: () => Buffer | Promise<Buffer>) => {
    // autoTable пишет в консоль «… units width could not fit page» —
    // таблица шире листа. Ловим как признак.
    const warnings: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    const grab = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    console.log = grab;
    console.warn = grab;
    console.error = grab;
    let buffer: Buffer;
    try {
      buffer = await make();
    } finally {
      Object.assign(console, original);
    }
    const pdf = path.join(PDF_DIR, `${label}.pdf`);
    fs.writeFileSync(pdf, buffer);
    const png = path.join(SHOTS, `pdf-${label}-${phase}.png`);
    await rasterFirstPage(buffer, png);
    rendered.push({
      label,
      pdf,
      png: path.relative(TASK_DIR, png).split(path.sep).join("/"),
      widthWarnings: warnings.filter((w) => /could not fit page/.test(w)),
    });
  };

  await capture("sample", () => renderJournalDocumentPdf(buildJournalSampleInput("perishable_rejection")).buffer);
  for (const key of ["docNoColumns", "docOldStandard", "docOwnTemplate", "docE2E"]) {
    const id = state[key];
    if (!id) continue;
    await capture(key, async () =>
      renderJournalDocumentPdf(await loadJournalDocumentPdfInput({ documentId: id, organizationId: ORG_ID })).buffer
    );
  }

  const parsed = JSON.parse(
    execFileSync("python", [path.join(HERE, "pdf-tables.py"), ...rendered.map((item) => item.pdf)], {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      maxBuffer: 32 * 1024 * 1024,
    })
  ) as Record<string, { pages: number; tables: Array<{ bbox: number[]; pageWidth: number; cols: number; rows: string[][] }> }>;

  const results = rendered.map((item) => {
    const info = parsed[item.pdf];
    // Таблица журнала — самая широкая по числу колонок (шапка ХАССП — 3 колонки).
    const table = [...(info?.tables ?? [])].sort((a, b) => b.cols - a.cols)[0] ?? null;
    return {
      label: item.label,
      pages: info?.pages ?? 0,
      png: item.png,
      widthWarnings: item.widthWarnings,
      tableBboxPt: table?.bbox ?? null,
      pageWidthPt: table?.pageWidth ?? null,
      header: table?.rows[0] ?? [],
      body: table?.rows.slice(1) ?? [],
    };
  });
  fs.writeFileSync(path.join(RAW, `pdf-${phase}.json`), JSON.stringify(results, null, 2));
  for (const result of results) {
    const warn = result.widthWarnings.length ? `, ⚠ ${result.widthWarnings.join("; ")}` : "";
    console.log(`\n== ${result.label}: ${result.pages} стр., ${result.header.length} колонок, ${result.png}${warn}`);
    result.header.forEach((header, index) => console.log(`  ${String(index + 1).padStart(2)}. ${header}`));
  }
  fs.rmSync(PDF_DIR, { recursive: true, force: true });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
