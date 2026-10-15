import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import ruMessages from "@/i18n/messages/ru.json";
import { journalTitle } from "@/i18n/journal-presentation";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { customJournalName } from "@/lib/custom-names";
import { presentTaskFillField } from "@/lib/task-fill-schema-presentation";

import { db } from "@/lib/db";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";

/**
 * Архив всех журналов организации за период: по каждому документу PDF (та же
 * печатная форма, что в кабинете) и XLSX с записями; полевые журналы — XLSX по
 * шаблону. Ограничение по числу документов — чтобы выгрузка укладывалась в
 * один запрос.
 */
export const ARCHIVE_MAX_DOCUMENTS = 200;

function safeName(value: string, fallback: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}

function cellValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

type ArchiveMessages = Awaited<ReturnType<typeof loadMessages>>;
type ArchiveTranslator = ReturnType<typeof createTranslator<ArchiveMessages, "archiveExport">>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Only headers are presented. Raw backup cells never pass through translators. */
function fieldLabel(key: string, code: string, fields: unknown, config: unknown, locale: Locale, messages: ArchiveMessages): string {
  const columns = record(record(config).columns);
  const customLabel = record(columns.labels)[key];
  if (typeof customLabel === "string" && customLabel) return customLabel;
  const custom = Array.isArray(columns.custom) ? columns.custom.map(record).find(field => field.key === key) : undefined;
  if (typeof custom?.label === "string") return custom.label;
  const definition = Array.isArray(fields) ? fields.map(record).find(field => field.key === key) : undefined;
  const sourceLabel = typeof definition?.label === "string" ? definition.label : undefined;
  const canonicalJournalField = record(record(ruMessages.journalFields)[code])[key];
  const localizedJournalField = record(record(messages.journalFields)[code])[key];
  const canonicalLabel = record(canonicalJournalField).label;
  const localizedLabel = record(localizedJournalField).label;
  if ((!sourceLabel || sourceLabel === canonicalLabel) && typeof localizedLabel === "string") return localizedLabel;
  return presentTaskFillField({ key, type: "text", label: sourceLabel ?? key, presentationSource: sourceLabel ? "template" : "adapter" }, code, locale, messages).label;
}

async function entriesSheet(workbook: ExcelJS.Workbook, title: string, rows: Array<{ date: Date; who: string; data: unknown }>, context: { code: string; fields: unknown; config?: unknown; locale: Locale; messages: ArchiveMessages; t: ArchiveTranslator }): Promise<void> {
  const { t } = context;
  const sheetName = safeName(title, t("files.records")).replace(/[\[\]]/g, " ").replace(/^'+|'+$/g, "").slice(0, 31) || t("files.records");
  const sheet = workbook.addWorksheet(sheetName);
  const keys = new Set<string>();
  for (const r of rows) if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) for (const k of Object.keys(r.data as object)) keys.add(k);
  const labels = [...keys].map(key => fieldLabel(key, context.code, context.fields, context.config, context.locale, context.messages));
  const columns = [t("files.date"), t("files.who"), ...labels];
  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    const data = (r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : {}) as Record<string, unknown>;
    sheet.addRow([r.date.toISOString().slice(0, 10), r.who, ...[...keys].map((k) => cellValue(data[k]))]);
  }
  sheet.columns.forEach((c) => {
    c.width = 18;
  });
  const keySheetName = t("files.fieldKeysSheet");
  const keySheet = workbook.addWorksheet(sheetName.toLowerCase() === keySheetName.toLowerCase() ? `${keySheetName} 2` : keySheetName);
  keySheet.addRow([t("files.fieldKey"), t("files.fieldLabel")]);
  [...keys].forEach((key, index) => keySheet.addRow([key, labels[index]]));
  keySheet.getRow(1).font = { bold: true };
  keySheet.columns.forEach(column => { column.width = 28; });
}

export async function buildJournalsArchive(organizationId: string, from: Date, to: Date, locale: Locale = "ru"): Promise<{ zip: Buffer; documents: number; fieldJournals: number; truncated: boolean }> {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "archiveExport" });
  const customNames = await getOrgCustomNames(organizationId);
  const titleFor = (code: string, original: string) => {
    const custom = customJournalName(customNames, code);
    // Unknown or edited template names are customer data too.
    const canonical = ruMessages.journals.names[code as keyof typeof ruMessages.journals.names];
    return custom ?? (original === canonical ? journalTitle(locale, messages.journals.names, code, original) : original);
  };
  const zip = new JSZip();
  const documents = await db.journalDocument.findMany({
    where: { organizationId, dateFrom: { lte: to }, dateTo: { gte: from } },
    orderBy: [{ dateFrom: "asc" }],
    take: ARCHIVE_MAX_DOCUMENTS + 1,
    select: { id: true, title: true, config: true, dateFrom: true, dateTo: true, template: { select: { code: true, name: true, fields: true } } },
  });
  const truncated = documents.length > ARCHIVE_MAX_DOCUMENTS;
  const docs = documents.slice(0, ARCHIVE_MAX_DOCUMENTS);
  const docsFolder = zip.folder(t("files.documents"))!;
  const documentNames = new Set<string>();
  for (const doc of docs) {
    const proposed = `${doc.dateFrom.toISOString().slice(0, 10)} ${safeName(doc.title || titleFor(doc.template.code, doc.template.name), t("files.fallbackJournal"))}`;
    let base = proposed;
    let duplicate = 2;
    while (documentNames.has(base)) base = `${proposed} (${duplicate++})`;
    documentNames.add(base);
    try {
      const pdf = await generateJournalDocumentPdf({ documentId: doc.id, organizationId, locale });
      docsFolder.file(`${base}.pdf`, pdf.buffer);
    } catch {
      docsFolder.file(`${base} — ${t("files.pdfFailedSuffix")}.txt`, t("files.pdfFailed"));
    }
    const entries = await db.journalDocumentEntry.findMany({
      where: { documentId: doc.id, document: { organizationId } },
      orderBy: { date: "asc" },
      select: { date: true, data: true, employee: { select: { name: true } } },
    });
    if (entries.length > 0) {
      const workbook = new ExcelJS.Workbook();
      await entriesSheet(workbook, titleFor(doc.template.code, doc.template.name), entries.map((e) => ({ date: e.date, who: e.employee.name, data: e.data })), { code: doc.template.code, fields: doc.template.fields, config: doc.config, locale, messages, t });
      docsFolder.file(`${base}.xlsx`, Buffer.from(await workbook.xlsx.writeBuffer()));
    }
  }

  const fieldEntries = await db.journalEntry.findMany({
    where: { organizationId, createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, data: true, templateId: true, filledById: true },
  });
  const templateIds = Array.from(new Set(fieldEntries.map((e) => e.templateId)));
  const userIds = Array.from(new Set(fieldEntries.map((e) => e.filledById)));
  const [templates, users] = await Promise.all([
    templateIds.length ? db.journalTemplate.findMany({ where: { id: { in: templateIds } }, select: { id: true, code: true, name: true, fields: true } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, name: true } }) : [],
  ]);
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const byTemplate = new Map<string, { name: string; fields: unknown; rows: Array<{ date: Date; who: string; data: unknown }> }>();
  for (const e of fieldEntries) {
    const template = templateById.get(e.templateId);
    const key = template?.code ?? e.templateId;
    const bucket = byTemplate.get(key) ?? { name: template ? titleFor(template.code, template.name) : key, fields: template?.fields, rows: [] };
    bucket.rows.push({ date: e.createdAt, who: userName.get(e.filledById) ?? "", data: e.data });
    byTemplate.set(key, bucket);
  }
  const fieldFolder = zip.folder(t("files.journals"))!;
  for (const [code, bucket] of byTemplate) {
    const workbook = new ExcelJS.Workbook();
    await entriesSheet(workbook, bucket.name, bucket.rows, { code, fields: bucket.fields, locale, messages, t });
    fieldFolder.file(`${safeName(bucket.name, t("files.fallbackJournal"))} (${safeName(code, t("files.fallbackJournal"))}).xlsx`, Buffer.from(await workbook.xlsx.writeBuffer()));
  }
  zip.file(
    t("files.readme"),
    [
      t("readme.period", { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }),
      t("readme.counts", { documents: docs.length, journals: byTemplate.size }),
      truncated ? t("readme.truncated", { max: ARCHIVE_MAX_DOCUMENTS }) : "",
      t("readme.folders", { documents: t("files.documents"), journals: t("files.journals") }),
      t("readme.values"),
    ].filter(Boolean).join("\n")
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { zip: buffer, documents: docs.length, fieldJournals: byTemplate.size, truncated };
}
