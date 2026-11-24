/**
 * Печатная Программа производственного контроля по структуре документа
 * владельца (вариант «б», spec `ppk-print-revisions-2026-11-24`): титульный
 * лист, «Содержание», разделы 1–3 и приложения № 1–6. Документы (тексты
 * пунктов, процедуры, инструкции) — «с нашей шапкой» и номером редакции
 * «ППК NNN»; загруженный скан заменяет текст и встаёт страницами в рамку.
 * На каждой странице, кроме титульной, — колонтитул и «Стр. N из M»: сквозная
 * нумерация по всем страницам, включая сканы.
 *
 * Текст рисует jsPDF (кириллический шрифт), страницы сканов — pdf-lib поверх
 * заготовленных страниц-рамок.
 */
import JSZip from "jszip";
import type { CellHookData } from "jspdf-autotable";
import autoTable from "jspdf-autotable";
import { PDFDocument } from "pdf-lib";
import { officeZipWithinLimits } from "@/lib/knowledge-documents";
import { hazardRisk, isSignificantHazard } from "./haccp";
import { MEDICAL_PHRASE } from "./program-content";
import { PPK_STRUCTURE, type PpkItemId, type PpkStructureItem } from "./structure";
import { ppkItemHeadingRu, ppkSectionHeadingRu } from "./structure-titles";
import {
  HAZARD_TYPE_RU,
  INK,
  KIND_RU,
  LAB_OBJECT_RU,
  MARGIN,
  MUTED,
  ROLE_PROGRAM,
  drawFlowchart,
  empty,
  ensureSpace,
  list,
  pageSize,
  ruDate,
  start,
  table,
  text,
  type Ctx,
} from "./pdf";
import type { PpkPrintData, PrintAck, PrintDoc, PrintFile } from "./structure-print.server";

const PROGRAM_LABEL = "Программа производственного контроля";
const UNAPPROVED = "Редакция не утверждена";
/** Пределы сканов в одной программе (spec, Р7). */
export const SCAN_MAX_PAGES = 300;
export const SCAN_MAX_BYTES = 80 * 1024 * 1024;
/** Верх содержимого страницы: под колонтитулом. */
const TOP = MARGIN;

type FilePlan =
  | { kind: "pdf"; pages: number }
  | { kind: "image"; format: "png" | "jpg" }
  | { kind: "text"; text: string }
  | { kind: "skip"; reason: "format" | "broken" | "limit" };

/** Страница-рамка под страницу скана: pdf-lib вставит её в прямоугольник. */
type ScanSlot = { page: number; file: PrintFile; plan: FilePlan; pageIndex: number; box: { x: number; y: number; w: number; h: number } };

type PCtx = Ctx & {
  label: string;
  labels: string[];
  slots: ScanSlot[];
  itemPages: Map<string, number>;
  plans: Map<string, FilePlan>;
};

const EXTENSION_RU: Record<string, string> = { doc: "DOC", docx: "DOCX", xls: "XLS", xlsx: "XLSX", zip: "ZIP", rar: "RAR", "7z": "7Z" };

function extensionOf(file: PrintFile): string {
  return file.fileName.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Текст из DOCX без разметки (как в предпросмотре базы знаний). Сначала —
 * предел распаковки: маленький файл не должен раздуться в сотни мегабайт.
 */
async function docxText(bytes: Uint8Array): Promise<string | null> {
  if (!officeZipWithinLimits(bytes)) return null;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return null;
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .slice(0, 200_000);
}

/**
 * Что делать с каждым файлом: PDF — сколько страниц, картинка — проверена,
 * DOCX и текст — текстом, остальное — строкой. Битые, зашифрованные и сверх
 * пределов — строкой, без падения сборки.
 */
export async function planPrintFiles(files: PrintFile[]): Promise<Map<string, FilePlan>> {
  const plans = new Map<string, FilePlan>();
  const scratch = await PDFDocument.create();
  let pages = 0;
  let bytes = 0;
  for (const file of files) {
    if (plans.has(file.id)) continue;
    const ext = extensionOf(file);
    const isPdf = file.mimeType === "application/pdf" || ext === "pdf";
    const isImage = file.mimeType === "image/png" || file.mimeType === "image/jpeg" || ["png", "jpg", "jpeg"].includes(ext);
    // Байты не прочитаны: файл сверх объёма сканов программы.
    if (file.bytes.byteLength === 0) {
      plans.set(file.id, { kind: "skip", reason: file.sizeBytes > 0 ? "limit" : "broken" });
      continue;
    }
    try {
      if (file.mimeType.startsWith("text/plain")) {
        plans.set(file.id, { kind: "text", text: Buffer.from(file.bytes).toString("utf8") });
      } else if (ext === "docx") {
        const extracted = await docxText(file.bytes);
        plans.set(file.id, extracted ? { kind: "text", text: extracted } : { kind: "skip", reason: "broken" });
      } else if (isPdf || isImage) {
        if (bytes + file.bytes.byteLength > SCAN_MAX_BYTES) {
          plans.set(file.id, { kind: "skip", reason: "limit" });
          continue;
        }
        if (isPdf) {
          const loaded = await PDFDocument.load(file.bytes, { updateMetadata: false });
          const count = loaded.getPageCount();
          if (count === 0) throw new Error("empty");
          if (pages + count > SCAN_MAX_PAGES) {
            plans.set(file.id, { kind: "skip", reason: "limit" });
            continue;
          }
          pages += count;
          plans.set(file.id, { kind: "pdf", pages: count });
        } else {
          const png = file.bytes[0] === 0x89 && file.bytes[1] === 0x50;
          if (png) await scratch.embedPng(file.bytes);
          else await scratch.embedJpg(file.bytes);
          if (pages + 1 > SCAN_MAX_PAGES) {
            plans.set(file.id, { kind: "skip", reason: "limit" });
            continue;
          }
          pages += 1;
          plans.set(file.id, { kind: "image", format: png ? "png" : "jpg" });
        }
        bytes += file.bytes.byteLength;
      } else {
        plans.set(file.id, { kind: "skip", reason: "format" });
      }
    } catch {
      plans.set(file.id, { kind: "skip", reason: "broken" });
    }
  }
  return plans;
}

function isLandscape(ctx: PCtx): boolean {
  return ctx.doc.internal.pageSize.getWidth() > ctx.doc.internal.pageSize.getHeight();
}

/**
 * Новая страница. Текущая пустая страница той же ориентации (после документа
 * или приложения) используется сама — без пустых листов между документами.
 */
function newPage(ctx: PCtx, orientation: "portrait" | "landscape" = "portrait") {
  const page = ctx.doc.getNumberOfPages();
  const blank =
    page > 1 &&
    ctx.y <= TOP + 0.5 &&
    !ctx.slots.some((slot) => slot.page === page) &&
    isLandscape(ctx) === (orientation === "landscape");
  if (blank) {
    ctx.labels[page] = ctx.label;
    return;
  }
  ctx.doc.addPage("a4", orientation);
  ctx.y = TOP;
}

function setLabel(ctx: PCtx, label: string) {
  ctx.label = label;
  // Текущая страница — тоже под этим колонтитулом, если на ней ещё ничего нет.
  if (ctx.y <= TOP + 0.5) ctx.labels[ctx.doc.getNumberOfPages()] = label;
}

function heading(ctx: PCtx, item: PpkStructureItem) {
  ensureSpace(ctx, 24);
  ctx.y += 2;
  ctx.itemPages.set(item.id, ctx.doc.getNumberOfPages());
  text(ctx, ppkItemHeadingRu(item), { size: 11.5, bold: true, gap: 2.5 });
}

function paragraphs(ctx: PCtx, value: string) {
  const blocks = value.replace(/\r\n/g, "\n").split(/\n/);
  for (const line of blocks) {
    if (!line.trim()) {
      ctx.y += 2;
      continue;
    }
    text(ctx, line, { size: 10, gap: 0.8 });
  }
  ctx.y += 2;
}

/** «Наша шапка» документа: организация, название и номер редакции. */
function docHeader(ctx: PCtx, title: string, revision: string | null, orgName: string) {
  const { doc } = ctx;
  const { w } = pageSize(ctx);
  const right = 52;
  const left = w - MARGIN * 2 - right;
  doc.setFont(ctx.font, "bold");
  doc.setFontSize(10.5);
  const titleLines = doc.splitTextToSize(title, left - 6) as string[];
  const height = Math.max(18, 10 + titleLines.length * 4.6);
  ensureSpace(ctx, height + 6);
  const x = MARGIN;
  const y = ctx.y;
  doc.setDrawColor(200, 203, 220);
  doc.setLineWidth(0.25);
  doc.rect(x, y, w - MARGIN * 2, height);
  doc.line(x + left, y, x + left, y + height);
  doc.setFont(ctx.font, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text((doc.splitTextToSize(orgName || "—", left - 6) as string[])[0] ?? "", x + 3, y + 5);
  doc.setFont(ctx.font, "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  titleLines.forEach((line, index) => doc.text(line, x + 3, y + 10.5 + index * 4.6));
  const [code, date] = revision ? revision.split(" от ") : [UNAPPROVED, ""];
  doc.setFont(ctx.font, revision ? "bold" : "normal");
  doc.setFontSize(revision ? 11 : 8.5);
  doc.setTextColor(...(revision ? INK : MUTED));
  const codeLines = doc.splitTextToSize(code, right - 6) as string[];
  codeLines.forEach((line, index) => doc.text(line, x + left + 3, y + 7 + index * 4));
  if (date) {
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`от ${date}`, x + left + 3, y + 12.5);
  }
  ctx.y = y + height + 5;
}

function fileLine(file: PrintFile, plan: FilePlan | undefined): string {
  const ext = EXTENSION_RU[extensionOf(file)] ?? extensionOf(file).toUpperCase();
  if (plan?.kind === "skip" && plan.reason === "broken") return `Файл «${file.title}» не удалось вставить (повреждён или защищён паролем) — приложен в электронном виде.`;
  if (plan?.kind === "skip" && plan.reason === "limit") return `Файл «${file.title}» не вставлен: в программе уже много страниц сканов — приложен в электронном виде.`;
  return `Файл «${file.title}»${ext ? ` (${ext})` : ""} приложен к программе в электронном виде.`;
}

/** Файл документа: страницы скана в рамки, текст — текстом, остальное — строкой. */
function placeFile(ctx: PCtx, file: PrintFile) {
  const plan = ctx.plans.get(file.id);
  if (plan?.kind === "text") {
    paragraphs(ctx, plan.text);
    return;
  }
  if (plan?.kind === "pdf" || plan?.kind === "image") {
    const pages = plan.kind === "pdf" ? plan.pages : 1;
    for (let index = 0; index < pages; index += 1) {
      const { w, h } = pageSize(ctx);
      // Первая страница скана — под шапкой документа, если места хватает на половину листа.
      if (index > 0 || ctx.y > h * 0.5) newPage(ctx);
      const box = { x: MARGIN, y: ctx.y, w: w - MARGIN * 2, h: h - ctx.y - MARGIN - 4 };
      ctx.slots.push({ page: ctx.doc.getNumberOfPages(), file, plan, pageIndex: index, box });
      ctx.y = h;
    }
    return;
  }
  text(ctx, fileLine(file, plan), { color: MUTED, gap: 2 });
}

/** Документ с шапкой на новой странице; файлы (скан) заменяют текст. */
function renderDoc(ctx: PCtx, item: PpkStructureItem | null, doc: PrintDoc | undefined, orgName: string) {
  newPage(ctx);
  const label = doc ? `${doc.title} · ${doc.revision ?? UNAPPROVED}` : PROGRAM_LABEL;
  setLabel(ctx, label);
  if (item) heading(ctx, item);
  if (!doc || (!doc.text?.trim() && doc.files.length === 0)) {
    empty(ctx);
    setLabel(ctx, PROGRAM_LABEL);
    return;
  }
  docHeader(ctx, doc.title, doc.revision, orgName);
  if (doc.files.length > 0) for (const file of doc.files) placeFile(ctx, file);
  else paragraphs(ctx, doc.text ?? "");
  ctx.label = PROGRAM_LABEL;
}

function diagrams(ctx: PCtx, charts: PpkPrintData["orgCharts"]) {
  if (charts.length === 0) {
    empty(ctx);
    return;
  }
  text(ctx, charts.length === 1 ? "Схема приведена на следующей странице." : "Схемы приведены на следующих страницах.", { color: MUTED, gap: 2 });
  for (const chart of charts) drawFlowchart(ctx, chart);
  newPage(ctx);
}

function signatureCell(ack: PrintAck, when: string): string {
  if (ack.method === "finger" && ack.signature) return "";
  return ack.method === "pin" ? `PIN-код, ${when}` : `в кабинете, ${when}`;
}

/** Лист ознакомления 3.7: подпись пальцем — картинкой, PIN — строкой. */
function acquaintanceSheet(ctx: PCtx, data: PpkPrintData) {
  const { acks } = data;
  if (!acks) {
    text(ctx, "Лист ознакомления откроется, когда программа будет утверждена версией или загружена файлом.", { color: MUTED, gap: 3 });
    return;
  }
  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("ru-RU", { timeZone: data.timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    } catch {
      return ruDate(iso.slice(0, 10));
    }
  };
  const rows = [
    ...acks.map((ack, index) => [String(index + 1), ack.name, ack.title || "—", `Ознакомлен и согласен, ${fmt(ack.at)}`, signatureCell(ack, fmt(ack.at))]),
    ...data.pendingNames.map((person, index) => [String(acks.length + index + 1), person.name, person.title || "—", "", ""]),
  ];
  if (rows.length === 0) rows.push(["", "", "", "", ""]);
  autoTable(ctx.doc, {
    startY: ctx.y,
    head: [["№", "Ф. И. О.", "Должность", "Отметка", "Подпись"]],
    body: rows,
    theme: "grid",
    margin: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN + 6 },
    styles: { font: ctx.font, fontSize: 8.5, cellPadding: 1.6, textColor: INK, lineColor: [200, 203, 220], lineWidth: 0.2, minCellHeight: 11, valign: "middle" },
    headStyles: { font: ctx.font, fontStyle: "bold", fillColor: ctx.headFill, textColor: INK, minCellHeight: 7 },
    columnStyles: { 0: { cellWidth: 9 }, 4: { cellWidth: 38 } },
    didDrawCell: (hook: CellHookData) => {
      if (hook.section !== "body" || hook.column.index !== 4) return;
      const ack = acks[hook.row.index];
      if (!ack?.signature) return;
      const pad = 1;
      const boxW = hook.cell.width - pad * 2;
      const boxH = hook.cell.height - pad * 2;
      // Подпись 3:1 — вписываем по ширине и высоте ячейки.
      const width = Math.min(boxW, boxH * 3);
      const height = width / 3;
      const dataUrl = `data:image/png;base64,${Buffer.from(ack.signature).toString("base64")}`;
      try {
        ctx.doc.addImage(dataUrl, "PNG", hook.cell.x + pad + (boxW - width) / 2, hook.cell.y + pad + (boxH - height) / 2, width, height);
      } catch {
        /* битая подпись — пустая ячейка */
      }
    },
  });
  const last = (ctx.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  ctx.y = (last?.finalY ?? ctx.y) + 4;
}

/** Содержимое пункта по его виду (как окно пункта). */
function renderItem(ctx: PCtx, item: PpkStructureItem, data: PpkPrintData) {
  const { bundle } = data;
  const docItems: PpkItemId[] = ["1-8", "1-9", "2-1", "2-2", "2-3", "2-9", "app-3"];
  if (docItems.includes(item.id)) {
    renderDoc(ctx, item, data.docs[item.id], data.orgName);
    newPage(ctx);
    return;
  }
  heading(ctx, item);
  switch (item.id) {
    case "1-1":
      table(ctx, ["Показатель", "Значение"], data.generalInfo);
      return;
    case "1-2":
      diagrams(ctx, data.orgCharts);
      return;
    case "1-3":
      if (data.contracts.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["№", "Наименование договора", "Контрагент", "Номер", "Дата", "Действует до"],
          data.contracts.map((row, index) => [String(index + 1), row.title, row.counterparty || "—", row.number || "—", ruDate(row.date), ruDate(row.validUntil)]),
        );
      return;
    case "1-4":
      table(ctx, ["Показатель", "Значение"], data.production);
      return;
    case "1-5":
      if (bundle.products.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["№", "Наименование", "Состав", "Условия хранения", "Срок годности"],
          bundle.products.map((product, index) => [String(index + 1), product.name, product.composition || "—", product.storage || "—", product.shelfLife || "—"]),
          true,
        );
      return;
    case "1-6":
      diagrams(ctx, data.floorPlans);
      return;
    case "1-7":
      if (bundle.norms.length) list(ctx, bundle.norms, true);
      else empty(ctx);
      return;
    case "2-4": {
      if (data.teamOrderScans.length > 0) {
        const doc: PrintDoc = {
          title: "Приказ о группе ХАССП",
          revision: data.teamOrders[0] ? `Приказ № ${data.teamOrders[0].number} от ${data.teamOrders[0].date}` : null,
          text: null,
          files: data.teamOrderScans,
        };
        const orderLabel = `${doc.title}${doc.revision ? ` · ${doc.revision}` : ""}`;
        setLabel(ctx, orderLabel);
        // Заголовок пункта уже на странице: колонтитул этой страницы — тоже приказа.
        ctx.labels[ctx.doc.getNumberOfPages()] = orderLabel;
        for (const file of doc.files) placeFile(ctx, file);
        ctx.label = PROGRAM_LABEL;
        newPage(ctx);
        return;
      }
      if (data.teamOrders.length) {
        text(ctx, data.teamOrders.map((order) => `Приказ № ${order.number} от ${order.date}`).join("; "), { gap: 2 });
      }
      if (bundle.team.length) {
        table(ctx, ["Ф. И. О.", "Должность", "Роль в группе"], bundle.team.map((member) => [member.name, member.title || "—", ROLE_PROGRAM[member.role]]));
      } else if (!data.teamOrders.length) empty(ctx);
      return;
    }
    case "2-5":
      diagrams(ctx, bundle.flowcharts);
      return;
    case "2-6":
      if (bundle.hazards.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["Этап", "Опасный фактор", "Вид", "Меры управления"],
          bundle.hazards.map((hazard) => [hazard.step, hazard.hazard, HAZARD_TYPE_RU[hazard.type], hazard.measures || "—"]),
          true,
        );
      return;
    case "2-7": {
      const significant = bundle.hazards.filter((hazard) => isSignificantHazard(hazard.probability, hazard.severity));
      if (bundle.hazards.length === 0) empty(ctx);
      else if (significant.length === 0) text(ctx, "Значимых опасных факторов по результатам анализа не выявлено.", { gap: 3 });
      else
        table(
          ctx,
          ["Этап", "Значимый опасный фактор", "Вид", "Риск"],
          significant.map((hazard) => [hazard.step, hazard.hazard, HAZARD_TYPE_RU[hazard.type], String(hazardRisk(hazard.probability, hazard.severity))]),
          true,
        );
      return;
    }
    case "2-8":
      if (bundle.hazards.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["Опасный фактор", "Вероятность", "Тяжесть", "Риск", "Значимый"],
          bundle.hazards.map((hazard) => [
            `${hazard.step}: ${hazard.hazard}`,
            String(hazard.probability),
            String(hazard.severity),
            String(hazardRisk(hazard.probability, hazard.severity)),
            isSignificantHazard(hazard.probability, hazard.severity) ? "Да" : "Нет",
          ]),
          true,
        );
      return;
    case "2-10":
      if (bundle.points.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["№", "Этап", "Опасность", "Решение"],
          bundle.points.map((point) => [point.number || KIND_RU[point.kind], point.hazardStep ?? "—", point.hazardText ?? "—", KIND_RU[point.kind]]),
          true,
        );
      return;
    case "3-1":
    case "3-2":
    case "3-3":
    case "3-4": {
      const block = item.table!;
      const prp = data.prp[block];
      if (prp.rows.length === 0) empty(ctx);
      else table(ctx, prp.heads, prp.rows, true);
      if (item.id === "3-4") text(ctx, MEDICAL_PHRASE, { size: 9, color: MUTED, gap: 3 });
      return;
    }
    case "3-5":
      if (data.staffByPosition.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["Должность", "Сотрудники", "Медосмотр", "Гигиеническая подготовка и аттестация"],
          data.staffByPosition.map((row) => [`${row.title} (${row.names.length})`, row.names.join(", "), "Да", "Да"]),
          true,
        );
      return;
    case "3-6":
      if (bundle.lab.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["Объект", "Что исследуем", "Показатели", "Периодичность", "Лаборатория"],
          bundle.lab.map((row) => [
            LAB_OBJECT_RU[row.object],
            row.subject,
            row.indicator || "—",
            `Раз в ${row.everyMonths} мес.${row.nextDate ? `, следующий — ${ruDate(row.nextDate)}` : ""}`,
            row.laboratory || "—",
          ]),
        );
      if (data.labFiles.length) text(ctx, `Договор, протоколы и акты: ${data.labFiles.join("; ")}.`, { size: 9, color: MUTED, gap: 3 });
      return;
    case "3-7":
      text(ctx, "Должностные лица, на которых возложены обязанности по осуществлению программы производственного контроля", { bold: true, size: 10, gap: 1.5 });
      if (data.officials.length === 0) empty(ctx);
      else table(ctx, ["Ф. И. О.", "Должность", "Обязанности"], data.officials);
      text(ctx, "Лист ознакомления", { bold: true, size: 10, gap: 1.5 });
      acquaintanceSheet(ctx, data);
      return;
    case "app-1":
      if (data.equipment.length === 0) empty(ctx);
      else table(ctx, ["№", "Наименование", "Тип", "Цех / помещение", "Заводской номер", "Режим"], data.equipment, true);
      return;
    case "app-2": {
      const controlled = bundle.points.filter((point) => point.kind === "ccp" || point.kind === "oprp");
      if (controlled.length === 0) empty(ctx);
      else
        table(
          ctx,
          ["№", "Этап", "Опасность", "Критические пределы", "Мониторинг", "Периодичность", "Ответственный", "Корректирующие действия", "Записи"],
          controlled.map((point) => [
            point.number || KIND_RU[point.kind],
            point.hazardStep ?? "—",
            point.hazardText ?? "—",
            point.limits || "—",
            point.monitoring || "—",
            point.frequency || "—",
            point.responsibleName ?? "—",
            point.corrective || "—",
            point.journalName ?? "—",
          ]),
          true,
        );
      return;
    }
    case "app-4":
      if (bundle.journals.length) list(ctx, bundle.journals.map((journal) => journal.name), true);
      else empty(ctx);
      return;
    case "app-5":
    case "app-6": {
      const docs = item.id === "app-5" ? data.procedures : data.instructions;
      if (docs.length === 0) {
        empty(ctx);
        return;
      }
      list(ctx, docs.map((doc) => `${doc.title} — ${doc.revision ?? UNAPPROVED}`), true);
      for (const doc of docs) renderDoc(ctx, null, doc, data.orgName);
      newPage(ctx);
      return;
    }
    default:
      empty(ctx);
  }
}

/** Строки «Содержания»: раздел — жирным, пункт — с отступом. */
type TocLine = { label: string; target: string; bold: boolean; indent: number };

function tocLines(): TocLine[] {
  return PPK_STRUCTURE.flatMap((section) => [
    { label: ppkSectionHeadingRu(section), target: `section:${section.key}`, bold: true, indent: 0 },
    ...section.items.map((item) => ({ label: ppkItemHeadingRu(item), target: item.id, bold: false, indent: section.key === "appendix" ? 0 : 5 })),
  ]);
}

const TOC_LINE = 4.6;
const TOC_NUMBER_W = 14;

function tocLayout(ctx: PCtx) {
  const { doc } = ctx;
  const { w, h } = pageSize(ctx);
  doc.setFontSize(10);
  const rows = tocLines().map((line) => {
    doc.setFont(ctx.font, line.bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(line.label, w - MARGIN * 2 - TOC_NUMBER_W - line.indent) as string[];
    return { ...line, lines, height: lines.length * TOC_LINE + (line.bold ? 3 : 1.5) };
  });
  const usable = h - TOP - MARGIN - 8;
  const pages: (typeof rows)[] = [[]];
  let used = 12; // заголовок «Содержание» на первой странице
  for (const row of rows) {
    if (used + row.height > usable) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(row);
    used += row.height;
  }
  return pages;
}

function fillToc(ctx: PCtx, firstPage: number, pages: ReturnType<typeof tocLayout>) {
  const { doc } = ctx;
  const { w } = pageSize(ctx);
  pages.forEach((rows, index) => {
    doc.setPage(firstPage + index);
    let y = TOP;
    if (index === 0) {
      doc.setFont(ctx.font, "bold");
      doc.setFontSize(13);
      doc.setTextColor(...INK);
      doc.text("Содержание", w / 2, y + 5, { align: "center" });
      y += 12;
    }
    for (const row of rows) {
      const page = ctx.itemPages.get(row.target);
      doc.setFont(ctx.font, row.bold ? "bold" : "normal");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      row.lines.forEach((line, lineIndex) => doc.text(line, MARGIN + row.indent, y + 3.5 + lineIndex * TOC_LINE));
      if (page) {
        const lastY = y + 3.5 + (row.lines.length - 1) * TOC_LINE;
        doc.text(String(page), w - MARGIN, lastY, { align: "right" });
      }
      y += row.height;
    }
  });
}

/** Строка в ширину: не влезает — обрезается с «…». */
function fitText(doc: PCtx["doc"], value: string, width: number): string {
  if (doc.getTextWidth(value) <= width) return value;
  let cut = value;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** «Название · ППК 003 от 24.11.2026»: номер редакции целиком, укорачивается название. */
function fitLabel(doc: PCtx["doc"], label: string, width: number): string {
  const split = label.lastIndexOf(" · ");
  if (split < 0 || doc.getTextWidth(label) <= width) return fitText(doc, label, width);
  const tail = label.slice(split);
  return `${fitText(doc, label.slice(0, split), Math.max(20, width - doc.getTextWidth(tail)))}${tail}`;
}

/** Колонтитул и «Стр. N из M» на всех страницах, кроме титульной. */
function stampPages(ctx: PCtx, orgName: string) {
  const { doc } = ctx;
  const total = doc.getNumberOfPages();
  let label = PROGRAM_LABEL;
  for (let page = 2; page <= total; page += 1) {
    doc.setPage(page);
    label = ctx.labels[page] ?? label;
    const { w, h } = pageSize(ctx);
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const left = fitText(doc, orgName || "—", (w - MARGIN * 2) * 0.38);
    const right = fitLabel(doc, label, (w - MARGIN * 2) * 0.6);
    doc.text(left, MARGIN, 9);
    doc.text(right, w - MARGIN, 9, { align: "right" });
    doc.setDrawColor(200, 203, 220);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, 11, w - MARGIN, 11);
    doc.text(`Стр. ${page} из ${total}`, w / 2, h - 7, { align: "center" });
  }
}

/** Страницы сканов: pdf-lib вписывает страницу файла или картинку в рамку. */
async function embedScans(base: ArrayBuffer, slots: ScanSlot[]): Promise<Uint8Array> {
  const out = await PDFDocument.load(base, { updateMetadata: false });
  const sources = new Map<string, PDFDocument>();
  const images = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const slot of slots) {
    const page = out.getPage(slot.page - 1);
    const pageHeight = page.getHeight();
    const mm = 72 / 25.4;
    const box = { x: slot.box.x * mm, y: pageHeight - (slot.box.y + slot.box.h) * mm, w: slot.box.w * mm, h: slot.box.h * mm };
    try {
      let width: number;
      let height: number;
      let draw: (x: number, y: number, w: number, h: number) => void;
      if (slot.plan.kind === "pdf") {
        let source = sources.get(slot.file.id);
        if (!source) {
          source = await PDFDocument.load(slot.file.bytes, { updateMetadata: false });
          sources.set(slot.file.id, source);
        }
        const sourcePage = source.getPage(slot.pageIndex);
        // Пустая страница без содержимого (бывает в сканах) — рамка остаётся пустой:
        // pdf-lib не умеет вставлять такую страницу и падает уже при сохранении.
        if (!sourcePage.node.Contents()) continue;
        const embedded = await out.embedPage(sourcePage);
        width = embedded.width;
        height = embedded.height;
        draw = (x, y, w, h) => page.drawPage(embedded, { x, y, width: w, height: h });
      } else {
        let image = images.get(slot.file.id);
        if (!image) {
          image = slot.plan.kind === "image" && slot.plan.format === "png" ? await out.embedPng(slot.file.bytes) : await out.embedJpg(slot.file.bytes);
          images.set(slot.file.id, image);
        }
        const embedded = image;
        width = embedded.width;
        height = embedded.height;
        draw = (x, y, w, h) => page.drawImage(embedded, { x, y, width: w, height: h });
      }
      const scale = Math.min(box.w / width, box.h / height);
      const w = width * scale;
      const h = height * scale;
      draw(box.x + (box.w - w) / 2, box.y + (box.h - h), w, h);
    } catch {
      /* рамка остаётся пустой: файл проверен при планировании, сбой здесь маловероятен */
    }
  }
  try {
    return await out.save();
  } catch (error) {
    // Последний рубеж: программа без страниц сканов лучше, чем ошибка вместо программы.
    console.error("[ppk-structure-pdf] scans were not embedded", error);
    return new Uint8Array(base);
  }
}

export type PpkStructureLayout = {
  totalPages: number;
  tocPages: number;
  /** Страница начала пункта (id пункта) и раздела (`section:<key>`). */
  itemPages: Record<string, number>;
  /** Страницы, куда встали страницы сканов. */
  scanPages: number[];
  /** Колонтитул каждой страницы (индекс — номер страницы). */
  labels: string[];
};

/** Печатная ППК по структуре: PDF целиком (A4, книжная; схемы — альбомные листы). */
export async function buildPpkStructurePdf(data: PpkPrintData): Promise<Buffer> {
  return (await buildPpkStructurePdfWithLayout(data)).pdf;
}

/** То же с раскладкой страниц — для проверки содержания и тестов. */
export async function buildPpkStructurePdfWithLayout(data: PpkPrintData): Promise<{ pdf: Buffer; layout: PpkStructureLayout }> {
  const allFiles = [
    ...Object.values(data.docs).flatMap((doc) => doc?.files ?? []),
    ...data.teamOrderScans,
    ...data.procedures.flatMap((doc) => doc.files),
    ...data.instructions.flatMap((doc) => doc.files),
  ];
  const plans = await planPrintFiles(allFiles);
  const base = start(data.bundle, "Программа производственного контроля, основанная на принципах ХАССП", data.bundle.approvals?.ppk ?? null);
  const ctx: PCtx = Object.assign(base, {
    label: "Содержание",
    labels: [] as string[],
    slots: [] as ScanSlot[],
    itemPages: new Map<string, number>(),
    plans,
  });
  ctx.doc.internal.events.subscribe("addPage", () => {
    ctx.labels[ctx.doc.getNumberOfPages()] = ctx.label;
  });

  // Содержание: страницы заранее, номера — после раскладки.
  const tocPages = tocLayout(ctx);
  const tocFirst = 2;
  for (let index = 0; index < tocPages.length; index += 1) ctx.doc.addPage("a4", "portrait");
  ctx.y = pageSize(ctx).h;
  ctx.label = PROGRAM_LABEL;

  for (const section of PPK_STRUCTURE) {
    newPage(ctx);
    ctx.itemPages.set(`section:${section.key}`, ctx.doc.getNumberOfPages());
    if (section.key !== "appendix") text(ctx, ppkSectionHeadingRu(section), { size: 13, bold: true, gap: 4 });
    for (const item of section.items) {
      // Каждое приложение — с новой страницы (отдельный документ).
      if (section.key === "appendix") newPage(ctx);
      renderItem(ctx, item, data);
    }
  }
  // Пустая страница после последнего документа не нужна.
  removeTrailingBlank(ctx);

  fillToc(ctx, tocFirst, tocPages);
  stampPages(ctx, data.orgName);
  const bytes = await embedScans(ctx.doc.output("arraybuffer"), ctx.slots);
  return {
    pdf: Buffer.from(bytes),
    layout: {
      totalPages: ctx.doc.getNumberOfPages(),
      tocPages: tocPages.length,
      itemPages: Object.fromEntries(ctx.itemPages),
      scanPages: ctx.slots.map((slot) => slot.page),
      labels: [...ctx.labels],
    },
  };
}

/** Последняя пустая страница (после документа или приложения) не нужна. */
function removeTrailingBlank(ctx: PCtx) {
  const total = ctx.doc.getNumberOfPages();
  const used = new Set(ctx.slots.map((slot) => slot.page));
  if (total > 2 && ctx.y <= TOP + 0.5 && !used.has(total)) {
    ctx.doc.deletePage(total);
    ctx.labels.length = Math.min(ctx.labels.length, total);
  }
}
