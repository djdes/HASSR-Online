import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
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
 */
export async function loadReportTable(params: {
  templateCode: string;
  organizationId: string;
  dateFrom: string;
  dateTo: string;
  areaId?: string | null;
}): Promise<{ templateName: string; timeZone: string; table: ReportTable } | null> {
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

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: params.organizationId,
      templateId: template.id,
      dateFrom: { lte: periodEnd },
      dateTo: { gte: periodStart },
    },
    select: { id: true },
  });

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
      },
      select: {
        createdAt: true,
        data: true,
        filledBy: { select: { name: true } },
        area: { select: { name: true } },
        equipment: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const fields = Array.isArray(template.fields)
    ? (template.fields as unknown as ReportField[])
    : [];

  const table = buildReportTable({
    fields,
    timeZone,
    documentEntries: documentEntries.map((entry) => ({
      date: entry.date,
      employeeName: entry.employee?.name ?? null,
      data: entry.data,
    })),
    legacyEntries: legacyEntries.map((entry) => ({
      createdAt: entry.createdAt,
      filledByName: entry.filledBy?.name ?? null,
      areaName: entry.area?.name ?? null,
      equipmentName: entry.equipment?.name ?? null,
      data: entry.data,
    })),
  });

  return { templateName: template.name, timeZone, table };
}
