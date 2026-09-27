/**
 * Сканер цвета всех печатных документов, которые собираются без базы:
 *   • журналы — наборы `journal-qr-header-2026-09/pages.ts`: samples (образцы 45
 *     журналов), blanks (они же как скачанный шаблон), long («длинные»
 *     документы), paper (5 бумажных бланков), variants (гигиена по
 *     Приложению № 1 + подвал партнёра у всех 45), portrait (книжный лист);
 *   • extra — гигиена с приложением «Подписи сотрудников», график поверки с
 *     просроченной строкой (ветки, которых нет в образцах);
 *   • checklists — чек-листы (проветривание, санитарный день) отдельной строкой
 *     таблицы (они же входят в samples/long);
 *   • regulator — пакет проверяющего: обложка и сводка CAPA
 *     (`regulator-bundle.ts`);
 *   • orders — приказы (все шаблоны каталога, PDF);
 *   • billing — счёт на оплату, УПД (обычный и образец);
 *   • docx — Word-шаблоны (6 журналов, без подвала и с подвалом/QR).
 * PDF, которым нужна база и сессия (сертификаты, отчёт, PDF проверяющего,
 * печать браузером), сканирует `e2e-print.cjs` тем же модулем.
 *
 * Запуск (из корня репо): npx tsx .agent/tasks/print-bw-2026-09/scan-docs.ts <метка> [набор,набор]
 * Итог — <SCAN_OUT|raw>/scan-<метка>.json и таблица в консоли.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { renderJournalDocumentPdf, type JournalDocumentPdfInput } from "@/lib/document-pdf";
import { DOCX_SAMPLE_CODES, renderJournalDocumentDocx } from "@/lib/document-docx";
import { journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { buildCapaSummaryPdf, buildRegulatorCoverPdf } from "@/lib/regulator-bundle";
import { ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { renderOrderPdf } from "@/lib/orders/pdf";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { renderClosingDocumentPdf } from "@/lib/closing-documents/pdf";
import type { ClosingDocumentDraft, PartySnapshot } from "@/lib/closing-documents/types";
import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases, BLANK_EMAIL } from "../journal-qr-header-2026-09/pages";
import { scanDocx, scanPdfOperators, scanPdfRaster, type ExcludeMap } from "./color-scan";

const ORIGIN = "https://wesetup.ru";
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "print-bw-2026-09");
const OUT_DIR = process.env.SCAN_OUT ? path.resolve(process.env.SCAN_OUT) : path.join(TASK_DIR, "raw");
/** Куда сложить сами PDF/DOCX (тяжёлые) — только если задано. */
const DUMP_DIR = process.env.SCAN_DUMP ? path.resolve(process.env.SCAN_DUMP) : null;

export type DocCase = {
  set: string;
  label: string;
  kind: "pdf" | "docx";
  build: () => Promise<{ buffer: Uint8Array; qrPlacements?: unknown[] }> | { buffer: Uint8Array; qrPlacements?: unknown[] };
};

export function exclusionFromPlacements(placements: unknown[] | undefined): ExcludeMap {
  const map: ExcludeMap = new Map();
  for (const p of (placements ?? []) as JournalQrPlacement[]) {
    if (p.box) map.set(p.page, [...(map.get(p.page) ?? []), p.box]);
  }
  return map;
}

const SELLER: PartySnapshot = {
  name: "Индивидуальный предприниматель Тестов Тест Тестович",
  inn: "771234567890",
  kpp: null,
  ogrn: "321774600000012",
  address: "109012, г Москва, ул Ильинка, д 4",
  head: { post: "Индивидуальный предприниматель", name: "Тестов Т. Т." },
  bank: { name: "АО «ТБанк»", bik: "044525974", account: "40802810000000000001", corrAccount: "30101810145250000974" },
};
const BUYER: PartySnapshot = {
  name: "Общество с ограниченной ответственностью «Ромашка»",
  inn: "7701234567",
  kpp: "770101001",
  ogrn: "1027700000001",
  address: "125009, г Москва, ул Тверская, д 1",
  head: { post: "Генеральный директор", name: "Иванова А. А." },
};
const LINES = [
  { title: "Доступ к сервису WeSetup, тариф «Расширенный», период 01.09.2026 — 30.09.2026.", unit: "усл. ед.", unitCode: "876", qty: 1, priceRub: 2990, sumRub: 2990 },
  { title: "Термодатчик Wi-Fi", unit: "шт", unitCode: "796", qty: 2, priceRub: 1500, sumRub: 3000 },
];

function extraJournals(): DocCase[] {
  const cases: DocCase[] = [];
  const signed = (): JournalDocumentPdfInput => {
    const input = buildJournalSampleInput("hygiene");
    return {
      ...input,
      qr: journalSamplePdfQr(ORIGIN, "hygiene"),
      signatures: [
        { employeeName: "Иванова Анна", method: "ПИН на планшете", device: "Кухня", count: 12, photos: 3, firstAt: new Date("2026-04-01T08:00:00Z"), lastAt: new Date("2026-04-14T18:00:00Z") },
        { employeeName: "Петров Пётр", method: "ПИН на планшете", device: null, count: 9, photos: 0, firstAt: new Date("2026-04-02T08:00:00Z"), lastAt: new Date("2026-04-13T18:00:00Z") },
      ],
    };
  };
  cases.push({ set: "extra", label: "hygiene+signatures", kind: "pdf", build: () => renderJournalDocumentPdf(signed()) });
  const calibration = (): JournalDocumentPdfInput => {
    const input = buildJournalSampleInput("equipment_calibration");
    const config = { ...(input.document.config as Record<string, unknown>) };
    config.rows = [
      { id: "cal-overdue", equipmentName: "Термометр щуп", equipmentNumber: "ТЩ-1", location: "Горячий цех", purpose: "Температура", measurementRange: "−50…+300 °C", calibrationInterval: 12, lastCalibrationDate: "2024-03-10", note: "" },
      { id: "cal-ok", equipmentName: "Весы платформенные", equipmentNumber: "В-2", location: "Склад", purpose: "Масса", measurementRange: "0…150 кг", calibrationInterval: 12, lastCalibrationDate: "2026-06-01", note: "" },
    ];
    return {
      ...input,
      document: { ...input.document, config: config as typeof input.document.config },
      qr: journalSamplePdfQr(ORIGIN, "equipment_calibration"),
    };
  };
  cases.push({ set: "extra", label: "calibration-overdue", kind: "pdf", build: () => renderJournalDocumentPdf(calibration()) });
  return cases;
}

function checklistCases(): DocCase[] {
  return ["cleaning_ventilation_checklist", "sanitary_day_control"].map((code) => ({
    set: "checklists",
    label: code,
    kind: "pdf" as const,
    build: () => renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr: journalSamplePdfQr(ORIGIN, code) }),
  }));
}

function regulatorCases(): DocCase[] {
  const from = new Date("2026-09-01T00:00:00Z");
  const to = new Date("2026-09-27T00:00:00Z");
  return [
    {
      set: "regulator",
      label: "cover",
      kind: "pdf",
      build: () => ({
        buffer: buildRegulatorCoverPdf({
          organizationName: "ООО «Ромашка»",
          periodFrom: from,
          periodTo: to,
          generatedAt: new Date("2026-09-27T10:00:00Z"),
          journalsIncluded: 32,
          journalsFailed: 1,
          capaOpen: 2,
          capaClosed: 5,
          temperatureAnomalies: 1,
          kioskSignatures: 140,
          preparedBy: "Иванова А. А.",
        }),
      }),
    },
    {
      set: "regulator",
      label: "capa",
      kind: "pdf",
      build: () => ({
        buffer: buildCapaSummaryPdf({
          organizationName: "ООО «Ромашка»",
          periodFrom: from,
          periodTo: to,
          rows: ["high", "medium", "low"].flatMap((priority, i) =>
            ["open", "closed", "investigating"].map((status, j) => ({
              title: `Отклонение температуры в холодильнике № ${i * 3 + j + 1}`,
              priority,
              status,
              createdAt: new Date("2026-09-05T00:00:00Z"),
              dueDate: j === 1 ? null : new Date("2026-09-12T00:00:00Z"),
              closedAt: status === "closed" ? new Date("2026-09-10T00:00:00Z") : null,
              assignedToName: "Петров П. П.",
              rootCause: null,
              correctiveAction: null,
            })),
          ),
        }),
      }),
    },
  ];
}

function orderCases(): DocCase[] {
  const org = {
    orgName: "Общество с ограниченной ответственностью «Ромашка»",
    orgShortName: "ООО «Ромашка»",
    orgInn: "7701234567",
    orgAddress: "125009, г Москва, ул Тверская, д 1",
    directorName: "Иванова Анна Андреевна",
    directorPost: "Генеральный директор",
    city: "Москва",
  };
  return ORDER_TEMPLATES.map((template) => ({
    set: "orders",
    label: template.code,
    kind: "pdf" as const,
    build: () => ({
      buffer: renderOrderPdf({ template, org, values: {}, number: "12-ОД", issuedAt: new Date("2026-09-27T00:00:00Z") }).buffer,
    }),
  }));
}

function billingCases(): DocCase[] {
  const issuedAt = new Date("2026-09-20T09:00:00Z");
  const closing: ClosingDocumentDraft = {
    orderId: 101,
    number: "101",
    issuedAt,
    seller: SELLER,
    buyer: BUYER,
    lines: LINES,
    totalRub: 5990,
    vatMode: "none",
    basis: "Договор-оферта (wesetup.ru/oferta)",
    paymentDocument: "№ 101 от 20.09.2026",
  } as ClosingDocumentDraft;
  return [
    {
      set: "billing",
      label: "invoice",
      kind: "pdf",
      build: () => ({
        buffer: renderInvoicePdf(
          { number: "101", issuedAt, dueAt: new Date("2026-09-27T09:00:00Z"), seller: SELLER, buyer: BUYER, lines: LINES, totalRub: 5990, basis: "Договор-оферта (wesetup.ru/oferta)" },
          { facsimile: null, stamp: null },
        ),
      }),
    },
    { set: "billing", label: "upd", kind: "pdf", build: () => ({ buffer: renderClosingDocumentPdf(closing, { facsimile: null, stamp: null }) }) },
    { set: "billing", label: "upd-sample", kind: "pdf", build: () => ({ buffer: renderClosingDocumentPdf(closing, { facsimile: null, stamp: null }, { sample: true }) }) },
  ];
}

function docxCases(): DocCase[] {
  const cases: DocCase[] = [];
  for (const code of DOCX_SAMPLE_CODES) {
    cases.push({
      set: "docx",
      label: code,
      kind: "docx",
      build: async () => ({ buffer: (await renderJournalDocumentDocx(buildJournalSampleInput(code), code)).buffer }),
    });
    cases.push({
      set: "docx",
      label: `${code}+footer`,
      kind: "docx",
      build: async () => ({
        buffer: (
          await renderJournalDocumentDocx(buildJournalSampleInput(code), code, {
            footer: {
              qrUrl: `${ORIGIN}/qb/test-${code}`,
              lines: ["Заполнять с телефона — wesetup.ru", `Шаблон скачан ${BLANK_EMAIL}`, "© WeSetup, 2026"],
            },
          })
        ).buffer,
      }),
    });
  }
  return cases;
}

export function allCases(sets: Set<string>): DocCase[] {
  const want = (s: string) => sets.has(s);
  const cases: DocCase[] = [];
  const journalSets = ["samples", "blanks", "long", "paper", "variants", "portrait"].filter(want);
  if (journalSets.length) {
    for (const item of buildCases(new Set(journalSets))) {
      cases.push({ set: item.set, label: item.label, kind: "pdf", build: () => item.render("stamp") });
    }
  }
  if (want("extra")) cases.push(...extraJournals());
  if (want("checklists")) cases.push(...checklistCases());
  if (want("regulator")) cases.push(...regulatorCases());
  if (want("orders")) cases.push(...orderCases());
  if (want("billing")) cases.push(...billingCases());
  if (want("docx")) cases.push(...docxCases());
  return cases;
}

export type DocResult = {
  set: string;
  label: string;
  kind: "pdf" | "docx";
  pages?: number;
  ops?: Awaited<ReturnType<typeof scanPdfOperators>>;
  raster?: Awaited<ReturnType<typeof scanPdfRaster>>;
  docx?: Awaited<ReturnType<typeof scanDocx>>;
  ms: number;
};

async function main() {
  const [label, setsArg] = process.argv.slice(2);
  if (!label) throw new Error("метка: before | after");
  const sets = new Set(
    (setsArg ?? "samples,blanks,long,paper,variants,portrait,extra,checklists,regulator,orders,billing,docx").split(","),
  );
  const results: DocResult[] = [];
  for (const item of allCases(sets)) {
    const started = Date.now();
    const built = await item.build();
    const buffer = new Uint8Array(built.buffer);
    if (DUMP_DIR) {
      fs.mkdirSync(path.join(DUMP_DIR, label, item.set), { recursive: true });
      fs.writeFileSync(path.join(DUMP_DIR, label, item.set, `${item.label}.${item.kind}`), buffer);
    }
    if (item.kind === "docx") {
      const docx = await scanDocx(buffer);
      results.push({ set: item.set, label: item.label, kind: "docx", docx, ms: Date.now() - started });
      console.log(`${item.set.padEnd(10)} ${item.label.padEnd(36)} docx цветных атрибутов ${docx.colored.length} тем ${docx.themeRefs.length}`);
      continue;
    }
    const exclude = exclusionFromPlacements(built.qrPlacements);
    const ops = await scanPdfOperators(buffer, exclude);
    const raster = await scanPdfRaster(buffer, exclude);
    // Картинки вне QR (логотипы и т. п.) — в отчёт.
    results.push({ set: item.set, label: item.label, kind: "pdf", pages: ops.pages, ops, raster, ms: Date.now() - started });
    console.log(
      `${item.set.padEnd(10)} ${item.label.padEnd(36)} стр. ${String(ops.pages).padStart(3)} ` +
        `оп.цвет ${String(ops.coloredOps).padStart(5)} вне QR ${String(ops.coloredOutsideQr).padStart(5)} ` +
        `пикс ${String(raster.colored).padStart(7)} (${raster.coloredVisible}) ${Date.now() - started} мс`,
    );
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `scan-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(results, (key, value) => (key === "images" ? undefined : value), 1));
  // Сводка по наборам.
  const bySet = new Map<string, DocResult[]>();
  for (const r of results) bySet.set(r.set, [...(bySet.get(r.set) ?? []), r]);
  console.log("\nнабор       док.  стр.  с цветными оп. вне QR  оп. вне QR  с цветн. пикс.  цветн. пикс.");
  for (const [set, rows] of bySet) {
    const pdf = rows.filter((r) => r.kind === "pdf");
    if (pdf.length === 0) {
      const bad = rows.filter((r) => (r.docx?.colored.length ?? 0) + (r.docx?.themeRefs.length ?? 0) > 0);
      console.log(`${set.padEnd(10)} ${String(rows.length).padStart(5)}   —   DOCX с цветными атрибутами: ${bad.length}, атрибутов ${rows.reduce((s, r) => s + (r.docx?.colored.length ?? 0), 0)}`);
      continue;
    }
    console.log(
      `${set.padEnd(10)} ${String(pdf.length).padStart(5)} ${String(pdf.reduce((s, r) => s + (r.pages ?? 0), 0)).padStart(5)} ` +
        `${String(pdf.filter((r) => (r.ops?.coloredOutsideQr ?? 0) > 0).length).padStart(22)} ${String(pdf.reduce((s, r) => s + (r.ops?.coloredOutsideQr ?? 0), 0)).padStart(11)} ` +
        `${String(pdf.filter((r) => (r.raster?.colored ?? 0) > 0).length).padStart(15)} ${String(pdf.reduce((s, r) => s + (r.raster?.colored ?? 0), 0)).padStart(13)}`,
    );
  }
  console.log(`\n→ ${file}`);
}

if (process.argv[1] && /scan-docs\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
