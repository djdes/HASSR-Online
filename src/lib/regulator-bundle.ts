/**
 * Builder'ы для «Сводного отчёта за проверкой Роспотребнадзора».
 *
 *  - `buildRegulatorCoverPdf` — одностраничный cover с шапкой организации,
 *    периодом, счётчиками и подписью; инспектор открывает первый файл в
 *    ZIP и сразу видит resume, не копаясь по папкам.
 *  - `buildCapaSummaryPdf` — список CAPA-задач за период (open + closed),
 *    с приоритетом, ответственным, ссылкой на источник и статусом.
 *
 * Оба PDF построены через jspdf + autoTable (уже в depencies). Русский
 * шрифт берётся с диска тем же способом, что и `document-pdf.ts` —
 * cross-platform candidates, fallback на helvetica.
 */
import fs from "fs";
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";

const FONT_CANDIDATES = [
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
];

function loadUnicodeFont(doc: jsPDF): string {
  const fontPath = FONT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!fontPath) return "helvetica";
  const base64 = fs.readFileSync(fontPath).toString("base64");
  doc.addFileToVFS("regulator-unicode.ttf", base64);
  doc.addFont("regulator-unicode.ttf", "RegulatorUnicode", "normal");
  doc.addFont("regulator-unicode.ttf", "RegulatorUnicode", "bold");
  return "RegulatorUnicode";
}

export type RegulatorCoverInput = {
  organizationName: string;
  periodFrom: Date;
  periodTo: Date;
  generatedAt: Date;
  journalsIncluded: number;
  journalsFailed: number;
  capaOpen: number;
  capaClosed: number;
  temperatureAnomalies: number;
  /// Подписей через общий планшет (ПИН) за период — доказательство, что
  /// записи вносили сами сотрудники, а не один человек за всех.
  kioskSignatures?: number;
  preparedBy: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildRegulatorCoverPdf(input: RegulatorCoverInput): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const font = loadUnicodeFont(doc);
  doc.setFont(font, "bold");
  doc.setFontSize(20);
  doc.text("Сводный отчёт по журналам", 105, 24, { align: "center" });
  doc.setFontSize(13);
  doc.text("для проверки Роспотребнадзора", 105, 32, { align: "center" });
  doc.setFont(font, "normal");
  doc.setFontSize(11);
  doc.setDrawColor(200);
  doc.line(20, 38, 190, 38);

  const rows: RowInput[] = [
    [{ content: "Организация", styles: { fontStyle: "bold" } }, input.organizationName],
    [
      { content: "Отчётный период", styles: { fontStyle: "bold" } },
      `${ymd(input.periodFrom)} — ${ymd(input.periodTo)}`,
    ],
    [
      { content: "Собран", styles: { fontStyle: "bold" } },
      input.generatedAt.toLocaleString("ru-RU"),
    ],
    [
      { content: "Подготовил", styles: { fontStyle: "bold" } },
      input.preparedBy || "—",
    ],
  ];
  autoTable(doc, {
    body: rows,
    startY: 44,
    theme: "plain",
    styles: { font, fontSize: 11, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 55 } },
    margin: { left: 20, right: 20 },
  });

  type RawWithFinalY = { finalY: number };
  const lastTable = (
    doc as unknown as { lastAutoTable?: RawWithFinalY }
  ).lastAutoTable;
  let cursorY = (lastTable?.finalY ?? 80) + 10;

  doc.setFont(font, "bold");
  doc.setFontSize(13);
  doc.text("Сводка по составу архива", 20, cursorY);
  cursorY += 4;

  const summary: RowInput[] = [
    ["Журналы — PDF включены", String(input.journalsIncluded)],
    ["Журналы — ошибки рендера", String(input.journalsFailed)],
    ["CAPA — открытые на момент сборки", String(input.capaOpen)],
    ["CAPA — закрытые за период", String(input.capaClosed)],
    [
      "Температурные инциденты (≥3 дня подряд вне нормы)",
      String(input.temperatureAnomalies),
    ],
    ...(typeof input.kioskSignatures === "number"
      ? [["Подписей сотрудников по ПИН на общем планшете", String(input.kioskSignatures)] as RowInput]
      : []),
  ];

  autoTable(doc, {
    body: summary,
    startY: cursorY,
    theme: "grid",
    styles: { font, fontSize: 11, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 130 }, 1: { halign: "right" } },
    margin: { left: 20, right: 20 },
  });

  const lastTable2 = (
    doc as unknown as { lastAutoTable?: RawWithFinalY }
  ).lastAutoTable;
  cursorY = (lastTable2?.finalY ?? cursorY) + 16;

  doc.setFont(font, "normal");
  doc.setFontSize(10);
  const intro = doc.splitTextToSize(
    "В архиве — PDF-файлы всех журналов, действовавших в указанный " +
      "период (по одному файлу на документ), сводка по CAPA, а также " +
      "этот отчёт. Структура папок повторяет структуру журналов в WeSetup.",
    170
  );
  doc.text(intro as string[], 20, cursorY);
  cursorY += (intro as string[]).length * 5 + 12;

  doc.setDrawColor(150);
  doc.line(20, cursorY, 100, cursorY);
  doc.setFontSize(10);
  doc.text("Подпись ответственного / печать", 20, cursorY + 5);

  return Buffer.from(doc.output("arraybuffer"));
}

export type RegulatorCapaRow = {
  title: string;
  priority: "low" | "medium" | "high" | string | null;
  status: string;
  createdAt: Date;
  dueDate: Date | null;
  closedAt: Date | null;
  assignedToName: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
};

export function buildCapaSummaryPdf(input: {
  organizationName: string;
  periodFrom: Date;
  periodTo: Date;
  rows: RegulatorCapaRow[];
}): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const font = loadUnicodeFont(doc);
  doc.setFont(font, "bold");
  doc.setFontSize(16);
  doc.text("CAPA — корректирующие действия", 105, 22, { align: "center" });
  doc.setFont(font, "normal");
  doc.setFontSize(11);
  doc.text(
    `${input.organizationName} · ${ymd(input.periodFrom)} — ${ymd(
      input.periodTo
    )}`,
    105,
    30,
    { align: "center" }
  );

  if (input.rows.length === 0) {
    doc.setFontSize(12);
    doc.text("За период CAPA не открывались.", 105, 55, { align: "center" });
    return Buffer.from(doc.output("arraybuffer"));
  }

  autoTable(doc, {
    startY: 40,
    head: [
      [
        "№",
        "Тема",
        "Приоритет",
        "Статус",
        "Создан",
        "Срок",
        "Закрыт",
        "Ответственный",
      ],
    ],
    body: input.rows.map((r, idx) => [
      String(idx + 1),
      r.title,
      priorityLabel(r.priority),
      statusLabel(r.status),
      r.createdAt.toLocaleDateString("ru-RU"),
      r.dueDate ? r.dueDate.toLocaleDateString("ru-RU") : "—",
      r.closedAt ? r.closedAt.toLocaleDateString("ru-RU") : "—",
      r.assignedToName ?? "—",
    ]),
    theme: "grid",
    styles: { font, fontSize: 9, cellPadding: 1.5, overflow: "linebreak" },
    headStyles: { font, fillColor: [238, 241, 255], textColor: 30 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 56 },
      2: { cellWidth: 20 },
      3: { cellWidth: 20 },
      4: { cellWidth: 20 },
      5: { cellWidth: 20 },
      6: { cellWidth: 18 },
      7: { cellWidth: 28 },
    },
    margin: { left: 10, right: 10 },
  });

  return Buffer.from(doc.output("arraybuffer"));
}

function priorityLabel(p: string | null): string {
  switch (p) {
    case "high":
      return "Высокий";
    case "medium":
      return "Средний";
    case "low":
      return "Низкий";
    default:
      return p ?? "—";
  }
}
function statusLabel(s: string): string {
  switch (s) {
    case "open":
      return "Открыт";
    case "closed":
      return "Закрыт";
    case "investigating":
      return "Расследование";
    case "blocked":
      return "Заблокирован";
    default:
      return s;
  }
}
