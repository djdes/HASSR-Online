import { buildingWhere } from "@/lib/building-scope";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { journalTitle, presentJournalField, type JournalFieldCopy } from "@/i18n/journal-presentation";
import {
  buildReportTable,
  type ReportField,
  type ReportTable,
} from "@/lib/report-export";

/**
 * Данные выгрузки журнала за период для /reports (PDF и Excel).
 *
 * Документные журналы: документы журнала организации (активные и
 * закрытые), пересекающиеся с периодом, и их записи с `date` в периоде.
 * Легаси `JournalEntry` тоже подхватываем — если такие записи есть.
 * Фильтр «участок» есть только у легаси-записей: у документных записей
 * участка нет, поэтому они выгружаются целиком.
 *
 * Точка (2026-10-31): `pointId` — документы точки и общие, легаси-записи её
 * цехов, общих цехов и без цеха. Без точки при журналах по точкам — у каждой
 * строки колонка «Точка» (документы точек больше не сливаются молча).
 */
export async function loadReportTable(params: {
  templateCode: string;
  organizationId: string;
  dateFrom: string;
  dateTo: string;
  areaId?: string | null;
  locale?: Locale;
  /** Торговая точка из шапки; null — вся организация. */
  pointId?: string | null;
}): Promise<{ templateName: string; timeZone: string; table: ReportTable; emptyMessage: string } | null> {
  const locale = params.locale ?? "ru";
  const messages = await loadMessages(locale);
  const template = await db.journalTemplate.findUnique({
    where: { code: params.templateCode },
    select: { id: true, name: true, fields: true },
  });
  if (!template) return null;

  const organization = await db.organization.findUnique({
    where: { id: params.organizationId },
    select: { timezone: true },
  });
  const timeZone = organization?.timezone || "Europe/Moscow";

  const periodStart = new Date(`${params.dateFrom.slice(0, 10)}T00:00:00.000Z`);
  const periodEnd = new Date(`${params.dateTo.slice(0, 10)}T23:59:59.999Z`);

  const targets = await buildingTargets(params.organizationId);
  const pointsEnabled = targets.some(Boolean);
  const pointId = params.pointId && targets.includes(params.pointId) ? params.pointId : null;
  // Вся организация при журналах по точкам — подписываем строки точкой.
  const labelPoints = pointsEnabled && !pointId;
  const allPoints = messages.reports.allPoints;

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: params.organizationId,
      templateId: template.id,
      dateFrom: { lte: periodEnd },
      dateTo: { gte: periodStart },
      ...buildingWhere(pointId),
    },
    select: { id: true, building: { select: { name: true } } },
  });
  const pointOfDocument = new Map(documents.map((doc) => [doc.id, doc.building?.name ?? allPoints]));

  const [documentEntries, legacyEntries] = await Promise.all([
    documents.length === 0
      ? Promise.resolve([])
      : db.journalDocumentEntry.findMany({
          where: {
            documentId: { in: documents.map((doc) => doc.id) },
            date: { gte: periodStart, lte: periodEnd },
            ...NOT_AUTO_SEEDED,
          },
          select: {
            documentId: true,
            date: true,
            data: true,
            employee: { select: { name: true } },
          },
          orderBy: { date: "asc" },
        }),
    db.journalEntry.findMany({
      where: {
        templateId: template.id,
        organizationId: params.organizationId,
        createdAt: { gte: periodStart, lte: periodEnd },
        ...(params.areaId ? { areaId: params.areaId } : {}),
        // Точка: записи её цехов, общих цехов и без цеха.
        ...(pointId ? { OR: [{ areaId: null }, { area: { buildingId: pointId } }, { area: { buildingId: null } }] } : {}),
      },
      select: {
        createdAt: true,
        data: true,
        filledBy: { select: { name: true } },
        area: { select: { name: true, building: { select: { name: true } } } },
        equipment: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const fields = Array.isArray(template.fields)
    ? (template.fields as unknown as ReportField[])
    : [];
  const fieldCopy = messages.journalFields as Record<string, Record<string, JournalFieldCopy>>;
  const displayFields = fields.map((field) => {
    const presented = presentJournalField({ ...field, label: field.label ?? field.key },
      locale === "ru" ? undefined : fieldCopy[params.templateCode]?.[field.key]);
    return { ...field, label: presented.displayLabel, options: presented.displayOptions };
  });

  const table = buildReportTable({
    fields: displayFields,
    timeZone,
    locale,
    copy: { ...messages.reports, yes: messages.common.yes, no: messages.common.no },
    documentEntries: documentEntries.map((entry) => ({
      date: entry.date,
      employeeName: entry.employee?.name ?? null,
      data: entry.data,
      ...(labelPoints ? { pointName: pointOfDocument.get(entry.documentId) ?? allPoints } : {}),
    })),
    legacyEntries: legacyEntries.map((entry) => ({
      createdAt: entry.createdAt,
      filledByName: entry.filledBy?.name ?? null,
      areaName: entry.area?.name ?? null,
      equipmentName: entry.equipment?.name ?? null,
      data: entry.data,
      ...(labelPoints ? { pointName: entry.area?.building?.name ?? allPoints } : {}),
    })),
  });

  return {
    templateName: journalTitle(locale, messages.journals.names, params.templateCode, template.name),
    timeZone, table, emptyMessage: messages.reports.empty,
  };
}
