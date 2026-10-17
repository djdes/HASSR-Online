/**
 * PDF одного приказа.
 *
 * Свой маленький рендер, а не ветка в `document-pdf.ts` (6691 строка):
 * там сетки журналов «сотрудник × день» с autoTable, приказу же нужен
 * обычный поток абзацев на A4. Общее у них ровно одно — загрузка
 * юникодного шрифта, и она здесь повторена в пять строк, что дешевле
 * зависимости от самого большого модуля репозитория.
 */

import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";

import { brandInk, hexToRgb, normalizeBrandColor } from "@/lib/document-brand";
import { drawPdfLogo, type PdfLogo } from "@/lib/pdf-logo";
import type { OrderTemplate } from "./catalog";
import { orderRequisitesLine, renderOrder, type OrderOrgSnapshot, type OrderValues } from "./render";

/**
 * Тот же список, что в `document-pdf.ts`: сначала шрифт из репозитория
 * (на проде системных кириллических может не быть вовсе), потом
 * системные запасные. Без юникодного шрифта jsPDF откатится на
 * helvetica и напечатает кракозябры.
 */
const FONT_CANDIDATES = [
  path.join(process.cwd(), "src", "lib", "pdf-fonts", "DejaVuSans.ttf"),
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
];

function loadFont(doc: jsPDF): string {
  const fontPath = FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!fontPath) return "helvetica";
  const base64 = fs.readFileSync(fontPath).toString("base64");
  doc.addFileToVFS("order-unicode.ttf", base64);
  doc.addFont("order-unicode.ttf", "OrderUnicode", "normal");
  doc.addFont("order-unicode.ttf", "OrderUnicode", "bold");
  return "OrderUnicode";
}

// A4 в миллиметрах, поля как у делового документа по ГОСТ Р 7.0.97:
// слева шире под подшивку.
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_LEFT = 30;
const MARGIN_RIGHT = 15;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 20;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

export type OrderPdfInput = {
  template: OrderTemplate;
  org: OrderOrgSnapshot;
  values: OrderValues;
  number: string;
  issuedAt: Date | string;
  /** Логотип организации над названием; нет — шапка без логотипа. */
  logo?: PdfLogo | null;
  /**
   * Фирменный цвет — тонкая линия под реквизитами. Нет — приказ строго ч/б
   * (правило печати 2026-09-27); текст всегда чёрный.
   */
  brandColor?: string | null;
};

/** Транслитерация для имени файла: кириллица в Content-Disposition ломает часть клиентов. */
function fileSlug(code: string): string {
  return code.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

export function renderOrderPdf(input: OrderPdfInput): {
  buffer: Buffer;
  fileName: string;
} {
  const order = renderOrder(input);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const font = loadFont(doc);

  let y = MARGIN_TOP;

  /** Перенос на новую страницу, когда следующий блок не помещается. */
  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_HEIGHT - MARGIN_BOTTOM) {
      doc.addPage();
      y = MARGIN_TOP;
    }
  };

  const writeParagraph = (
    text: string,
    opts: {
      size?: number;
      style?: "normal" | "bold";
      align?: "left" | "center";
      lineHeight?: number;
      gapAfter?: number;
      indent?: number;
    } = {}
  ) => {
    const size = opts.size ?? 11;
    const lineHeight = opts.lineHeight ?? size * 0.55;
    doc.setFont(font, opts.style ?? "normal");
    doc.setFontSize(size);
    const indent = opts.indent ?? 0;
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent) as string[];
    ensureSpace(lines.length * lineHeight);
    for (const line of lines) {
      if (opts.align === "center") {
        doc.text(line, PAGE_WIDTH / 2, y, { align: "center" });
      } else {
        doc.text(line, MARGIN_LEFT + indent, y);
      }
      y += lineHeight;
    }
    y += opts.gapAfter ?? 0;
  };

  // Шапка: логотип, название организации и реквизиты под ним. Текст шапки
  // центрируется по листу (`PAGE_WIDTH / 2`), поэтому логотип и фирменная
  // линия — тоже по центру листа, а не колонки текста со смещённым полем.
  const headerLeft = (PAGE_WIDTH - CONTENT_WIDTH) / 2;
  if (input.logo) {
    const { h } = drawPdfLogo(doc, input.logo, { x: headerLeft, y: y - 4, maxW: CONTENT_WIDTH, maxH: 14, align: "center" });
    y += h + 2;
  }
  writeParagraph(order.title ? input.org.orgName : input.org.orgName, {
    size: 12,
    style: "bold",
    align: "center",
    gapAfter: 1,
  });

  const requisites = orderRequisitesLine(input.org);
  if (requisites) {
    writeParagraph(requisites, { size: 9, align: "center", gapAfter: 6 });
  } else {
    y += 6;
  }
  const brandColor = normalizeBrandColor(input.brandColor);
  if (brandColor) {
    doc.setFillColor(...hexToRgb(brandInk(brandColor)));
    doc.rect(headerLeft, y - 4.5, CONTENT_WIDTH, 0.6, "F");
    doc.setFillColor(255, 255, 255);
    y += 2;
  }

  writeParagraph(order.heading, {
    size: 14,
    style: "bold",
    align: "center",
    gapAfter: 3,
  });

  writeParagraph(order.title, {
    size: 11,
    style: "bold",
    align: "center",
    gapAfter: 6,
  });

  // Строка «город … дата» — по краям одной линии, как в деловом бланке.
  doc.setFont(font, "normal");
  doc.setFontSize(11);
  ensureSpace(8);
  doc.text(order.city, MARGIN_LEFT, y);
  doc.text(order.dateLine, PAGE_WIDTH - MARGIN_RIGHT, y, { align: "right" });
  y += 10;

  writeParagraph(order.preamble, { size: 11, gapAfter: 4 });

  for (const paragraph of order.body) {
    // Строки-перечисления с тире заводим с отступом — так список
    // отделяется от пунктов приказа.
    const isBullet = paragraph.startsWith("—");
    writeParagraph(paragraph, {
      size: 11,
      indent: isBullet ? 6 : 0,
      gapAfter: isBullet ? 0.5 : 2,
    });
  }

  y += 10;
  ensureSpace(24);

  // Подпись: должность слева, расшифровка справа, между ними линия.
  doc.setFont(font, "normal");
  doc.setFontSize(11);
  doc.text(order.signature.post, MARGIN_LEFT, y);
  doc.text(order.signature.name, PAGE_WIDTH - MARGIN_RIGHT, y, {
    align: "right",
  });
  const lineLeft = MARGIN_LEFT + doc.getTextWidth(order.signature.post) + 8;
  const lineRight =
    PAGE_WIDTH - MARGIN_RIGHT - doc.getTextWidth(order.signature.name) - 8;
  if (lineRight > lineLeft) {
    doc.setLineWidth(0.2);
    doc.line(lineLeft, y + 0.5, lineRight, y + 0.5);
  }
  y += 14;

  // Лист ознакомления: приказ без подписей работников не работает.
  ensureSpace(30);
  writeParagraph("С приказом ознакомлены:", { size: 10, gapAfter: 4 });
  doc.setFontSize(10);
  for (let i = 0; i < 4; i++) {
    ensureSpace(10);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_LEFT, y, MARGIN_LEFT + 70, y);
    doc.line(MARGIN_LEFT + 80, y, MARGIN_LEFT + 130, y);
    doc.text("должность, Ф. И. О.", MARGIN_LEFT, y + 3.5);
    doc.text("подпись, дата", MARGIN_LEFT + 80, y + 3.5);
    y += 12;
  }

  const buffer = Buffer.from(doc.output("arraybuffer"));
  return {
    buffer,
    fileName: `prikaz-${fileSlug(input.template.code)}.pdf`,
  };
}
