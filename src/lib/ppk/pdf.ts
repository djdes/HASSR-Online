/**
 * PDF собранных документов раздела «Производственный контроль»: Программа
 * производственного контроля и План ХАССП. Состав разделов повторяет страницы
 * `production-control/program` и `production-control/haccp-plan`.
 * Блок-схемы рисуются линиями jsPDF на отдельных альбомных страницах.
 */
import { jsPDF } from "jspdf";
import autoTable, { type CellInput } from "jspdf-autotable";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import { FLOW_STYLES, diagramBounds, edgeAnchors } from "./diagram";
import { hazardRisk, isSignificantHazard } from "./haccp";
import { EMERGENCIES, MEDICAL_PHRASE } from "./program-content";
import type { DiagramData } from "./records";
import type { BundleApproval, PpkBundle } from "./assemble.server";

const ROLE_PROGRAM = {
  leader: "Руководитель группы ХАССП",
  deputy: "Заместитель руководителя группы ХАССП",
  member: "Член группы ХАССП",
  secretary: "Секретарь группы ХАССП",
} as const;
const ROLE_PLAN = {
  leader: "Руководитель",
  deputy: "Заместитель руководителя",
  member: "Член группы",
  secretary: "Секретарь",
} as const;
const PEST_KIND_RU = { disinsection: "Дезинсекция", deratization: "Дератизация", disinfection: "Дезинфекция" } as const;
const LAB_OBJECT_RU = { product: "Продукция", swabs: "Смывы", water: "Вода", air: "Воздух", other: "Другое" } as const;
const HAZARD_TYPE_RU = { bio: "Биологическая", chem: "Химическая", phys: "Физическая", allergen: "Аллерген" } as const;
const KIND_RU = { ccp: "ККТ", oprp: "ОПП", prp: "ПРП", none: "—" } as const;
/** Лист ознакомления: строк не больше этого числа (как на странице). */
const ACQUAINTANCE_MAX = 30;

const MARGIN = 15;
type Rgb = [number, number, number];
const INK: Rgb = [11, 16, 36];
const MUTED: Rgb = [111, 114, 130];

function ruDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

/** Контекст построения: документ, шрифт и текущая вертикальная позиция. */
type Ctx = { doc: jsPDF; font: string; y: number };

function pageSize(ctx: Ctx) {
  return { w: ctx.doc.internal.pageSize.getWidth(), h: ctx.doc.internal.pageSize.getHeight() };
}

function ensureSpace(ctx: Ctx, height: number) {
  if (ctx.y + height > pageSize(ctx).h - MARGIN - 6) {
    ctx.doc.addPage();
    ctx.y = MARGIN;
  }
}

function text(ctx: Ctx, value: string, opts: { size?: number; bold?: boolean; color?: Rgb; gap?: number } = {}) {
  const { doc } = ctx;
  const size = opts.size ?? 10;
  doc.setFont(ctx.font, opts.bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(...(opts.color ?? INK));
  const lines = doc.splitTextToSize(value, pageSize(ctx).w - MARGIN * 2) as string[];
  const lineHeight = size * 0.4;
  for (const line of lines) {
    ensureSpace(ctx, lineHeight);
    doc.text(line, MARGIN, ctx.y + size * 0.3);
    ctx.y += lineHeight;
  }
  ctx.y += opts.gap ?? 1.5;
}

function section(ctx: Ctx, title: string) {
  ensureSpace(ctx, 20);
  ctx.y += 3;
  text(ctx, title, { size: 12, bold: true, gap: 2 });
}

function empty(ctx: Ctx) {
  text(ctx, "Не заполнено", { color: MUTED, gap: 3 });
}

function table(ctx: Ctx, heads: string[], rows: CellInput[][], small = false) {
  autoTable(ctx.doc, {
    startY: ctx.y,
    head: [heads],
    body: rows,
    theme: "grid",
    margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 6 },
    styles: { font: ctx.font, fontSize: small ? 8 : 9, cellPadding: 1.6, textColor: INK, lineColor: [200, 203, 220], lineWidth: 0.2 },
    headStyles: { font: ctx.font, fontStyle: "bold", fillColor: [238, 240, 255], textColor: INK },
  });
  const last = (ctx.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  ctx.y = (last?.finalY ?? ctx.y) + 4;
}

function list(ctx: Ctx, items: string[], numbered: boolean) {
  items.forEach((item, index) => text(ctx, `${numbered ? `${index + 1}.` : "•"} ${item}`, { gap: 0.8 }));
  ctx.y += 1.5;
}

function start(bundle: PpkBundle, title: string, approval: BundleApproval | null): Ctx {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const ctx: Ctx = { doc, font: registerJournalUnicodeFont(doc), y: MARGIN };
  const { org } = bundle;
  text(ctx, org.orgName || "—", { size: 11, bold: true, gap: 0.5 });
  const requisites = [org.orgInn ? `ИНН ${org.orgInn}` : null, org.orgAddress].filter(Boolean).join(", ");
  if (requisites) text(ctx, requisites, { size: 9, color: MUTED, gap: 3 });

  approveBlock(ctx, bundle, approval);

  doc.setFont(ctx.font, "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(title, pageSize(ctx).w / 2, ctx.y + 5, { align: "center" });
  ctx.y += 9;
  const subtitle = approval ? `Версия ${approval.version} от ${ruDate(approval.approvedAt)}` : org.orgName;
  if (subtitle) {
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(subtitle, pageSize(ctx).w / 2, ctx.y + 3, { align: "center" });
  }
  ctx.y += 8;
  return ctx;
}

/** «УТВЕРЖДАЮ»: утвердивший последней версии, иначе руководитель из реквизитов. */
function approveBlock(ctx: Ctx, bundle: PpkBundle, approval: BundleApproval | null) {
  const { doc } = ctx;
  const approver = approval?.approver ?? null;
  const director = bundle.org.snapshot;
  const x = pageSize(ctx).w - MARGIN - 62;
  const lines = [
    approver ? approver.title || "Руководитель" : director?.directorPost || "Руководитель",
    approver ? approver.name : director?.directorName || "—",
  ];
  doc.setFont(ctx.font, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text("УТВЕРЖДАЮ", x, ctx.y + 3);
  doc.setFont(ctx.font, "normal");
  let y = ctx.y + 8;
  for (const raw of lines) {
    for (const line of doc.splitTextToSize(raw, 62) as string[]) {
      doc.text(line, x, y);
      y += 4.2;
    }
  }
  y += 5;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.2);
  doc.line(x, y, x + 30, y);
  doc.text("/", x + 32, y);
  doc.line(x + 35, y, x + 58, y);
  y += 5;
  doc.text(approver && approval ? `${ruDate(approval.approvedAt)} г.` : "«____» ______________ 20___ г.", x, y);
  ctx.y = y + 8;
}

/** Номера страниц внизу каждой страницы. */
function pageNumbers(ctx: Ctx) {
  const { doc } = ctx;
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    const { w, h } = pageSize(ctx);
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Страница ${page} из ${total}`, w / 2, h - 8, { align: "center" });
  }
}

function finish(ctx: Ctx): Buffer {
  pageNumbers(ctx);
  return Buffer.from(ctx.doc.output("arraybuffer"));
}

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** Блок-схема на отдельной альбомной странице; масштаб по `diagramBounds`. */
function drawFlowchart(ctx: Ctx, chart: DiagramData) {
  const { doc } = ctx;
  doc.addPage("a4", "landscape");
  const { w, h } = pageSize(ctx);
  let top = MARGIN;
  doc.setFont(ctx.font, "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(chart.title || "Блок-схема", MARGIN, top + 4);
  top += 9;

  const box = diagramBounds(chart);
  const scale = Math.min((w - MARGIN * 2) / box.w, (h - top - MARGIN - 6) / box.h);
  const ox = MARGIN + (w - MARGIN * 2 - box.w * scale) / 2;
  const px = (x: number) => ox + (x - box.x) * scale;
  const py = (y: number) => top + (y - box.y) * scale;
  const byId = new Map(chart.nodes.map((node) => [node.id, node]));

  // Связи: стрелки линиями со стилем потока.
  for (const edge of chart.edges) {
    const a = edge.from ? byId.get(edge.from) : undefined;
    const b = edge.to ? byId.get(edge.to) : undefined;
    const points = a && b ? edgeAnchors(a, b) : edge.points;
    if (points.length < 2) continue;
    const style = edge.flow ? FLOW_STYLES[edge.flow] : null;
    const color = hexToRgb(style?.color ?? "#6f7282");
    doc.setDrawColor(...color);
    doc.setFillColor(...color);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern(style?.dash ? [2, 1.5] : [], 0);
    for (let i = 1; i < points.length; i += 1) {
      doc.line(px(points[i - 1].x), py(points[i - 1].y), px(points[i].x), py(points[i].y));
    }
    doc.setLineDashPattern([], 0);
    // Наконечник стрелки на последнем отрезке.
    const p = points[points.length - 2];
    const q = points[points.length - 1];
    const angle = Math.atan2(py(q.y) - py(p.y), px(q.x) - px(p.x));
    const tipX = px(q.x);
    const tipY = py(q.y);
    const size = 2.2;
    doc.triangle(
      tipX, tipY,
      tipX - size * Math.cos(angle - 0.4), tipY - size * Math.sin(angle - 0.4),
      tipX - size * Math.cos(angle + 0.4), tipY - size * Math.sin(angle + 0.4),
      "F",
    );
    if (edge.label) {
      doc.setFont(ctx.font, "normal");
      doc.setFontSize(7);
      doc.setTextColor(60, 64, 83);
      doc.text(edge.label, (px(points[0].x) + tipX) / 2 + 1, (py(points[0].y) + tipY) / 2 - 1);
    }
  }

  // Этапы: прямоугольники с подписью и плашкой «ККТ-N».
  for (const node of chart.nodes) {
    const x = px(node.x);
    const y = py(node.y);
    const nw = node.w * scale;
    const nh = node.h * scale;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...(node.kind === "room" ? ([60, 64, 83] as Rgb) : ([85, 102, 246] as Rgb)));
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, nw, nh, 1.5, 1.5, "FD");
    const fontSize = Math.max(6, Math.min(10, nh * 0.45));
    const step = fontSize * 0.42;
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...INK);
    const lines = (doc.splitTextToSize(node.label, Math.max(4, nw - 3)) as string[]).slice(0, Math.max(1, Math.floor(nh / step)));
    const block = lines.length * step;
    lines.forEach((line, i) => {
      doc.text(line, x + nw / 2, y + (nh - block) / 2 + fontSize * 0.34 + i * step, { align: "center" });
    });
    if (node.ccp) {
      doc.setFont(ctx.font, "bold");
      doc.setFontSize(7);
      const bw = doc.getTextWidth(node.ccp) + 3;
      doc.setFillColor(209, 69, 59);
      doc.roundedRect(x + nw - bw + 1, y - 2.2, bw, 4.4, 1, 1, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(node.ccp, x + nw - bw / 2 + 1, y + 0.9, { align: "center" });
    }
  }
}

/** Программа производственного контроля (A4 книжная). */
export function buildPpkProgramPdf(bundle: PpkBundle): Buffer {
  const approval = bundle.approvals?.ppk ?? null;
  const ctx = start(bundle, "Программа производственного контроля", approval);
  const requisites = bundle.org.snapshot;
  const leader = bundle.team.find((member) => member.role === "leader");

  section(ctx, "1. Общие сведения");
  table(ctx, ["Показатель", "Значение"], [
    ["Полное наименование", requisites?.orgName || bundle.org.orgName || "—"],
    ["Краткое наименование", requisites?.orgShortName || "—"],
    ["ИНН", bundle.org.orgInn || "—"],
    ["Адрес", bundle.org.orgAddress || "—"],
    ["Руководитель", requisites?.directorName ? `${requisites.directorPost || "Руководитель"}, ${requisites.directorName}` : "—"],
    ["Ответственный за производственный контроль", leader ? `${leader.name}${leader.title ? `, ${leader.title}` : ""}` : "—"],
  ]);

  section(ctx, "2. Перечень официально изданных санитарных правил и нормативных документов");
  if (bundle.norms.length) list(ctx, bundle.norms, true);
  else empty(ctx);

  section(ctx, "3. Должностные лица, на которых возложены функции производственного контроля");
  if (bundle.team.length || bundle.responsibles.length) {
    table(ctx, ["Ф. И. О.", "Должность", "Функция"], [
      ...bundle.team.map((m) => [m.name, m.title || "—", `${ROLE_PROGRAM[m.role]}${m.duties ? `. ${m.duties}` : ""}`]),
      ...bundle.responsibles.map((p) => [p.name, p.title || "—", `Ответственный за журналы: ${p.journals.join(", ")}`]),
    ]);
  } else empty(ctx);

  section(ctx, "4. Лабораторный контроль");
  if (bundle.lab.length) {
    table(ctx, ["Объект", "Что исследуем", "Показатели", "Периодичность", "Лаборатория"], bundle.lab.map((item) => [
      LAB_OBJECT_RU[item.object],
      item.subject,
      item.indicator || "—",
      `Раз в ${item.everyMonths} мес.${item.nextDate ? `, следующий — ${ruDate(item.nextDate)}` : ""}`,
      item.laboratory || "—",
    ]));
  } else empty(ctx);

  section(ctx, "5. Перечень должностей, работники которых проходят медицинские осмотры и гигиеническую подготовку");
  if (bundle.positions.length) {
    list(ctx, bundle.positions, false);
    text(ctx, MEDICAL_PHRASE, { gap: 3 });
  } else empty(ctx);

  section(ctx, "6. Мероприятия по дезинсекции и дератизации");
  if (bundle.pest.length) {
    table(ctx, ["Вид", "Объект", "Периодичность", "Исполнитель", "Последняя", "Следующая"], bundle.pest.map((item) => [
      PEST_KIND_RU[item.kind],
      item.object,
      item.frequency || "—",
      item.contractor || "—",
      ruDate(item.lastDate),
      ruDate(item.nextDate),
    ]));
  } else empty(ctx);

  section(ctx, "7. Формы учёта и отчётности");
  if (bundle.journals.length) list(ctx, bundle.journals.map((journal) => journal.name), true);
  else empty(ctx);

  section(ctx, "8. Перечень возможных аварийных ситуаций и действий персонала");
  EMERGENCIES.forEach((item, index) => text(ctx, `${index + 1}. ${item.title}. ${item.actions}`, { gap: 1.5 }));

  section(ctx, "9. Лист ознакомления");
  const people = (bundle.roster ?? []).slice(0, ACQUAINTANCE_MAX);
  table(
    ctx,
    ["Ф. И. О.", "Должность", "Дата", "Подпись"],
    people.length ? people.map((person) => [person.name, person.title, "", ""]) : [["", "", "", ""]],
  );

  return finish(ctx);
}

/** План ХАССП (A4 книжная, блок-схемы — на альбомных страницах). */
export function buildHaccpPlanPdf(bundle: PpkBundle): Buffer {
  const approval = bundle.approvals?.["haccp-plan"] ?? null;
  const ctx = start(bundle, "План ХАССП", approval);
  const controlPoints = bundle.points.filter((point) => point.kind === "ccp" || point.kind === "oprp");

  section(ctx, "1. Группа ХАССП");
  if (bundle.team.length) {
    table(ctx, ["Ф. И. О.", "Должность", "Роль в группе", "Обязанности"], bundle.team.map((m) => [
      m.name, m.title || "—", ROLE_PLAN[m.role], m.duties || "—",
    ]));
  } else empty(ctx);

  section(ctx, "2. Политика в области качества и безопасности");
  if (bundle.policy) {
    for (const paragraph of bundle.policy.text.split(/\n{2,}/)) text(ctx, paragraph, { gap: 1.5 });
    text(
      ctx,
      bundle.policy.approvedByName
        ? `Утвердил: ${bundle.policy.approvedByName}${bundle.policy.approvedAt ? `, ${ruDate(bundle.policy.approvedAt)}` : ""}`
        : "Утверждение: ______________________",
      { size: 9, gap: 3 },
    );
  } else empty(ctx);

  section(ctx, "3. Описание продукции");
  if (bundle.products.length) {
    for (const product of bundle.products) {
      ensureSpace(ctx, 30);
      text(ctx, product.name, { bold: true, gap: 1 });
      table(ctx, ["Показатель", "Значение"], [
        ["Состав", product.composition || "—"],
        ["Условия хранения", product.storage || "—"],
        ["Срок годности", product.shelfLife || "—"],
        ["Назначение и использование", product.usage || "—"],
        ["Упаковка", product.packaging || "—"],
        ...product.indicators.map((item) => [`Показатель: ${item.name}`, item.norm || "—"]),
      ]);
    }
  } else empty(ctx);

  section(ctx, "4. Блок-схемы");
  if (bundle.flowcharts.length === 0) empty(ctx);
  else {
    text(ctx, "Блок-схемы приведены на следующих страницах.", { color: MUTED, gap: 2 });
    for (const chart of bundle.flowcharts) drawFlowchart(ctx, chart);
    ctx.doc.addPage("a4", "portrait");
    ctx.y = MARGIN;
  }

  section(ctx, "5. Анализ опасностей");
  if (bundle.hazards.length) {
    table(
      ctx,
      ["Этап", "Опасность", "Вид", "Вероятность", "Тяжесть", "Риск", "Значимая", "Меры управления"],
      bundle.hazards.map((h) => [
        h.step,
        h.hazard,
        HAZARD_TYPE_RU[h.type],
        String(h.probability),
        String(h.severity),
        String(hazardRisk(h.probability, h.severity)),
        isSignificantHazard(h.probability, h.severity) ? "Да" : "Нет",
        h.measures || "—",
      ]),
      true,
    );
  } else empty(ctx);

  section(ctx, "6. Критические контрольные точки и операционные программы");
  if (controlPoints.length) {
    table(
      ctx,
      ["№", "Этап", "Опасность", "Критические пределы", "Мониторинг", "Периодичность", "Ответственный", "Корректирующие действия", "Записи"],
      controlPoints.map((p) => [
        p.number || KIND_RU[p.kind],
        p.hazardStep ?? "—",
        p.hazardText ?? "—",
        p.limits || "—",
        p.monitoring || "—",
        p.frequency || "—",
        p.responsibleName ?? "—",
        p.corrective || "—",
        p.journalName ?? "—",
      ]),
      true,
    );
  } else empty(ctx);

  section(ctx, "7. Верификация");
  text(
    ctx,
    "Верификация системы ХАССП проводится не реже раза в год и при любых изменениях продукции или процессов: группа ХАССП организует внутренний аудит, результаты фиксируются в журналах внутреннего аудита (план, протокол и отчёт аудита), а выявленные несоответствия устраняются корректирующими действиями.",
  );

  return finish(ctx);
}
