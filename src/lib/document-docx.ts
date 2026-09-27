import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlignTable,
  WidthType,
} from "docx";
import { brandQrPng } from "@/lib/brand-qr";
import { HYGIENE_STATUS_OPTIONS } from "@/lib/hygiene-document";
import type { JournalDocumentPdfInput } from "@/lib/document-pdf";

/**
 * DOCX-версия образца журнала.
 *
 * Зачем вообще: часть заведений просят «файл, в котором можно
 * дописать» — Word они умеют, PDF нет. Это витрина, а не вторая
 * система выгрузки: DOCX собирается только для образцов лендинга и
 * только для журналов с простой сеткой. Для остальных отдаём PDF —
 * их бланки (медкнижки, бракераж со сложной шапкой) в таблицу Word
 * без потерь не кладутся, а кривой файл хуже отсутствующего.
 */

/** Журналы, для которых собираем DOCX. Остальные — только PDF. */
export const DOCX_SAMPLE_CODES = [
  "hygiene",
  "health_check",
  "cleaning",
  "cold_equipment_control",
  "finished_product",
  "incoming_control",
] as const;

export type DocxSampleCode = (typeof DOCX_SAMPLE_CODES)[number];

export function isDocxSampleCode(code: string): code is DocxSampleCode {
  return (DOCX_SAMPLE_CODES as readonly string[]).includes(code);
}

/** Шапка бланка ХАССП — та же структура, что в PDF и на экране. */
function headerTable(input: JournalDocumentPdfInput): Table {
  const org = input.document.organization;
  const orgLine = [org.name, org.inn ? `ИНН ${org.inn}` : null, org.address]
    .filter(Boolean)
    .join(" · ");

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: orgLine })],
            width: { size: 40, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [
              new Paragraph({
                text: "СИСТЕМА ХАССП",
                alignment: AlignmentType.CENTER,
              }),
            ],
            width: { size: 35, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [
              new Paragraph({
                text: `Начат: ${formatDate(input.document.dateFrom)}`,
              }),
              new Paragraph({ text: "Окончен: ______________" }),
              new Paragraph({ text: "СТР. 1 ИЗ 1" }),
            ],
            width: { size: 25, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
    ],
  });
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("ru-RU");
}

function dateKeys(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function cell(text: string, bold = false): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold, size: 16 })],
      }),
    ],
  });
}

/**
 * Сетка «сотрудник × день». Так устроены гигиена, журнал здоровья и
 * уборка: строки — люди, столбцы — даты, в клетке одна отметка.
 */
function employeeGrid(input: JournalDocumentPdfInput): Table {
  const keys = dateKeys(input.document.dateFrom, input.document.dateTo);
  const byKey = new Map<string, Record<string, unknown>>();
  for (const entry of input.document.entries) {
    const key = `${entry.employeeId}:${entry.date.toISOString().slice(0, 10)}`;
    byKey.set(key, (entry.data as Record<string, unknown>) ?? {});
  }

  const header = new TableRow({
    children: [
      cell("Ф.И.О. работника", true),
      cell("Должность", true),
      ...keys.map((k) => cell(k.slice(8), true)),
    ],
  });

  const rows = input.users.map(
    (user) =>
      new TableRow({
        children: [
          cell(user.name),
          cell(user.positionTitle),
          ...keys.map((k) => {
            const data = byKey.get(`${user.id}:${k}`);
            return cell(data ? markFor(data) : "");
          }),
        ],
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
  });
}

/** Отметка в клетке. Ключи разные у разных журналов — берём первый знакомый. */
function markFor(data: Record<string, unknown>): string {
  if (typeof data.status === "string") {
    // Код как в PDF и на экране («Зд.», «В», «Б/л»…), а не значение из базы (`day_off`).
    return HYGIENE_STATUS_OPTIONS.find((option) => option.value === data.status)?.code ?? String(data.status);
  }
  if (data.signed === true) return "подпись";
  return "✓";
}

/**
 * Сетка «оборудование × день» — журнал температур холодильников.
 * Значение лежит не в клетке сотрудника, а в словаре temperatures.
 */
function equipmentGrid(input: JournalDocumentPdfInput): Table {
  const keys = dateKeys(input.document.dateFrom, input.document.dateTo);
  const byDate = new Map<string, Record<string, number | null>>();
  for (const entry of input.document.entries) {
    const data = (entry.data as { temperatures?: Record<string, number | null> })
      ?.temperatures;
    if (data) byDate.set(entry.date.toISOString().slice(0, 10), data);
  }

  const header = new TableRow({
    children: [
      cell("Оборудование", true),
      ...keys.map((k) => cell(k.slice(8), true)),
    ],
  });

  const rows = input.equipment.map(
    (item) =>
      new TableRow({
        children: [
          cell(item.name),
          ...keys.map((k) => {
            const value = byDate.get(k)?.[item.id];
            return cell(value === undefined || value === null ? "" : String(value));
          }),
        ],
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
  });
}

/** Пустой бланк-реестр: шапка колонок и незаполненные строки. */
function blankRegister(columns: string[], rowCount = 12): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: columns.map((c) => cell(c, true)) }),
      ...Array.from(
        { length: rowCount },
        () =>
          new TableRow({ children: columns.map(() => cell("")) })
      ),
    ],
  });
}

const REGISTER_COLUMNS: Record<string, string[]> = {
  finished_product: [
    "Дата и время",
    "Наименование блюда",
    "Органолептическая оценка",
    "Разрешение к реализации",
    "Ф.И.О. бракеражной комиссии",
    "Подпись",
  ],
  incoming_control: [
    "Дата",
    "Поставщик",
    "Продукт",
    "Партия",
    "Срок годности",
    "Температура",
    "Документы",
    "Решение",
    "Ф.И.О.",
  ],
  cleaning: [
    "Дата",
    "Помещение",
    "Вид уборки",
    "Средство",
    "Ф.И.О. исполнителя",
    "Подпись",
  ],
};

/**
 * Подвал скачанного шаблона: строки подписи (первая — жирная) и QR справа.
 * Подвал Word повторяется на каждой странице сам. QR — фирменная ч/б плитка
 * (`brand-qr.ts`: знак, коррекция H, полоса «Отсканировать»), как в шапке PDF
 * того же шаблона.
 */
export type DocxBlankFooter = {
  /** Адрес, который кодирует QR. */
  qrUrl: string;
  /** «Заполнять с телефона — wesetup.ru», строка копирайта. */
  lines: string[];
};

/**
 * Ширина плитки QR в подвале, px Word (96 dpi): 81 px ≈ 21,4 мм — у самого
 * плотного адреса шаблона (/qb с почтой, 53 модуля) модуль 0,367 мм, как в
 * шапке PDF (≥ 0,365). Высота — по пропорции картинки (с полосой).
 */
const FOOTER_QR_PX = 81;
/** PNG плитки — с запасом под печать (~750 dpi на 21 мм). */
const FOOTER_QR_PNG_WIDTH = 600;

/** Ширина и высота PNG из заголовка IHDR. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
/**
 * Колонки подвала, twips: ширина текста A4 при полях 2,54 см — 9026.
 * Сетка задаётся явно: проценты у ячеек LibreOffice игнорирует и делит
 * таблицу пополам — подпись уезжала от QR на середину листа.
 */
const FOOTER_COLUMNS = [7426, 1600];

async function blankFooter(footer: DocxBlankFooter): Promise<Footer> {
  const png = await brandQrPng(footer.qrUrl, { width: FOOTER_QR_PNG_WIDTH });
  const size = pngSize(png);
  const [caption = "", ...rest] = footer.lines;
  const text = new TableCell({
    width: { size: FOOTER_COLUMNS[0], type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: caption, bold: true, size: 16, color: "404040" })],
      }),
      ...rest.map(
        (line) =>
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: line, size: 14, color: "707070" })],
          })
      ),
    ],
  });
  const qr = new TableCell({
    width: { size: FOOTER_COLUMNS[1], type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new ImageRun({
            type: "png",
            data: png,
            transformation: { width: FOOTER_QR_PX, height: Math.round((FOOTER_QR_PX * size.height) / size.width) },
            altText: { name: "QR", description: caption, title: "QR-код" },
          }),
        ],
      }),
    ],
  });
  return new Footer({
    children: [
      new Table({
        width: { size: FOOTER_COLUMNS[0] + FOOTER_COLUMNS[1], type: WidthType.DXA },
        columnWidths: FOOTER_COLUMNS,
        layout: TableLayoutType.FIXED,
        borders: TableBorders.NONE,
        rows: [new TableRow({ children: [text, qr] })],
      }),
    ],
  });
}

/**
 * Стили документа без цвета. У библиотеки docx заголовки по умолчанию
 * синие (2E74B5, 1F4D78), ссылка — 0563C1: название журнала («Заголовок 2»)
 * в Word печаталось синим. Бланк — только чёрный и серые: у заведений
 * ч/б принтеры. Размеры и начертания — как у библиотеки.
 */
const BLACK = "000000";
const BLACK_DEFAULT_STYLES = {
  heading1: { run: { color: BLACK, size: 32 } },
  heading2: { run: { color: BLACK, size: 26 } },
  heading3: { run: { color: BLACK, size: 24 } },
  heading4: { run: { color: BLACK, italics: true } },
  heading5: { run: { color: BLACK } },
  heading6: { run: { color: BLACK } },
  hyperlink: { run: { color: BLACK, underline: { type: UnderlineType.SINGLE } } },
};

/**
 * Собирает DOCX. Возвращает буфер и имя файла — та же пара, что у
 * рендерера PDF, чтобы роуты выглядели одинаково.
 *
 * `options.footer` — копирайт и QR на каждой странице (скачивание
 * шаблона с сайта). Без него файл собирается как раньше.
 */
export async function renderJournalDocumentDocx(
  input: JournalDocumentPdfInput,
  code: DocxSampleCode,
  options: { footer?: DocxBlankFooter | null } = {}
): Promise<{ buffer: Buffer; fileName: string }> {
  const title = input.document.title;

  const body: (Paragraph | Table)[] = [
    headerTable(input),
    new Paragraph({ text: "" }),
    new Paragraph({
      text: title.toUpperCase(),
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: "" }),
  ];

  if (code === "hygiene" || code === "health_check") {
    body.push(employeeGrid(input));
  } else if (code === "cold_equipment_control") {
    body.push(equipmentGrid(input));
  } else {
    body.push(blankRegister(REGISTER_COLUMNS[code] ?? ["Дата", "Событие"]));
  }

  body.push(
    new Paragraph({ text: "" }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Образец. Данные вымышленные — заполните своими или ведите журнал в WeSetup: wesetup.ru",
          italics: true,
          size: 16,
        }),
      ],
    })
  );

  const footer = options.footer ? await blankFooter(options.footer) : null;
  const doc = new Document({
    styles: { default: BLACK_DEFAULT_STYLES },
    sections: [{ children: body, ...(footer ? { footers: { default: footer } } : {}) }],
  });
  const buffer = await Packer.toBuffer(doc);

  return {
    buffer: Buffer.from(buffer),
    fileName: `obrazec-${code}.docx`,
  };
}
