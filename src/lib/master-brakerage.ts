import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import { FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE } from "@/lib/finished-product-document";
import { ensureActiveDocument } from "@/lib/journal-auto-create";
import {
  isBlankBrakerageRow,
  planMasterBrakerageRows,
  type MasterBrakerageCommon,
  type MasterBrakerageRow,
} from "@/lib/master-brakerage-plan";
import { listPoolOrganizations } from "@/lib/master-directory";
import { rememberNames } from "@/lib/name-suggestions-db";

/**
 * «Добавить в журналы на дату» мастер-кабинета: строки БЖГП на выбранную
 * дату — в документ каждого пищеблока пула. Документа, покрывающего дату,
 * нет — создаётся тем же путём, что и документы журнала
 * (`ensureActiveDocument`: период, ответственные, засев, списки мастера).
 * Запись — под `withDocumentConfigLock`, как QR и сохранение с сайта.
 */

export type MasterBrakerageOrgResult = {
  organizationId: string;
  organizationName: string;
  documentId: string | null;
  documentTitle: string | null;
  /** Документа на дату не было: создан (или будет создан — в предпросмотре). */
  documentCreated: boolean;
  added: number;
  skipped: number;
  skippedNames: string[];
  error: string | null;
};

export type MasterBrakerageResult = {
  dryRun: boolean;
  date: string;
  organizations: MasterBrakerageOrgResult[];
  totals: { added: number; skipped: number; organizations: number; failed: number };
};

function dayStartUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

async function findTemplateId(): Promise<string | null> {
  const template = await db.journalTemplate.findFirst({
    where: { code: FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE, isActive: true },
    select: { id: true },
  });
  return template?.id ?? null;
}

function isJournalDisabled(disabledJournalCodes: unknown): boolean {
  return Array.isArray(disabledJournalCodes) && disabledJournalCodes.includes(FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE);
}

async function peopleFor(organizationId: string, responsibleUserId: string | null, verifierUserId: string | null) {
  const ids = [responsibleUserId, verifierUserId].filter((id): id is string => Boolean(id));
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true } })
    : [];
  // Аккаунт «имя = почта» — не подпись в бланке (как в окне пищеблока).
  const nameOf = (id: string | null) => {
    const name = (id && users.find((user) => user.id === id)?.name) || "";
    return name.includes("@") ? "" : name;
  };
  return { responsibleName: nameOf(responsibleUserId), verifierName: nameOf(verifierUserId) };
}

type Existing = {
  id: string;
  title: string;
  config: Prisma.JsonValue;
  responsibleUserId: string | null;
  verifierUserId: string | null;
};

async function findDocumentForDate(organizationId: string, templateId: string, date: string) {
  const day = dayStartUtc(date);
  const active = await db.journalDocument.findFirst({
    where: { organizationId, templateId, status: "active", dateFrom: { lte: day }, dateTo: { gte: day } },
    select: { id: true, title: true, config: true, responsibleUserId: true, verifierUserId: true },
    orderBy: { createdAt: "asc" },
  });
  if (active) return { active: active as Existing, closed: false };
  const closed = await db.journalDocument.findFirst({
    where: { organizationId, templateId, status: "closed", dateFrom: { lte: day }, dateTo: { gte: day } },
    select: { id: true },
  });
  return { active: null, closed: Boolean(closed) };
}

const CLOSED_ERROR = "Журнал за этот период уже сдан (закрыт) — строки не добавлены";
const DISABLED_ERROR = "Журнал бракеража готовой продукции у пищеблока выключен";

async function processOrganization(params: {
  org: { id: string; name: string; disabledJournalCodes: unknown };
  templateId: string;
  rows: MasterBrakerageRow[];
  common: MasterBrakerageCommon;
  dryRun: boolean;
}): Promise<MasterBrakerageOrgResult> {
  const { org, rows, common } = params;
  const base: MasterBrakerageOrgResult = {
    organizationId: org.id,
    organizationName: org.name,
    documentId: null,
    documentTitle: null,
    documentCreated: false,
    added: 0,
    skipped: 0,
    skippedNames: [],
    error: null,
  };
  const found = await findDocumentForDate(org.id, params.templateId, common.date);

  if (params.dryRun) {
    if (found.active) {
      const plan = planMasterBrakerageRows({
        rawConfig: found.active.config,
        rows,
        common,
        people: { responsibleName: "", verifierName: "" },
      });
      return {
        ...base,
        documentId: found.active.id,
        documentTitle: found.active.title,
        added: plan.rows.length,
        skipped: plan.skipped.length,
        skippedNames: plan.skipped,
      };
    }
    if (found.closed) return { ...base, error: CLOSED_ERROR };
    if (isJournalDisabled(org.disabledJournalCodes)) return { ...base, error: DISABLED_ERROR };
    const plan = planMasterBrakerageRows({ rawConfig: {}, rows, common, people: { responsibleName: "", verifierName: "" } });
    return { ...base, documentCreated: true, added: plan.rows.length };
  }

  let documentId = found.active?.id ?? null;
  let documentCreated = false;
  if (!documentId) {
    if (found.closed) return { ...base, error: CLOSED_ERROR };
    if (isJournalDisabled(org.disabledJournalCodes)) return { ...base, error: DISABLED_ERROR };
    const report = await ensureActiveDocument(db, {
      organizationId: org.id,
      templateCode: FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
      now: new Date(`${common.date}T12:00:00.000Z`),
    });
    if (report.reason === "period-closed") return { ...base, error: CLOSED_ERROR };
    if (!report.documentId) return { ...base, error: "Не удалось создать документ журнала" };
    documentId = report.documentId;
    documentCreated = report.created;
    console.info("[master-brakerage] document created", { organizationId: org.id, documentId, date: common.date });
  }

  type Outcome = { error: string | null; added: string[]; skipped: string[] };
  const outcome = await withDocumentConfigLock<Outcome>(documentId, async (locked) => {
    if (locked.status !== "active") return { result: { error: CLOSED_ERROR, added: [] as string[], skipped: [] as string[] } };
    const people = await peopleFor(org.id, locked.responsibleUserId, locked.verifierUserId);
    const raw =
      locked.config && typeof locked.config === "object" && !Array.isArray(locked.config)
        ? (locked.config as Record<string, unknown>)
        : {};
    const plan = planMasterBrakerageRows({ rawConfig: raw, rows, common, people });
    if (plan.rows.length === 0) {
      return { result: { error: null, added: [] as string[], skipped: plan.skipped } };
    }
    const currentRows = Array.isArray(raw.rows) ? (raw.rows as unknown[]) : [];
    // Заготовка нового документа — одна пустая строка: не оставляем её перед меню.
    const keptRows = documentCreated ? currentRows.filter((row) => !isBlankBrakerageRow(row)) : currentRows;
    const config = { ...raw, rows: [...keptRows, ...plan.rows] };
    return {
      config: config as Prisma.InputJsonValue,
      result: { error: null, added: plan.rows.map((row) => row.productName), skipped: plan.skipped },
    };
  });
  const title = (await db.journalDocument.findUnique({ where: { id: documentId }, select: { title: true } }))?.title ?? null;
  if (!outcome) return { ...base, documentId, documentTitle: title, documentCreated, error: "Документ журнала не найден" };
  if (outcome.added.length > 0) {
    // Наименования — в подсказки пищеблока, как после «Добавить списком».
    await rememberNames({ organizationId: org.id, scope: "dish", values: outcome.added }).catch((err) => {
      console.warn("[master-brakerage] remember names failed", { organizationId: org.id }, err);
    });
  }
  return {
    ...base,
    documentId,
    documentTitle: title,
    documentCreated,
    added: outcome.added.length,
    skipped: outcome.skipped.length,
    skippedNames: outcome.skipped,
    error: outcome.error,
  };
}

/** Предпросмотр (`dryRun`) или запись строк во все пищеблоки пула мастера. */
export async function addMasterBrakerageToPool(params: {
  masterOrgId: string;
  rows: MasterBrakerageRow[];
  common: MasterBrakerageCommon;
  dryRun: boolean;
}): Promise<MasterBrakerageResult> {
  const [pool, templateId] = await Promise.all([listPoolOrganizations(params.masterOrgId), findTemplateId()]);
  const orgs = pool.length
    ? await db.organization.findMany({
        where: { id: { in: pool.map((org) => org.id) } },
        select: { id: true, name: true, disabledJournalCodes: true },
        orderBy: { name: "asc" },
      })
    : [];
  const results: MasterBrakerageOrgResult[] = [];
  for (const org of orgs) {
    if (!templateId) {
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        documentId: null,
        documentTitle: null,
        documentCreated: false,
        added: 0,
        skipped: 0,
        skippedNames: [],
        error: "Шаблон журнала бракеража готовой продукции не найден",
      });
      continue;
    }
    try {
      results.push(
        await processOrganization({ org, templateId, rows: params.rows, common: params.common, dryRun: params.dryRun })
      );
    } catch (err) {
      // Один сломанный пищеблок не останавливает остальные.
      console.error("[master-brakerage] organization failed", { organizationId: org.id, masterOrgId: params.masterOrgId }, err);
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        documentId: null,
        documentTitle: null,
        documentCreated: false,
        added: 0,
        skipped: 0,
        skippedNames: [],
        error: "Не удалось записать строки — попробуйте ещё раз",
      });
    }
  }
  return {
    dryRun: params.dryRun,
    date: params.common.date,
    organizations: results,
    totals: {
      added: results.reduce((sum, item) => sum + item.added, 0),
      skipped: results.reduce((sum, item) => sum + item.skipped, 0),
      organizations: results.filter((item) => item.added > 0).length,
      failed: results.filter((item) => item.error).length,
    },
  };
}
