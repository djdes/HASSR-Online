import fs from "node:fs";
import path from "node:path";

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ITableBordersOptions,
  type ITableCellBorders,
  type TableVerticalAlign,
} from "docx";
import JSZip from "jszip";

import { BRAND_FOOTER_TAGLINE, brandAsset, brandSeller, type BrandAssetName, type BrandSeller } from "@/lib/brand-docs/pdf-kit";

import type { ContractAppendix, ContractDocument, RequisiteRow, SignatureSide } from "./template";
import type { ContractSeller } from "./types";

/**
 * DOCX договора — для правок юристом или клиентом. Тот же текст, что в PDF,
 * и тот же стиль, что у шаблонов «WeSetup - шаблоны (без покупателя, новый
 * стиль)» (2026-11-07): белый бланк — знак «Полночь», реквизиты справа,
 * фирменный маршрут под шапкой; симметричный подвал с «Страница N из M»;
 * шрифт Manrope встроен в файл (у получателя его может не быть); текст по
 * ширине с переносами, заголовки и таблицы без переносов; никаких прописных
 * с разрядкой. Факсимиле и печать в редактируемый файл намеренно не ставятся.
 */

const FONT = "Manrope";
const FONT_SB = "Manrope SemiBold";
const FONT_FILES = [
  { name: FONT, file: "Manrope-Regular.ttf" },
  { name: FONT_SB, file: "Manrope-SemiBold.ttf" },
] as const;

const C = {
  ink: "0B1024",
  ink2: "3C4053",
  muted: "6F7282",
  faint: "9B9FB3",
  blank: "B5BACE",
  indigo: "5566F6",
  indigoDeep: "3848C7",
  border: "ECECF4",
  border2: "DCDFED",
  voidFg: "A13A32",
};
/** Кегли: заголовок, раздел, вводный, основной, подписи. */
const SIZE = { title: 22, h: 11.5, lead: 10.5, body: 9, small: 7.5 } as const;

/** см → twips. */
const cm = (value: number) => Math.round(value * 566.929);
/** см → px (96 dpi) для картинок. */
const px = (value: number) => (value * 96) / 2.54;

const PAGE_W = 11906;
const SIDE = cm(1.2);
const W = PAGE_W - 2 * SIDE;
const FOOT_ROUTE_W = 6.4;

const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const hair = (color: string, size = 4) => ({ style: BorderStyle.SINGLE, size, color });

type RunOptions = { size?: number; color?: string; sb?: boolean };

const run = (text: string, options: RunOptions = {}) =>
  new TextRun({
    // «(-ей)» и «QR-код» — неразрывным дефисом: перенос внутри читается как опечатка.
    text: text.replace(/\(-/g, "(‑").replace(/(QR|Telegram)-/g, "$1‑"),
    font: options.sb ? FONT_SB : FONT,
    size: Math.round((options.size ?? SIZE.body) * 2),
    color: options.color ?? C.ink,
  });

type ParaOptions = {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  before?: number;
  after?: number;
  indentLeft?: number;
  hanging?: number;
  keepNext?: boolean;
  line?: number;
};

const para = (children: Array<TextRun | ImageRun>, options: ParaOptions = {}) =>
  new Paragraph({
    children,
    alignment: options.align,
    spacing: { before: options.before ?? 0, after: options.after ?? 0, line: options.line ?? 264 },
    indent: options.indentLeft || options.hanging ? { left: options.indentLeft ?? 0, hanging: options.hanging } : undefined,
    keepNext: options.keepNext,
  });

type CellOptions = { margins?: { top?: number; bottom?: number; left?: number; right?: number }; span?: number; borders?: ITableCellBorders; valign?: TableVerticalAlign };

const cell = (children: Array<Paragraph | Table>, width: number, options: CellOptions = {}) =>
  new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 0, right: 0, ...options.margins },
    verticalAlign: options.valign ?? VerticalAlign.TOP,
    columnSpan: options.span,
    borders: options.borders,
  });

const table = (rows: TableRow[], widths: number[], borders: ITableBordersOptions = NO_BORDERS) =>
  new Table({
    layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders,
    rows,
  });

function image(name: BrandAssetName, widthCm: number | null, alt: string): ImageRun | null {
  const data = brandAsset(name);
  if (!data) return null;
  const w = data.readUInt32BE(16);
  const h = data.readUInt32BE(20);
  // null — исходный масштаб картинки, отрисованной с плотностью 6×.
  const width = widthCm === null ? w / 6 : px(widthCm);
  const height = widthCm === null ? h / 6 : px((widthCm * h) / w);
  return new ImageRun({ type: "png", data, transformation: { width, height }, altText: { name: alt, title: alt, description: alt } });
}

/** Подвал: знак слева, маршрут ровно по центру листа, «Страница N из M» справа. */
function footer(): Footer {
  const mid = cm(FOOT_ROUTE_W + 0.4);
  const side = Math.floor((W - mid) / 2);
  const widths = [side, mid, W - mid - side];
  const small = (text: string) => run(text, { size: SIZE.small, color: C.muted });
  const num = (field: (typeof PageNumber)[keyof typeof PageNumber]) => new TextRun({ children: [field], font: FONT, size: SIZE.small * 2, color: C.muted });
  const wordmark = image("wordmark-polnoch.png", 1.25, "сетап");
  const route = image("route-footer.png", FOOT_ROUTE_W, "");
  return new Footer({
    children: [
      table(
        [
          new TableRow({
            children: [
              cell([para([...(wordmark ? [wordmark, run("   ")] : []), small(BRAND_FOOTER_TAGLINE)], { line: 240 })], widths[0], { valign: VerticalAlign.CENTER }),
              cell([para(route ? [route] : [], { align: AlignmentType.CENTER, line: 240 })], widths[1], { valign: VerticalAlign.CENTER }),
              cell([para([small("Страница "), num(PageNumber.CURRENT), small(" из "), num(PageNumber.TOTAL_PAGES)], { align: AlignmentType.RIGHT, line: 240 })], widths[2], { valign: VerticalAlign.CENTER }),
            ],
          }),
        ],
        widths,
      ),
    ],
  });
}

const sectionHeading = (num: number, title: string) =>
  para([run(String(num), { size: SIZE.h, sb: true, color: C.indigo }), run("   "), run(title, { size: SIZE.h, sb: true })], { before: 300, after: 120, keepNext: true, line: 240 });

/** Реквизиты стороны: подпись поля мелким серым, значение основным. */
function requisites(title: string, rows: RequisiteRow[]): Paragraph[] {
  return [
    para([run(title, { size: SIZE.h, sb: true })], { line: 240, after: 60 }),
    ...rows.map((row) => para([run(`${row.label}: `, { size: SIZE.small, color: C.muted }), run(row.value, { size: 8.5, sb: row.strong })], { before: 50, line: 250 })),
  ];
}

function signature(side: SignatureSide): Paragraph[] {
  return [
    para([run(side.caption, { color: C.muted })], { line: 240 }),
    para([run("__________________", { color: C.blank }), run(`  ${side.nameShort}`)], { before: 360, line: 240 }),
    para([run("М. П.", { size: SIZE.small, color: C.faint })], { before: 80, line: 240 }),
  ];
}

const ALIGN = { left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER } as const;

/** Приложение с нового листа: шапка справа, заголовок, таблица, итог, подписи сторон. */
function appendixBlocks(appendix: ContractAppendix, document: ContractDocument, signWidths: number[], gutter: number): Array<Paragraph | Table> {
  const right = { align: AlignmentType.RIGHT, line: 240 } as const;
  const colWidths = appendix.widths.map((share) => Math.floor(W * share));
  colWidths[colWidths.length - 1] += W - colWidths.reduce((sum, w) => sum + w, 0);
  const pad = { top: 90, bottom: 90, left: 100, right: 100 };
  const headBorders = { top: NONE, left: NONE, right: NONE, bottom: hair(C.ink, 6) };
  const rowBorders = { top: NONE, left: NONE, right: NONE, bottom: hair(C.border2) };
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: appendix.columns.map((label, index) =>
        cell([para([run(label, { size: SIZE.small, color: C.muted })], { align: ALIGN[appendix.align[index]], line: 240 })], colWidths[index], { margins: pad, borders: headBorders, valign: VerticalAlign.BOTTOM }),
      ),
    }),
    ...appendix.rows.map(
      (row) =>
        new TableRow({
          cantSplit: true,
          children: row.map((value, index) =>
            cell([para([run(value, { size: 8.5 })], { align: ALIGN[appendix.align[index]], line: 250 })], colWidths[index], { margins: pad, borders: rowBorders, valign: VerticalAlign.CENTER }),
          ),
        }),
    ),
  ];
  const signCell = (side: SignatureSide, width: number) => cell(signature(side), width, { margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  return [
    new Paragraph({ children: [run(`Приложение № ${appendix.num}`, { size: 9, color: C.muted })], alignment: AlignmentType.RIGHT, pageBreakBefore: true, spacing: { before: 0, after: 0, line: 240 } }),
    para([run(`к ${document.runningTitle.replace(/^Договор/, "Договору")}`, { size: 9, color: C.muted })], { ...right, before: 40 }),
    para([run(appendix.title, { size: 16, sb: true })], { before: 360, after: 200, line: 240 }),
    table(tableRows, colWidths),
    ...appendix.notes.map((note) => para([run(note.text, { size: note.strong ? 9.5 : 8.5, sb: note.strong, color: note.strong ? C.ink : C.ink2 })], { before: 160, line: 276, align: AlignmentType.JUSTIFIED })),
    para([], { before: 360 }),
    table(
      [
        new TableRow({
          cantSplit: true,
          children: [signCell(document.signatures.seller, signWidths[0]), cell([para([])], gutter), signCell(document.signatures.buyer, signWidths[2])],
        }),
      ],
      signWidths,
    ),
    new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT } }),
  ];
}

/**
 * Переносы — только в абзацах по ширине: заголовки, подписи и ячейки таблиц не рвём.
 * И «Внедрять шрифты»: клиент поправит договор и сохранит — Manrope останется внутри.
 */
async function finish(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const settings = zip.file("word/settings.xml");
  if (settings) {
    const xml = await settings.async("string");
    if (!xml.includes("w:embedTrueTypeFonts")) zip.file("word/settings.xml", xml.replace(/(<w:settings[^>]*>)/, "$1<w:embedTrueTypeFonts/>"));
  }
  for (const name of Object.keys(zip.files).filter((file) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(file))) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    zip.file(
      name,
      xml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (whole, inner: string) =>
        inner.includes('<w:jc w:val="both"/>') || inner.includes("w:suppressAutoHyphens") ? whole : `<w:pPr>${inner.replace("<w:spacing ", "<w:suppressAutoHyphens/><w:spacing ")}</w:pPr>`,
      ),
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function renderContractDocx(document: ContractDocument, sellerSnapshot: ContractSeller): Promise<Buffer> {
  const seller = brandSeller(sellerSnapshot);
  const half = W / 2;
  const J = AlignmentType.JUSTIFIED;
  const body: Array<Paragraph | Table> = [
    para([run(`${document.title} № ${document.number}`, { size: SIZE.title, sb: true })], { line: 240 }),
    para([run(document.subtitle, { size: SIZE.lead, color: C.muted })], { before: 110, line: 250 }),
    table(
      [
        new TableRow({
          children: [
            cell([para([run(document.city, { size: 9.5, color: C.ink2 })], { line: 240 })], half, { margins: { top: 150, bottom: 150 } }),
            cell([para([run(document.dateLong, { size: 9.5, color: C.ink2 })], { align: AlignmentType.RIGHT, line: 240 })], half, { margins: { top: 150, bottom: 150 } }),
          ],
        }),
      ],
      [half, half],
      { ...NO_BORDERS, top: hair(C.border2), bottom: hair(C.border2) },
    ),
  ];
  if (document.voided) body.push(para([run("Аннулирован — договор недействителен", { size: 8.5, sb: true, color: C.voidFg })], { before: 160 }));
  else if (document.draft) body.push(para([run("Проект — номер договора присвоится при выпуске", { size: 8.5, sb: true, color: C.indigoDeep })], { before: 160 }));
  body.push(para([run(document.preamble, { color: C.ink2 })], { align: J, before: 240, after: 80, line: 276 }));

  const last = document.sections[document.sections.length - 1];
  for (const section of document.sections) {
    body.push(sectionHeading(section.num, section.title));
    if (section === last) break;
    for (const block of section.blocks) {
      body.push(
        block.kind === "clause"
          ? para([run(`${block.num} `, { sb: true, color: C.indigoDeep }), run(block.text, { color: C.ink2 })], { align: J, after: 70, line: 276 })
          : para([run(`${block.marker}\t`, { sb: true, color: C.indigoDeep }), run(block.text, { color: C.ink2 })], {
              align: J,
              indentLeft: cm(0.9),
              hanging: cm(0.5),
              after: 50,
              line: 276,
            }),
      );
    }
  }

  // Реквизиты и подписи — две карточки с тонкой рамкой; подписи сторон на одном уровне.
  const gutter = cm(0.5);
  const cardW = Math.floor((W - gutter) / 2);
  const widths = [cardW, gutter, W - gutter - cardW];
  const upper = { top: hair(C.border2), left: hair(C.border2), right: hair(C.border2), bottom: NONE };
  const lower = { top: NONE, left: hair(C.border2), right: hair(C.border2), bottom: hair(C.border2) };
  const pad = { left: 220, right: 220 };
  const card = (children: Paragraph[], width: number, borders: ITableCellBorders, top: number) =>
    cell(children, width, { margins: { ...pad, top, bottom: 200 }, borders });
  const spacer = () => cell([para([])], gutter);
  body.push(
    table(
      [
        new TableRow({
          cantSplit: true,
          children: [card(requisites("Исполнитель", document.requisites.seller), widths[0], upper, 200), spacer(), card(requisites("Заказчик", document.requisites.buyer), widths[2], upper, 200)],
        }),
        new TableRow({
          cantSplit: true,
          children: [card(signature(document.signatures.seller), widths[0], lower, 260), spacer(), card(signature(document.signatures.buyer), widths[2], lower, 260)],
        }),
      ],
      widths,
    ),
    // Свой последний абзац в 1 пт: иначе Word добавит обычный после таблицы, и он уедет на пустой лист.
    new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT } }),
  );

  for (const appendix of document.appendices) body.push(...appendixBlocks(appendix, document, widths, gutter));

  const fontDir = path.join(process.cwd(), "src", "lib", "pdf-fonts");
  const fonts = FONT_FILES.filter(({ file }) => fs.existsSync(path.join(fontDir, file))).map(({ name, file }) => ({ name, data: fs.readFileSync(path.join(fontDir, file)) }));
  const doc = new Document({
    creator: "WeSetup",
    title: `${document.title} № ${document.number}`,
    description: "Договор оказания услуг WeSetup",
    fonts,
    hyphenation: { autoHyphenation: true, consecutiveHyphenLimit: 2, doNotHyphenateCaps: true, hyphenationZone: 357 },
    styles: { default: { document: { run: { font: FONT, size: SIZE.body * 2, color: C.ink, language: { value: "ru-RU" } }, paragraph: { spacing: { before: 0, after: 0, line: 264 } } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: 16838 },
            margin: { top: cm(1.7), bottom: cm(1.7), left: SIDE, right: SIDE, header: cm(0.8), footer: cm(0.75) },
          },
        },
        footers: { default: footer() },
        children: body,
      },
    ],
  });
  return finish(await Packer.toBuffer(doc));
}
