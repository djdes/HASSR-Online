import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { db } from "@/lib/db";
import { hashInspectorToken } from "@/lib/inspector-tokens";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { buildingPrintName } from "@/lib/building-scope";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click PDF за весь период токена. Для инспектора: открыл портал →
 * нажал «Скачать PDF» — получил один документ с титулкой, оглавлением и
 * сводкой по каждому шаблону журнала: список документов + количество
 * записей + табличка legacy-entries.
 *
 * Это summary-PDF, не полная распечатка каждой ячейки (для этого есть
 * существующий /api/journal-documents/[id]/pdf на конкретный документ).
 * Цель — дать инспектору общую картину «вели или не вели» с возможностью
 * углубиться в нужный журнал по веб-ссылке портала.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const tokenHash = hashInspectorToken(token);
  const record = await db.inspectorToken.findUnique({
    where: { tokenHash },
    include: {
      organization: {
        select: { id: true, name: true, journalShortName: true, legalProfileJson: true },
      },
    },
  });
  if (!record) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (record.revokedAt || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "Token expired/revoked" }, { status: 403 });
  }

  const periodFrom = record.periodFrom;
  const periodToInclusive = new Date(record.periodTo);
  periodToInclusive.setUTCHours(23, 59, 59, 999);

  // Раньше PDF включал все active templates: org, отключившая
  // в /settings/journals скажем «температурный режим», получала в
  // PDF секцию «Темп. режим — нет документов» — выглядит как
  // нарушение для инспектора. Теперь скрываем отключённые.
  const disabledCodes = await getDisabledJournalCodes(record.organizationId);

  const [templatesAll, documents, legacyEntries] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true, isMandatorySanpin: true, isMandatoryHaccp: true },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId: record.organizationId,
        OR: [
          { dateFrom: { gte: periodFrom, lte: periodToInclusive } },
          { dateTo: { gte: periodFrom, lte: periodToInclusive } },
          { AND: [{ dateFrom: { lte: periodFrom } }, { dateTo: { gte: periodToInclusive } }] },
        ],
      },
      select: {
        id: true,
        title: true,
        templateId: true,
        dateFrom: true,
        dateTo: true,
        status: true,
        building: { select: { name: true, journalName: true } },
        // Считаем только реально заполненные строки. _autoSeeded —
        // это пустые матриксы (employee × day) которые bulk-assign и
        // sync-* проставляют для рендера UI. Они НЕ являются
        // заполнением — инспектор не должен видеть «5000 записей»
        // когда сотрудник реально заполнил 50.
        _count: { select: { entries: { where: NOT_AUTO_SEEDED } } },
      },
    }),
    db.journalEntry.findMany({
      where: {
        organizationId: record.organizationId,
        createdAt: { gte: periodFrom, lte: periodToInclusive },
      },
      select: { templateId: true },
    }),
  ]);

  const templates = templatesAll.filter((t) => !disabledCodes.has(t.code));

  const docsByTemplate = new Map<string, typeof documents>();
  for (const d of documents) {
    const list = docsByTemplate.get(d.templateId) ?? [];
    list.push(d);
    docsByTemplate.set(d.templateId, list);
  }
  const legacyByTemplate = new Map<string, number>();
  for (const e of legacyEntries) {
    legacyByTemplate.set(e.templateId, (legacyByTemplate.get(e.templateId) ?? 0) + 1);
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fmt = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });

  // Title page
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(resolveOrgJournalName(record.organization), 20, 30);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Сводка журналов за период: ${fmt(periodFrom)} — ${fmt(record.periodTo)}`,
    20,
    40
  );
  doc.text(
    `Сформировано: ${new Date().toLocaleString("ru-RU")}`,
    20,
    47
  );
  if (record.label) {
    doc.text(`Назначение: ${record.label}`, 20, 54);
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    "Документ сформирован системой WeSetup для портала инспектора. Подтверждает наличие журналов и количество записей за указанный период.",
    20,
    270,
    { maxWidth: 170 }
  );
  doc.setTextColor(0);

  // Summary table
  doc.addPage();
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Сводка по журналам", 20, 20);

  const rows: Array<[string, string, string, string]> = templates.map((tpl) => {
    const docs = docsByTemplate.get(tpl.id) ?? [];
    const legacy = legacyByTemplate.get(tpl.id) ?? 0;
    const totalEntries = docs.reduce((s, d) => s + d._count.entries, 0) + legacy;
    const tags = [
      tpl.isMandatorySanpin ? "СанПиН" : null,
      tpl.isMandatoryHaccp ? "ХАССП" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return [
      tpl.name,
      tags || "—",
      String(docs.length),
      String(totalEntries),
    ];
  });

  autoTable(doc, {
    startY: 28,
    head: [["Журнал", "Обязательность", "Документов", "Записей"]],
    body: rows,
    headStyles: { fillColor: [85, 102, 246], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 35 },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 25, halign: "right" },
    },
  });

  // Per-template documents detail
  for (const tpl of templates) {
    const docs = docsByTemplate.get(tpl.id);
    if (!docs || docs.length === 0) continue;
    doc.addPage();
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(tpl.name, 20, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: 28,
      head: [["Документ", "Период", "Статус", "Записей"]],
      body: docs.map((d) => [
        [d.title, buildingPrintName(d.building)].filter(Boolean).join(" · "),
        `${fmt(d.dateFrom)} — ${fmt(d.dateTo)}`,
        d.status === "active" ? "Активен" : "Закрыт",
        String(d._count.entries),
      ]),
      headStyles: { fillColor: [85, 102, 246], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 2 },
    });
  }

  const buffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `wesetup-inspector-${record.organization.name.replace(/[^A-Za-zА-Яа-я0-9]+/g, "_")}-${periodFrom.toISOString().slice(0, 10)}.pdf`;

  // Bump access counter (download = considered access).
  await db.inspectorToken
    .update({
      where: { id: record.id },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    })
    .catch(() => null);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
