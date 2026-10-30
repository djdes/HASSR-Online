import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

import { brandAsset, brandSeller, type BrandSeller } from "@/lib/brand-docs/pdf-kit";

import type { ContractDocument, RequisiteRow, SignatureSide } from "./template";
import type { ContractSeller } from "./types";

/**
 * DOCX договора — для правок юристом или клиентом. Тот же текст, что в PDF,
 * и упрощённый фирменный стиль: тёмные полосы шапки и подвала (без
 * скруглений — Word их в таблицах не умеет), индиго-номера разделов.
 * Факсимиле и печать в редактируемый файл намеренно не ставятся.
 */

const FONT = "Segoe UI";
const C = {
  ink: "0B1024",
  ink2: "3C4053",
  muted: "6F7282",
  faint: "9B9FB3",
  indigo: "5566F6",
  indigoDeep: "3848C7",
  tint: "F5F6FF",
  soft: "FAFBFF",
  border: "E6E8F2",
  lilac: "8E9BF8",
  lilacText: "A3AEF8",
  lav: "C9CEF0",
  white: "FFFFFF",
};

/** см → twips. */
const cm = (value: number) => Math.round(value * 566.929);
/** см → px (96 dpi) для картинок. */
const px = (value: number) => (value * 96) / 2.54;

const PAGE_W = 11906;
const SIDE = cm(1.2);
const W = PAGE_W - 2 * SIDE;

const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

type RunOptions = { size?: number; color?: string; bold?: boolean; spacing?: number };

const run = (text: string, options: RunOptions = {}) =>
  new TextRun({
    text,
    font: FONT,
    size: Math.round((options.size ?? 9.5) * 2),
    color: options.color ?? C.ink,
    bold: options.bold ?? false,
    characterSpacing: options.spacing,
  });

const para = (
  children: Array<TextRun | ImageRun>,
  options: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number; indentLeft?: number; hanging?: number; keepNext?: boolean } = {},
) =>
  new Paragraph({
    children,
    alignment: options.align,
    spacing: { before: options.before ?? 0, after: options.after ?? 0, line: 264 },
    indent: options.indentLeft || options.hanging ? { left: options.indentLeft ?? 0, hanging: options.hanging } : undefined,
    keepNext: options.keepNext,
  });

const cell = (children: Paragraph[], width: number, options: { fill?: string; margins?: number; span?: number } = {}) =>
  new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    shading: options.fill ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill } : undefined,
    margins: { top: options.margins ?? 80, bottom: options.margins ?? 80, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: options.span,
  });

function wordmark(): Array<ImageRun | TextRun> {
  const data = brandAsset("wordmark-gradient.png");
  if (!data) return [run("сетап", { size: 16, bold: true, color: C.lilac })];
  const w = data.readUInt32BE(16);
  const h = data.readUInt32BE(20);
  return [new ImageRun({ type: "png", data, transformation: { width: px(3.15), height: px((3.15 * h) / w) }, altText: { name: "WeSetup", title: "WeSetup", description: "Логотип WeSetup" } })];
}

function header(seller: BrandSeller): Header {
  const widths = [W - 6200, 6200];
  const ids = [seller.inn && `ИНН ${seller.inn}`, seller.kpp && `КПП ${seller.kpp}`, seller.ogrn && `ОГРН ${seller.ogrn}`].filter(Boolean).join("  ·  ");
  const contacts = [seller.phone, seller.email].filter(Boolean).join("  ·  ");
  return new Header({
    children: [
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: W, type: WidthType.DXA },
        columnWidths: widths,
        borders: NO_BORDERS,
        rows: [
          new TableRow({
            children: [
              cell([para(wordmark()), para([run("Ваш электронный журнал", { size: 9, bold: true, color: C.lilacText })], { before: 40 })], widths[0], { fill: C.ink, margins: 160 }),
              cell(
                [
                  para([run(seller.nameShort, { size: 9, bold: true, color: C.white })], { align: AlignmentType.RIGHT }),
                  ...[ids, seller.address, contacts].filter(Boolean).map((line) => para([run(line, { size: 7.5, color: C.lav })], { align: AlignmentType.RIGHT })),
                ],
                widths[1],
                { fill: C.ink, margins: 160 },
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

function footer(seller: BrandSeller, runningTitle: string): Footer {
  const widths = [W - 6200, 6200];
  return new Footer({
    children: [
      para(
        [
          run(`${runningTitle}  ·  Стр. `, { size: 7, color: C.faint }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 14, color: C.faint }),
          run(" из ", { size: 7, color: C.faint }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 14, color: C.faint }),
        ],
        { align: AlignmentType.RIGHT, after: 60 },
      ),
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: W, type: WidthType.DXA },
        columnWidths: widths,
        borders: NO_BORDERS,
        rows: [
          new TableRow({
            children: [
              cell(
                [
                  para([run("Электронные журналы по принципам ХАССП", { size: 8.5, bold: true, color: C.white })]),
                  para([run(seller.site, { size: 8.5, bold: true, color: C.lilac })]),
                ],
                widths[0],
                { fill: C.ink, margins: 110 },
              ),
              cell(
                [
                  para([run(seller.phone, { size: 8.5, bold: true, color: C.white })], { align: AlignmentType.RIGHT }),
                  para([run([seller.email, seller.nameShort].filter(Boolean).join("  ·  "), { size: 8, color: C.lav })], { align: AlignmentType.RIGHT }),
                ],
                widths[1],
                { fill: C.ink, margins: 110 },
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

const sectionHeading = (num: number, title: string) =>
  para([run(String(num).padStart(2, "0"), { size: 9, bold: true, color: C.indigo }), run(`   ${title}`, { size: 12, bold: true })], { before: 240, after: 100, keepNext: true });

function requisitesCell(rows: RequisiteRow[], width: number): TableCell {
  return cell(
    rows.map((row) =>
      para([run(`${row.label}: `, { size: 8, color: C.muted }), run(row.value, { size: 8.5, bold: row.strong })], { after: 40 }),
    ),
    width,
  );
}

function signatureCell(side: SignatureSide, width: number): TableCell {
  return cell(
    [
      para([run(side.caption, { size: 8.5, color: C.ink2 })], { after: 360 }),
      para([run("_______________", { size: 9, color: C.faint }), run(`  / ${side.nameShort}`, { size: 9, bold: true })]),
      para([run("М.П.", { size: 7, color: C.faint })], { before: 80 }),
    ],
    width,
  );
}

export async function renderContractDocx(document: ContractDocument, sellerSnapshot: ContractSeller): Promise<Buffer> {
  const seller = brandSeller(sellerSnapshot);
  const half = W / 2;
  const body: Array<Paragraph | Table> = [
    para([run(document.title.toUpperCase(), { size: 7.5, bold: true, color: C.indigo, spacing: 24 })]),
    para([run(`${document.title} № ${document.number}`, { size: 17, bold: true })], { before: 80 }),
    para([run("на доступ к сервису электронных журналов WeSetup и сопутствующие услуги", { size: 9.5, color: C.muted })], { after: 120 }),
    new Table({
      layout: TableLayoutType.FIXED,
      width: { size: W, type: WidthType.DXA },
      columnWidths: [half, half],
      borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 12, color: C.indigo } },
      rows: [
        new TableRow({
          children: [
            cell([para([run(document.city, { size: 9.5, color: C.ink2 })])], half),
            cell([para([run(document.dateLong, { size: 9.5, color: C.ink2 })], { align: AlignmentType.RIGHT })], half),
          ],
        }),
      ],
    }),
  ];
  if (document.voided) body.push(para([run("АННУЛИРОВАН — договор недействителен", { size: 8, bold: true, color: "A13A32" })], { before: 120 }));
  else if (document.draft) body.push(para([run("ПРОЕКТ — номер договора присвоится при выпуске", { size: 8, bold: true, color: C.indigoDeep })], { before: 120 }));
  body.push(para([run(document.preamble, { size: 9, color: C.ink2 })], { align: AlignmentType.JUSTIFIED, before: 200, after: 80 }));

  const last = document.sections[document.sections.length - 1];
  for (const section of document.sections) {
    body.push(sectionHeading(section.num, section.title));
    if (section === last) break;
    for (const block of section.blocks) {
      body.push(
        block.kind === "clause"
          ? para([run(`${block.num} `, { size: 9, bold: true }), run(block.text, { size: 9, color: C.ink2 })], { align: AlignmentType.JUSTIFIED, after: 60 })
          : para([run(`${block.marker}\t`, { size: 9, bold: true, color: C.indigoDeep }), run(block.text, { size: 9, color: C.ink2 })], {
              align: AlignmentType.JUSTIFIED,
              indentLeft: cm(0.9),
              hanging: cm(0.5),
              after: 40,
            }),
      );
    }
  }

  const headCell = (text: string) => cell([para([run(text.toUpperCase(), { size: 8, bold: true, color: C.white, spacing: 16 })])], half, { fill: C.ink });
  body.push(
    new Table({
      layout: TableLayoutType.FIXED,
      width: { size: W, type: WidthType.DXA },
      columnWidths: [half, half],
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: C.border },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: C.border },
        left: { style: BorderStyle.SINGLE, size: 4, color: C.border },
        right: { style: BorderStyle.SINGLE, size: 4, color: C.border },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: C.border },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: C.border },
      },
      rows: [
        new TableRow({ tableHeader: true, children: [headCell("Исполнитель"), headCell("Заказчик")] }),
        new TableRow({ cantSplit: true, children: [requisitesCell(document.requisites.seller, half), requisitesCell(document.requisites.buyer, half)] }),
        new TableRow({ cantSplit: true, children: [signatureCell(document.signatures.seller, half), signatureCell(document.signatures.buyer, half)] }),
      ],
    }),
  );

  const doc = new Document({
    creator: "WeSetup",
    title: `${document.title} № ${document.number}`,
    description: "Договор оказания услуг WeSetup",
    styles: { default: { document: { run: { font: FONT, size: 18, color: C.ink, language: { value: "ru-RU" } } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: 16838 },
            margin: { top: cm(3.5), bottom: cm(2.9), left: SIDE, right: SIDE, header: cm(0.5), footer: cm(0.5) },
          },
        },
        headers: { default: header(seller) },
        footers: { default: footer(seller, document.runningTitle) },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
