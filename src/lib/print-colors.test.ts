import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Адрес QR шаблона подписывается секретом сервера (читается при вызове).
process.env.NEXTAUTH_SECRET ||= "test-secret-for-print-colors-0123456789";

import JSZip from "jszip";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

import {
  GRID_DAY_OFF_BG_CLASS,
  GRID_DAY_SHORT_BG_CLASS,
  getDayColumnBgClass,
} from "@/components/journals/journal-grid";
import { blankPdfQr } from "@/lib/blank-qr-token";
import { renderClosingDocumentPdf } from "@/lib/closing-documents/pdf";
import type { ClosingDocumentDraft, PartySnapshot } from "@/lib/closing-documents/types";
import { DOCX_SAMPLE_CODES, renderJournalDocumentDocx } from "@/lib/document-docx";
import {
  PDF_DAY_OFF_FILL,
  PDF_DAY_SHORT_FILL,
  renderJournalDocumentPdf,
  type JournalDocumentPdfInput,
} from "@/lib/document-pdf";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { SAMPLE_JOURNAL_CODES, SAMPLE_ORGANIZATION, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { renderOrderPdf } from "@/lib/orders/pdf";
import { renderPaperJournalPdf } from "@/lib/paper-journal-pdf";
import { buildCapaSummaryPdf, buildRegulatorCoverPdf } from "@/lib/regulator-bundle";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

/**
 * Печать без цвета: у заведений ч/б принтеры, поэтому всё, что сайт отдаёт
 * на бумагу, — только чёрный, белый и серые (2026-09-27). Проверяется
 * контент-поток PDF: операторы цвета `rg/RG` (RGB), `k/K` (CMYK),
 * `sc/scn/SC/SCN` — цветной, если компоненты RGB не равны. Фирменная плитка
 * QR — отдельная задача: здесь бланки без QR, а у бланков с QR проверяется
 * цвет текста (подпись копирайта внизу листа).
 */

type ColorOp = { op: string; comps: number[]; inText: boolean };

async function pdfColorOps(pdf: Uint8Array): Promise<ColorOp[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ops: ColorOp[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    for (const ref of refs) {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const text = Buffer.from(decodePDFRawStream(stream).decode())
        .toString("latin1")
        // Строки текста — прочь, чтобы их байты не читались как операторы.
        .replace(/\((?:\\.|[^\\)])*\)/g, "()")
        .replace(/<[0-9A-Fa-f\s]*>/g, "<>");
      let inText = false;
      const nums: number[] = [];
      for (const token of text.split(/[\s[\]]+/)) {
        if (!token) continue;
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token)) {
          nums.push(Number(token));
          continue;
        }
        if (token === "BT") inText = true;
        else if (token === "ET") inText = false;
        else if (token === "g" || token === "G") ops.push({ op: token, comps: nums.slice(-1), inText });
        else if (token === "rg" || token === "RG") ops.push({ op: token, comps: nums.slice(-3), inText });
        else if (token === "k" || token === "K") ops.push({ op: token, comps: nums.slice(-4), inText });
        else if (["sc", "scn", "SC", "SCN"].includes(token)) ops.push({ op: token, comps: nums.slice(), inText });
        nums.length = 0;
      }
    }
  }
  return ops;
}

function isColored(op: ColorOp): boolean {
  if (op.op === "g" || op.op === "G") return false;
  if (op.op === "k" || op.op === "K") return op.comps.slice(0, 3).some((c) => c !== 0);
  if (op.comps.length === 3) return !(op.comps[0] === op.comps[1] && op.comps[1] === op.comps[2]);
  return op.comps.length !== 1;
}

async function coloredOps(pdf: Uint8Array | Buffer): Promise<string[]> {
  return (await pdfColorOps(new Uint8Array(pdf))).filter(isColored).map((op) => `${op.comps.join(" ")} ${op.op}`);
}

/** Серые заливки `g` документа (доли 0..1, как пишет jsPDF — два знака). */
async function grayFills(pdf: Uint8Array): Promise<Set<number>> {
  return new Set((await pdfColorOps(pdf)).filter((op) => op.op === "g" && !op.inText).map((op) => op.comps[0]));
}

const DAY = 86_400_000;

/** Образец, сдвинутый на май 2026: праздник 1 мая, выходные 2–3 мая, сокращённый 8 мая. */
function mayInput(code: string): JournalDocumentPdfInput {
  const input = buildJournalSampleInput(code);
  const doc = input.document as unknown as { dateFrom: Date; dateTo: Date; entries: Array<{ date: Date }> };
  return {
    ...input,
    document: {
      ...input.document,
      dateFrom: new Date(doc.dateFrom.getTime() + 30 * DAY),
      dateTo: new Date(doc.dateTo.getTime() + 30 * DAY),
      entries: doc.entries.map((e) => ({ ...e, date: new Date(e.date.getTime() + 30 * DAY) })),
    } as JournalDocumentPdfInput["document"],
    qr: null,
  };
}

const PARTNER = { brandName: "Партнёр", pdfSignature: "Сопровождение журналов: ООО «Партнёр», тел. +7 900 000-00-00" };

test("журналы: ни одного цветного оператора — все 45 образцов с подвалом партнёра", async () => {
  for (const code of SAMPLE_JOURNAL_CODES) {
    const { buffer } = renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr: null, branding: PARTNER });
    assert.deepEqual(await coloredOps(buffer), [], code);
  }
});

test("журналы: гигиена, здоровье, уборка за май (выходные, праздники, сокращённый день) — без цвета", async () => {
  for (const code of ["hygiene", "health_check", "cleaning"]) {
    const { buffer } = renderJournalDocumentPdf(mayInput(code));
    assert.deepEqual(await coloredOps(buffer), [], code);
  }
});

test("выходной и сокращённый день — серые, различимые, одинаковые в PDF и на экране", async () => {
  const hex = (cls: string) => {
    const m = /bg-\[#([0-9a-f]{6})\]/i.exec(cls);
    assert.ok(m, cls);
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  };
  for (const fill of [PDF_DAY_OFF_FILL, PDF_DAY_SHORT_FILL]) {
    assert.ok(fill[0] === fill[1] && fill[1] === fill[2], `серый: ${fill}`);
  }
  // Разная светлота: на ч/б листе выходной заметно темнее сокращённого, а тот —
  // заметно темнее белого рабочего дня.
  assert.ok(PDF_DAY_SHORT_FILL[0] - PDF_DAY_OFF_FILL[0] >= 16, "выходной темнее сокращённого");
  assert.ok(255 - PDF_DAY_SHORT_FILL[0] >= 16, "сокращённый темнее рабочего");
  assert.deepEqual(hex(GRID_DAY_OFF_BG_CLASS), [...PDF_DAY_OFF_FILL]);
  assert.deepEqual(hex(GRID_DAY_SHORT_BG_CLASS), [...PDF_DAY_SHORT_FILL]);

  assert.equal(getDayColumnBgClass("2026-05-01"), GRID_DAY_OFF_BG_CLASS, "праздник");
  assert.equal(getDayColumnBgClass("2026-05-02"), GRID_DAY_OFF_BG_CLASS, "суббота");
  assert.equal(getDayColumnBgClass("2026-05-08"), GRID_DAY_SHORT_BG_CLASS, "сокращённый");
  assert.equal(getDayColumnBgClass("2026-05-05"), "", "будний");

  const fills = await grayFills(new Uint8Array(renderJournalDocumentPdf(mayInput("hygiene")).buffer));
  for (const fill of [PDF_DAY_OFF_FILL, PDF_DAY_SHORT_FILL]) {
    const value = Number((fill[0] / 255).toFixed(2));
    assert.ok(fills.has(value), `в гигиене за май есть заливка ${value} g (${[...fills].join(", ")})`);
  }
});

test("тёмная тема и печать: серые заливки дней не теряются", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src", "app", "app-theme.css"), "utf8");
  for (const cls of [GRID_DAY_OFF_BG_CLASS, GRID_DAY_SHORT_BG_CLASS]) {
    const selector = `.${cls.replace(/[[\]#]/g, (c) => `\\${c}`)}`;
    const rules = css.split(selector).length - 1;
    // Правило тёмной темы и правило печати (белый лист в любой теме).
    assert.ok(rules >= 2, `${cls}: правил в app-theme.css ${rules}`);
  }
});

test("просроченная поверка: без красного — жирный на серой заливке", async () => {
  const input = buildJournalSampleInput("equipment_calibration");
  const config = { ...(input.document.config as Record<string, unknown>) };
  config.rows = [
    { id: "late", equipmentName: "Термометр щуп", equipmentNumber: "ТЩ-1", location: "Цех", purpose: "Температура", measurementRange: "−50…+300 °C", calibrationInterval: 12, lastCalibrationDate: "2020-03-10", note: "" },
  ];
  const { buffer } = renderJournalDocumentPdf({
    ...input,
    document: { ...input.document, config: config as typeof input.document.config },
    qr: null,
  });
  assert.deepEqual(await coloredOps(buffer), []);
  const fills = await grayFills(new Uint8Array(buffer));
  assert.ok(fills.has(0.83), `серая заливка просроченной даты (${[...fills].join(", ")})`);
});

test("приложение «Подписи сотрудников»: шапка таблицы серая", async () => {
  const { buffer } = renderJournalDocumentPdf({
    ...buildJournalSampleInput("hygiene"),
    qr: null,
    signatures: [
      { employeeName: "Иванова Анна", method: "ПИН", device: "Кухня", count: 3, photos: 1, firstAt: new Date("2026-04-01T08:00:00Z"), lastAt: new Date("2026-04-02T08:00:00Z") },
    ],
  });
  assert.deepEqual(await coloredOps(buffer), []);
});

test("бланк с QR: подпись копирайта и текст плитки — серые", async () => {
  for (const code of ["hygiene", "cleaning_ventilation_checklist"]) {
    const qr = blankPdfQr("https://wesetup.ru", { target: { kind: "code", code }, email: "chef@example.com" });
    const { buffer } = renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr });
    const text = (await pdfColorOps(new Uint8Array(buffer))).filter((op) => op.inText && isColored(op));
    assert.deepEqual(text, [], code);
  }
  const paper = PAPER_JOURNALS[0];
  const qr = blankPdfQr("https://wesetup.ru", { target: { kind: "paper", paperId: paper.id }, email: "chef@example.com" });
  const buffer = renderPaperJournalPdf({ journal: paper, organization: SAMPLE_ORGANIZATION, qr });
  const text = (await pdfColorOps(new Uint8Array(buffer))).filter((op) => op.inText && isColored(op));
  assert.deepEqual(text, [], paper.id);
});

test("бумажные бланки: линии, текст и шапка — чёрные и серые", async () => {
  for (const journal of PAPER_JOURNALS) {
    const buffer = renderPaperJournalPdf({ journal, organization: SAMPLE_ORGANIZATION, rows: [["1", "2"]], blankRows: 18, branding: PARTNER });
    assert.deepEqual(await coloredOps(buffer), [], journal.id);
  }
});

const SELLER: PartySnapshot = {
  name: "ИП Тестов Т. Т.",
  inn: "771234567890",
  kpp: null,
  ogrn: "321774600000012",
  address: "г Москва",
  head: { post: "Индивидуальный предприниматель", name: "Тестов Т. Т." },
  bank: { name: "Банк", bik: "044525974", account: "40802810000000000001", corrAccount: "30101810145250000974" },
};
const BUYER: PartySnapshot = { name: "ООО «Ромашка»", inn: "7701234567", kpp: "770101001", ogrn: null, address: "г Москва", head: null };
const LINES = [{ title: "Доступ к сервису WeSetup", unit: "усл. ед.", unitCode: "876", qty: 1, priceRub: 2990, sumRub: 2990 }];

test("пакет проверяющего, приказы, счёт и УПД — без цвета", async () => {
  const period = { periodFrom: new Date("2026-09-01T00:00:00Z"), periodTo: new Date("2026-09-27T00:00:00Z") };
  const cover = buildRegulatorCoverPdf({
    organizationName: "ООО «Ромашка»",
    ...period,
    generatedAt: new Date("2026-09-27T10:00:00Z"),
    journalsIncluded: 3,
    journalsFailed: 0,
    capaOpen: 1,
    capaClosed: 1,
    temperatureAnomalies: 0,
    preparedBy: "Иванова А. А.",
  });
  assert.deepEqual(await coloredOps(cover), [], "обложка");
  const capa = buildCapaSummaryPdf({
    organizationName: "ООО «Ромашка»",
    ...period,
    rows: [{ title: "Отклонение", priority: "high", status: "open", createdAt: new Date(), dueDate: null, closedAt: null, assignedToName: null, rootCause: null, correctiveAction: null }],
  });
  assert.deepEqual(await coloredOps(capa), [], "CAPA");

  const org = { orgName: "ООО «Ромашка»", orgShortName: "ООО «Ромашка»", orgInn: null, orgAddress: null, directorName: null, directorPost: null, city: null };
  for (const template of ORDER_TEMPLATES) {
    const { buffer } = renderOrderPdf({ template, org, values: {}, number: "1", issuedAt: new Date("2026-09-27T00:00:00Z") });
    assert.deepEqual(await coloredOps(buffer), [], template.code);
  }

  const issuedAt = new Date("2026-09-20T09:00:00Z");
  const invoice = renderInvoicePdf(
    { number: "7", issuedAt, dueAt: issuedAt, seller: SELLER, buyer: BUYER, lines: LINES, totalRub: 2990, basis: "Оферта" },
    { facsimile: null, stamp: null },
  );
  assert.deepEqual(await coloredOps(invoice), [], "счёт");
  const draft: ClosingDocumentDraft = {
    orderId: 7,
    number: "7",
    issuedAt,
    seller: SELLER,
    buyer: BUYER,
    lines: LINES,
    totalRub: 2990,
    vatMode: "none",
    basis: "Оферта",
    paymentDocument: "№ 7",
  };
  for (const sample of [false, true]) {
    const upd = renderClosingDocumentPdf(draft, { facsimile: null, stamp: null }, { sample });
    assert.deepEqual(await coloredOps(upd), [], sample ? "УПД образец" : "УПД");
  }
});

test("Word-шаблоны: ни одного цветного атрибута, заголовок чёрный", async () => {
  for (const code of DOCX_SAMPLE_CODES) {
    const { buffer } = await renderJournalDocumentDocx(buildJournalSampleInput(code), code, {
      footer: { qrUrl: `https://wesetup.ru/qb/${code}`, lines: ["Заполнять с телефона — wesetup.ru", "© WeSetup"] },
    });
    const zip = await JSZip.loadAsync(buffer);
    const found: string[] = [];
    for (const name of Object.keys(zip.files)) {
      if (!name.endsWith(".xml") || name.startsWith("word/theme/")) continue;
      const xml = await zip.files[name].async("string");
      for (const m of xml.matchAll(/<(w:color|w:shd|w:highlight|a:srgbClr)\b([^>]*)>/g)) {
        for (const a of m[2].matchAll(/\b(w:val|w:fill|w:color|val|w:themeColor|w:themeFill)="([^"]*)"/g)) {
          const value = a[2];
          if (a[1] === "w:themeColor" || a[1] === "w:themeFill") found.push(`${name} ${m[1]} ${a[1]}=${value}`);
          else if (m[1] === "w:highlight" && !["none", "black", "white", "lightGray", "darkGray"].includes(value)) found.push(`${name} ${m[1]}=${value}`);
          else if (/^[0-9a-f]{6}$/i.test(value) && !(value.slice(0, 2) === value.slice(2, 4) && value.slice(2, 4) === value.slice(4, 6))) {
            found.push(`${name} ${m[1]} ${a[1]}=${value}`);
          }
        }
      }
    }
    assert.deepEqual(found, [], code);
    const styles = await zip.files["word/styles.xml"].async("string");
    const heading2 = /<w:style[^>]*w:styleId="Heading2"[\s\S]*?<\/w:style>/.exec(styles)?.[0] ?? "";
    assert.match(heading2, /<w:color w:val="000000"\/>/, `${code}: Заголовок 2 — чёрный`);
  }
});
