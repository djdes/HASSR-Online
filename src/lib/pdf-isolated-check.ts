import { Worker } from "node:worker_threads";

/**
 * Проверка PDF вне основного потока: «PDF-бомба» (сжатый поток объектов на
 * гигабайты) не должна ронять единственный процесс сервера для всех
 * организаций. Защита в два слоя:
 *
 *   1. в worker'е до pdf-lib — потоки, которые pdf-lib разжимает при
 *      открытии (/ObjStm и /XRef), распаковываются zlib с жёстким пределом
 *      `maxOutputLength` на все вместе: бомба упирается в предел за
 *      миллисекунды и не выделяет память сверх него;
 *   2. сам worker — с `resourceLimits` и таймаутом: зависание или рост кучи
 *      обрывают worker, а не сервер.
 *
 * Итог: ok (страниц N) | invalid (не PDF / пароль / повреждён) |
 * unreadable (превышены пределы — разбирать не стали).
 */

export type PdfCheckResult = { status: "ok"; pages: number } | { status: "invalid" } | { status: "unreadable" };

export type PdfCheckOptions = {
  /** Предел распаковки /ObjStm и /XRef на весь файл, байт. */
  inflateBudgetBytes?: number;
  timeoutMs?: number;
  maxOldGenerationSizeMb?: number;
};

export const PDF_CHECK_DEFAULTS = {
  inflateBudgetBytes: 32 * 1024 * 1024,
  timeoutMs: 5_000,
  maxOldGenerationSizeMb: 256,
} as const;

/** Не больше двух проверок одновременно: каждая — свой поток и своя куча. */
const MAX_PARALLEL = 2;
let running = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_PARALLEL) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
}

function release(): void {
  running -= 1;
  waiting.shift()?.();
}

// Код worker'а строкой (eval): так он не зависит от сборщика Next.
// pdf-lib берётся из node_modules рабочего каталога приложения.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const path = require("node:path");
const zlib = require("node:zlib");

function preInflate(bytes, budget) {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const re = /stream\r?\n/g;
  let match;
  let left = budget;
  while ((match = re.exec(text))) {
    const start = match.index + match[0].length;
    if (text.slice(Math.max(0, match.index - 3), match.index) === "end") continue;
    // Словарь потока — от «N 0 obj» до «stream» (вложенные << >> внутри).
    const objStart = text.lastIndexOf("obj", match.index);
    if (objStart < 0) continue;
    const dict = text.slice(objStart, match.index);
    if (!/\/Type\s*\/(ObjStm|XRef)\b/.test(dict)) continue;
    const filters = dict.match(/\/\w+Decode\b/g) || [];
    if (filters.length === 0) continue;
    if (filters.some((name) => name !== "/FlateDecode")) return "unreadable";
    const length = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
    let end = length && !length[2] ? start + Number(length[1]) : text.indexOf("endstream", start);
    if (end < start || end > text.length) end = text.indexOf("endstream", start);
    if (end < 0) end = text.length;
    let out;
    try {
      out = zlib.inflateSync(Buffer.from(bytes.buffer, bytes.byteOffset + start, end - start), {
        maxOutputLength: Math.max(1, left),
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
    } catch (error) {
      if (error && (error.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError)) return "unreadable";
      continue; // битый поток — решит pdf-lib
    }
    left -= out.length;
    if (left <= 0) return "unreadable";
  }
  return null;
}

(async () => {
  const bytes = workerData.bytes;
  if (preInflate(bytes, workerData.inflateBudgetBytes) === "unreadable") {
    parentPort.postMessage({ status: "unreadable" });
    return;
  }
  const load = createRequire(path.join(workerData.cwd, "package.json"));
  const { PDFDocument } = load("pdf-lib");
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = doc.getPageCount();
    parentPort.postMessage(pages > 0 ? { status: "ok", pages } : { status: "invalid" });
  } catch {
    parentPort.postMessage({ status: "invalid" });
  }
})();
`;

export async function checkPdfIsolated(bytes: Uint8Array, options: PdfCheckOptions = {}): Promise<PdfCheckResult> {
  const limits = { ...PDF_CHECK_DEFAULTS, ...options };
  await acquire();
  try {
    return await new Promise<PdfCheckResult>((resolve) => {
      let settled = false;
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { bytes, cwd: process.cwd(), inflateBudgetBytes: limits.inflateBudgetBytes },
        resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 32 },
      });
      const finish = (result: PdfCheckResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ status: "unreadable" }), limits.timeoutMs);
      worker.once("message", (message: PdfCheckResult) => finish(message));
      // ERR_WORKER_OUT_OF_MEMORY и прочие сбои — файл не разбираем.
      worker.once("error", () => finish({ status: "unreadable" }));
      worker.once("exit", () => finish({ status: "unreadable" }));
    });
  } finally {
    release();
  }
}
