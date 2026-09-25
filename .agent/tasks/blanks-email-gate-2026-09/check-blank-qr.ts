/**
 * Автопроверка копирайта и QR в скачиваемых шаблонах (AC3).
 *
 * Логика — та же, что у `.agent/tasks/journal-pdf-qr-2026-09/check-qr-overlap.ts`
 * (растр 200 dpi, «проба» без штампа → 0 тёмных пикселей в зоне QR+подписи,
 * модули матрицы против `QRCode.create(url)`), только QR — новый, шаблонный:
 * `/qb/<токен>` + подпись «Заполнять с телефона — wesetup.ru» + строка
 * копирайта. Дополнительно:
 *   • текст каждой страницы (pdf.js) содержит обе части копирайта и подпись;
 *   • QR с растра каждой страницы декодируется НЕЗАВИСИМО — OpenCV
 *     (python cv2.QRCodeDetector), строка должна совпасть с адресом, а токен
 *     из адреса — расшифроваться в ту же почту и журнал.
 *
 * Запуск (из корня репо, секрет — любой тестовый):
 *   NEXTAUTH_SECRET=... npx tsx .agent/tasks/blanks-email-gate-2026-09/check-blank-qr.ts [samples|paper|all]
 * Переменные: BLANK_EMAIL — почта в токене (по умолчанию самая длинная,
 * что помещается в QR на https://wesetup.ru: 39 символов, самый плотный QR);
 * BLANK_EMAIL=none — токен без почты (как у встроенного просмотра);
 * SHOTS=<код,код> — сохранить угол страницы в evidence/; ONLY=<код,paper:id> — только эти;
 * PYTHON — путь к python.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { SAMPLE_JOURNAL_CODES, SAMPLE_ORGANIZATION, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { journalQrMatrix, type JournalPdfQr, type JournalQrPlacement } from "@/lib/pdf-journal-qr";
import { renderPaperJournalPdfDetailed } from "@/lib/paper-journal-pdf";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";
import { blankTargetKey, type BlankTarget } from "@/lib/blank-download";
import { blankPdfQr, openBlankQrToken } from "@/lib/blank-qr-token";

const DPI = 200;
const PX_PER_MM = DPI / 25.4;
const ORIGIN = "https://wesetup.ru";
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "blanks-email-gate-2026-09");
const RAW_DIR = path.join(TASK_DIR, "raw");
const SHOTS_DIR = path.join(TASK_DIR, "evidence");
const CROPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "blank-qr-crops-"));
const EMAIL =
  process.env.BLANK_EMAIL === "none"
    ? null
    : (process.env.BLANK_EMAIL ?? "zaveduyushchaya.proizv@kombinat-pita.ru");

type Raster = { width: number; height: number; data: Uint8ClampedArray; widthMm: number; heightMm: number };

async function rasterize(pdf: Buffer): Promise<{ rasters: Raster[]; texts: string[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const rasters: Raster[] = [];
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
        typeof page.render
      >[0]).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      rasters.push({
        width: canvas.width,
        height: canvas.height,
        data: img.data,
        widthMm: (base.width / 72) * 25.4,
        heightMm: (base.height / 72) * 25.4,
      });
      const content = await page.getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join("\n"));
    }
    return { rasters, texts };
  } finally {
    await task.destroy();
  }
}

function darkAt(r: Raster, px: number, py: number): boolean {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = Math.min(r.width - 1, Math.max(0, Math.floor(px) + dx));
      const y = Math.min(r.height - 1, Math.max(0, Math.floor(py) + dy));
      const i = (y * r.width + x) * 4;
      sum += (r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3;
      n += 1;
    }
  }
  return sum / n < 128;
}

function inkInBox(r: Raster, box: { x0: number; y0: number; x1: number; y1: number }): number {
  let count = 0;
  const x0 = Math.max(0, Math.floor(box.x0 * PX_PER_MM));
  const y0 = Math.max(0, Math.floor(box.y0 * PX_PER_MM));
  const x1 = Math.min(r.width, Math.ceil(box.x1 * PX_PER_MM));
  const y1 = Math.min(r.height, Math.ceil(box.y1 * PX_PER_MM));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * r.width + x) * 4;
      if (Math.min(r.data[i], r.data[i + 1], r.data[i + 2]) < 235) count += 1;
    }
  }
  return count;
}

function moduleMismatches(r: Raster, p: JournalQrPlacement, url: string): number {
  const qr = journalQrMatrix(url);
  const n = qr.modules.size;
  const cell = p.size / n;
  let bad = 0;
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      const cx = (p.x + (col + 0.5) * cell) * PX_PER_MM;
      const cy = (p.y + (row + 0.5) * cell) * PX_PER_MM;
      if (darkAt(r, cx, cy) !== Boolean(qr.modules.get(row, col))) bad += 1;
    }
  }
  return bad;
}

/** Кроп QR + 3 мм тихой зоны → PNG для независимого декодера. */
function saveCrop(r: Raster, p: JournalQrPlacement, name: string): string {
  const margin = 3;
  const x0 = Math.max(0, Math.floor((p.x - margin) * PX_PER_MM));
  const y0 = Math.max(0, Math.floor((p.y - margin) * PX_PER_MM));
  const x1 = Math.min(r.width, Math.ceil((p.x + p.size + margin) * PX_PER_MM));
  const y1 = Math.min(r.height, Math.ceil((p.y + p.size + margin) * PX_PER_MM));
  const w = x1 - x0;
  const h = y1 - y0;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const from = ((y0 + y) * r.width + x0) * 4;
    img.data.set(r.data.subarray(from, from + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  const file = path.join(CROPS_DIR, `${name}.png`);
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
  return file;
}

async function saveCorner(r: Raster, name: string, p: JournalQrPlacement) {
  // Правый нижний угол: 120×60 мм, 200 dpi → ~950×470 px (маленький PNG).
  const wMm = 120;
  const hMm = 60;
  const x0 = Math.max(0, Math.round((Math.min(r.widthMm, p.x + p.size + 8) - wMm) * PX_PER_MM));
  const y0 = Math.max(0, Math.round((Math.min(r.heightMm, p.y + p.size + 5) - hMm) * PX_PER_MM));
  const w = Math.min(r.width - x0, Math.round(wMm * PX_PER_MM));
  const h = Math.min(r.height - y0, Math.round(hMm * PX_PER_MM));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const from = ((y0 + y) * r.width + x0) * 4;
    img.data.set(r.data.subarray(from, from + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_DIR, name), canvas.toBuffer("image/png"));
}

type Rendered = { buffer: Buffer; qrPlacements?: JournalQrPlacement[] };

type PageResult = {
  page: number;
  moved: boolean;
  bottomRow: boolean;
  overlap: boolean;
  modules: number;
  inkInZoneBeforeStamp: number;
  moduleMismatches: number;
  copyright: boolean;
  caption: boolean;
  crop: string;
  decoded?: string | null;
  decodedOk?: boolean;
};

type Result = {
  label: string;
  target: string;
  url: string;
  tokenEmail: string | null;
  tokenTarget: string | null;
  pagesWithoutQr: number;
  pagesWithQr: number;
  pages: PageResult[];
  ok: boolean;
};

const COPYRIGHT_PARTS = ["© WeSetup — электронные журналы", "ХАССП и СанПиН · wesetup.ru"];

function hasAll(text: string, parts: string[]): boolean {
  const flat = text.replace(/\s+/g, " ");
  return parts.every((part) => flat.includes(part));
}

async function checkOne(
  label: string,
  target: BlankTarget,
  render: (qr: JournalPdfQr | null) => Rendered,
  shot: boolean,
): Promise<Result> {
  const qr = blankPdfQr(ORIGIN, { target, email: EMAIL });
  const url = qr.url;
  const opened = openBlankQrToken(url.split("/qb/")[1] ?? "");
  const plain = render(null);
  const probe = render({ ...qr, probeOnly: true });
  const stamped = render(qr);
  const plainPages = (await rasterize(plain.buffer)).rasters.length;
  const probeRaster = (await rasterize(probe.buffer)).rasters;
  const { rasters, texts } = await rasterize(stamped.buffer);
  const placements = stamped.qrPlacements ?? [];
  const probePlacements = probe.qrPlacements ?? [];
  if (placements.length !== rasters.length) throw new Error(`${label}: QR не на всех страницах`);
  const samePlaces =
    probePlacements.length === placements.length &&
    probePlacements.every((p, i) => Math.abs(p.x - placements[i].x) < 1e-6 && Math.abs(p.y - placements[i].y) < 1e-6);

  const pages: PageResult[] = placements.map((p, index) => {
    const probeP = probePlacements[index];
    const zone = { x0: probeP.block.x0 - 1, y0: probeP.block.y0 - 1, x1: probeP.block.x1 + 1, y1: probeP.block.y1 + 1 };
    return {
      page: p.page,
      moved: p.moved,
      bottomRow: p.bottomRow,
      overlap: p.overlap,
      modules: p.modules,
      inkInZoneBeforeStamp: inkInBox(probeRaster[index], zone),
      moduleMismatches: moduleMismatches(rasters[index], p, url),
      copyright: hasAll(texts[index], COPYRIGHT_PARTS),
      caption: hasAll(texts[index], ["Заполнять с телефона —", "wesetup.ru"]),
      crop: saveCrop(rasters[index], p, `${label.replace(/[^a-z0-9_-]/gi, "_")}-p${p.page}`),
    };
  });
  if (shot && placements[0]) await saveCorner(rasters[0], `pdf-corner-${label.replace(/[^a-z0-9_-]/gi, "_")}.png`, placements[0]);
  const ok =
    samePlaces &&
    pages.every((p) => p.inkInZoneBeforeStamp === 0 && p.moduleMismatches === 0 && !p.overlap && p.copyright && p.caption);
  return {
    label,
    target: blankTargetKey(target),
    url,
    tokenEmail: opened?.email ?? null,
    tokenTarget: opened?.target ? blankTargetKey(opened.target) : null,
    pagesWithoutQr: plainPages,
    pagesWithQr: rasters.length,
    pages,
    ok: ok && opened !== null && (opened.target ? blankTargetKey(opened.target) === blankTargetKey(target) : false),
  };
}

function decodeAll(results: Result[]) {
  const python = process.env.PYTHON ?? "python";
  const script = [
    "import cv2, json, sys",
    "det = cv2.QRCodeDetector()",
    "out = {}",
    "aruco = cv2.QRCodeDetectorAruco()",
    "for f in json.load(sys.stdin):",
    "    img = cv2.imread(f)",
    "    text = ''",
    "    for d, big in ((det, cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)),",
    "                   (det, cv2.resize(img, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)),",
    "                   (aruco, cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))):",
    "        text, pts, _ = d.detectAndDecode(big)",
    "        if text: break",
    "    out[f] = text or None",
    "print(json.dumps(out))",
  ].join("\n");
  const files = results.flatMap((r) => r.pages.map((p) => p.crop));
  const run = spawnSync(python, ["-c", script], { input: JSON.stringify(files), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`cv2 decode failed: ${run.stderr}`);
  const decoded = JSON.parse(run.stdout) as Record<string, string | null>;
  for (const r of results) {
    for (const p of r.pages) {
      p.decoded = decoded[p.crop] ?? null;
      p.decodedOk = p.decoded === r.url;
      if (!p.decodedOk) r.ok = false;
    }
  }
}

async function main() {
  const mode = process.argv[2] ?? "all";
  const shots = new Set((process.env.SHOTS ?? "").split(",").filter(Boolean));
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const results: Result[] = [];
  if (mode === "samples" || mode === "all") {
    for (const code of SAMPLE_JOURNAL_CODES) {
      if (only && !only.has(code)) continue;
      const input = buildJournalSampleInput(code);
      results.push(
        await checkOne(`sample:${code}`, { kind: "code", code }, (qr) => renderJournalDocumentPdf({ ...input, qr }), shots.has(code)),
      );
    }
  }
  if (mode === "paper" || mode === "all") {
    for (const journal of PAPER_JOURNALS) {
      if (only && !only.has(`paper:${journal.id}`)) continue;
      results.push(
        await checkOne(
          `paper:${journal.id}`,
          { kind: "paper", paperId: journal.id },
          (qr) =>
            renderPaperJournalPdfDetailed({ journal, organization: SAMPLE_ORGANIZATION, rows: [], blankRows: 18, qr }),
          shots.has(`paper:${journal.id}`),
        ),
      );
    }
  }
  decodeAll(results);
  for (const r of results) {
    console.log(
      `${r.ok ? "OK  " : "FAIL"} ${r.label.padEnd(44)} pages ${r.pagesWithoutQr}→${r.pagesWithQr} ` +
        `ink=${r.pages.map((p) => p.inkInZoneBeforeStamp).join("/")} mism=${r.pages.map((p) => p.moduleMismatches).join("/")} ` +
        `modules=${r.pages[0]?.modules} moved=${r.pages.filter((p) => p.moved).length} up=${r.pages.filter((p) => !p.bottomRow).length} ` +
        `©=${r.pages.map((p) => (p.copyright ? "y" : "N")).join("")} cv2=${r.pages.map((p) => (p.decodedOk ? "y" : "N")).join("")}`,
    );
  }
  const suffix = EMAIL ? "email" : "noemail";
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RAW_DIR, `check-blank-qr-${mode}-${suffix}.json`),
    JSON.stringify(
      results.map((r) => ({ ...r, pages: r.pages.map(({ crop: _crop, ...rest }) => rest) })),
      null,
      2,
    ),
  );
  fs.rmSync(CROPS_DIR, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  const pages = results.reduce((n, r) => n + r.pages.length, 0);
  console.log(
    `\nпочта в токене: ${EMAIL ?? "нет"} (${EMAIL?.length ?? 0} симв.); в токенах: ${[...new Set(results.map((r) => r.tokenEmail))].join(", ")}`,
  );
  console.log(`страниц: ${pages}; ${results.length - failed.length}/${results.length} OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(CROPS_DIR, { recursive: true, force: true });
  process.exit(2);
});
