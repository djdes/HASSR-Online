import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { BLANK_CONSENT_SOURCE, BLANK_DOWNLOAD_AUDIT_ACTION } from "@/lib/blank-download";
import { CRM_CURSOR_OVERLAP_MS, CRM_SOURCES_BACKFILL_MS } from "@/lib/crm/constants";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import {
  mapBlankDownload,
  mapFeedbackReport,
  mapGuestInvoice,
  mapPartnerApplication,
  mapServiceRequest,
  mapSignup,
  mapSupportMessage,
  type CrmIngestItem,
} from "@/lib/crm/sources";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { platformOrgId } from "@/lib/partners/partner-hint";

/**
 * Сбор обращений из таблиц, которые уже есть: каждая — свой курсор в
 * `PlatformSetting` (`crm:cursor:<источник>`). Первый прогон берёт 90 дней
 * истории, дальше — от курсора с нахлёстом 10 минут; дубли отсекает
 * `externalKey`. Сбой одного источника не мешает остальным.
 */

const BATCH = 1000;

/** Прочитанная пачка: сколько строк, время последней (для курсора) и записи ленты. */
type Batch = { rows: number; lastAt: Date | null; items: CrmIngestItem[] };

async function readCursor(source: string): Promise<Date | null> {
  const row = await db.platformSetting.findUnique({ where: { key: `crm:cursor:${source}` } });
  const stored = row ? new Date(row.value) : null;
  return stored && !Number.isNaN(stored.getTime()) ? stored : null;
}

async function writeCursor(source: string, at: Date): Promise<void> {
  const key = `crm:cursor:${source}`;
  await db.platformSetting.upsert({ where: { key }, create: { key, value: at.toISOString() }, update: { value: at.toISOString() } });
}

type SourceLoader = (since: Date) => Promise<Batch>;

function loader<T>(load: (since: Date) => Promise<T[]>, at: (row: T) => Date, map: (row: T) => CrmIngestItem[]): SourceLoader {
  return async (since) => {
    const rows = await load(since);
    return { rows: rows.length, lastAt: rows.length ? at(rows[rows.length - 1]) : null, items: rows.flatMap(map) };
  };
}

const SOURCES: Record<string, SourceLoader> = {
  service: loader(
    (since) =>
      db.serviceRequest.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
        select: {
          id: true,
          serviceKey: true,
          serviceTitle: true,
          organizationId: true,
          organizationName: true,
          userId: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          comment: true,
          scheduledAt: true,
          createdAt: true,
        },
      }),
    (row) => row.createdAt,
    (row) => [mapServiceRequest(row)],
  ),
  feedback: loader(
    (since) => db.feedbackReport.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, take: BATCH, select: FEEDBACK_SELECT }),
    (row) => row.createdAt,
    (row) => mapFeedbackReport(row),
  ),
  // Ответ на обращение приходит позже самого обращения — свой курсор по respondedAt.
  "feedback-reply": loader(
    (since) =>
      db.feedbackReport.findMany({ where: { respondedAt: { gte: since } }, orderBy: { respondedAt: "asc" }, take: BATCH, select: FEEDBACK_SELECT }),
    (row) => row.respondedAt ?? row.createdAt,
    (row) => mapFeedbackReport(row).filter((item) => item.direction === "out"),
  ),
  chat: loader(
    (since) =>
      db.supportMessage.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
        select: {
          id: true,
          author: true,
          body: true,
          attachments: true,
          authorUserId: true,
          authorName: true,
          operatorName: true,
          broadcastId: true,
          createdAt: true,
          thread: { select: { id: true, key: true, userEmail: true, userName: true, phone: true, organizationId: true, organizationName: true } },
        },
      }),
    (row) => row.createdAt,
    (row) => {
      const item = mapSupportMessage({ ...row, attachmentsCount: Array.isArray(row.attachments) ? row.attachments.length : 0 });
      return item ? [item] : [];
    },
  ),
  invoice: loader(
    (since) =>
      db.paymentOrder.findMany({
        where: { createdAt: { gte: since }, paymentMethod: "invoice", buyerJson: { not: Prisma.DbNull } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
        select: { id: true, email: true, amountRub: true, description: true, organizationId: true, buyerJson: true, createdAt: true },
      }),
    (row) => row.createdAt,
    (row) => [mapGuestInvoice({ ...row, amountRub: Number(row.amountRub) })],
  ),
  signup: loader(
    async (since) => {
      const orgs = await db.organization.findMany({
        where: { ...NOT_DIRECTORY_ORG_WHERE, isDemo: false, id: { not: platformOrgId() }, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
        select: { id: true, name: true, createdAt: true },
      });
      if (!orgs.length) return [];
      const owners = await db.user.findMany({
        where: { organizationId: { in: orgs.map((org) => org.id) }, role: "owner", isRoot: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, phone: true, organizationId: true },
      });
      return orgs.map((org) => ({ ...org, owner: owners.find((user) => user.organizationId === org.id) ?? null }));
    },
    (row) => row.createdAt,
    (row) => [mapSignup(row)],
  ),
  blank: loader(
    async (since) => {
      const consents = await db.legalConsent.findMany({
        where: { source: BLANK_CONSENT_SOURCE, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
        select: { id: true, email: true, userId: true, organizationId: true, createdAt: true },
      });
      if (!consents.length) return [];
      const audits = await db.auditLog.findMany({
        where: { action: BLANK_DOWNLOAD_AUDIT_ACTION, entityId: { in: consents.map((row) => row.id) } },
        select: { entityId: true, details: true },
      });
      const titles = new Map(
        audits.map((audit) => {
          const details = audit.details && typeof audit.details === "object" ? (audit.details as Record<string, unknown>) : {};
          return [audit.entityId, typeof details.title === "string" ? details.title : null] as const;
        }),
      );
      return consents.map((row) => ({ ...row, title: titles.get(row.id) ?? null }));
    },
    (row) => row.createdAt,
    (row) => [mapBlankDownload(row)],
  ),
  partner: loader(
    (since) =>
      db.partner.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
        select: {
          id: true,
          companyName: true,
          inn: true,
          city: true,
          phone: true,
          telegram: true,
          contactEmail: true,
          type: true,
          applicantUserId: true,
          applicantOrganizationId: true,
          createdAt: true,
        },
      }),
    (row) => row.createdAt,
    (row) => [mapPartnerApplication(row)],
  ),
};

const FEEDBACK_SELECT = {
  id: true,
  type: true,
  message: true,
  userId: true,
  userEmail: true,
  userName: true,
  organizationId: true,
  organizationName: true,
  phone: true,
  source: true,
  telegramChatId: true,
  responseMessage: true,
  respondedAt: true,
  respondedById: true,
  respondedByName: true,
  createdAt: true,
} as const;

export const CRM_SOURCE_KEYS = Object.keys(SOURCES);

export type SourceSyncResult = { source: string; rows: number; created: number; error?: string };

export async function syncCrmSources(now = new Date()): Promise<SourceSyncResult[]> {
  const results: SourceSyncResult[] = [];
  for (const [source, load] of Object.entries(SOURCES)) {
    try {
      const stored = await readCursor(source);
      const since = stored ? new Date(stored.getTime() - CRM_CURSOR_OVERLAP_MS) : new Date(now.getTime() - CRM_SOURCES_BACKFILL_MS);
      const batch = await load(since);
      const ingested = await ingestCrmItems(batch.items);
      // Неполная пачка — прочитано всё до «сейчас»; полная — продолжим с последней строки.
      await writeCursor(source, batch.rows >= BATCH && batch.lastAt ? batch.lastAt : now);
      results.push({ source, rows: batch.rows, created: ingested.created });
    } catch (error) {
      console.error(`[crm] источник ${source} не собран`, error);
      results.push({ source, rows: 0, created: 0, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }
  return results;
}
