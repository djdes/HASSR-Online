// Отправка документов клиентам по ЭДО через Saby — серверная часть.
// Сайт ЗАПИСЫВАЕТ документ черновиком в кабинет ООО «БФС» с получателем по реквизитам клиента
// (ИНН+КПП+название, у ИП — ИНН+ФИО) или по ID участника ЭДО (ручное переопределение). Подписывает
// КЭП и отправляет черновик человек в Saby по ссылке — отложенной подписи через API нет.
// Каждая запись — строка `EdoDocument`: GUID сохраняется ДО записи, сбой записи → перечитывание по
// GUID (ответ мог потеряться), живой документ того же источника не дублируется (send-core.ts).
// По мотивам DocsFlow `src/lib/edo/send-service.ts`.

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";

import { EdoServiceError, requireEdoCabinet, type EdoWorkingCabinet } from "./cabinet.server";
import {
  checkEdoUpload,
  cleanFileName,
  EDO_SABY_TYPE,
  guessDocMeta,
  isValidDocDate,
  planEdoSend,
  type EdoKind,
} from "./registry";
import { createSabyEdoApi, type SabyDraftInfo, type SabyEdoApi } from "./saby/edo-api";
import { checkCounterpartyEdo, normalizeParticipantId, operatorLabel, type CounterpartyEdo } from "./saby/counterparty";
import { EdoInputError, entityOrgRef, isIpInn, type OrgRef } from "./saby/orgs";
import { describeSabyError } from "./saby/rpc";
import { isEdoSettled, sabyStateCodeToInt } from "./saby/status";
import { decideAfterReread, decideDuplicate, type EdoDocumentView, type EdoRecipientCheckView } from "./send-core";
import { EdoSourceError, resolveEdoSource } from "./sources.server";

/** Сколько строк истории показываем и сколько документов перечитываем за одно «Обновить статусы». */
const LIST_LIMIT = 100;
export const EDO_REFRESH_LIMIT = 25;
/** Старше — не перечитываем: документ давно в обороте, его статус смотрят в Saby. */
const REFRESH_MAX_AGE_DAYS = 90;

const ROW_SELECT = {
  id: true,
  organizationId: true,
  kind: true,
  sourceId: true,
  sabyType: true,
  number: true,
  docDate: true,
  fileName: true,
  sabyDocId: true,
  cabinetClientId: true,
  recipientInn: true,
  recipientName: true,
  recipientEdo: true,
  recipientOperator: true,
  stateCode: true,
  stateName: true,
  signUrl: true,
  error: true,
  deletedAt: true,
  createdAt: true,
  refreshedAt: true,
  organization: { select: { name: true } },
} as const;

type Row = {
  id: string;
  organizationId: string;
  kind: string;
  sourceId: string | null;
  sabyType: string;
  number: string;
  docDate: string;
  fileName: string;
  sabyDocId: string;
  cabinetClientId: string;
  recipientInn: string;
  recipientName: string;
  recipientEdo: string | null;
  recipientOperator: string | null;
  stateCode: number | null;
  stateName: string | null;
  signUrl: string | null;
  error: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  refreshedAt: Date | null;
  organization: { name: string };
};

export function edoRowView(r: Row): EdoDocumentView {
  return {
    id: r.id,
    organizationId: r.organizationId,
    organizationName: r.organization.name,
    kind: r.kind as EdoKind,
    sourceId: r.sourceId,
    sabyType: r.sabyType,
    number: r.number,
    docDate: r.docDate,
    fileName: r.fileName,
    recipientName: r.recipientName,
    recipientInn: r.recipientInn,
    recipientEdo: r.recipientEdo,
    recipientOperator: r.recipientOperator,
    stateCode: r.stateCode,
    stateName: r.stateName,
    signUrl: r.signUrl,
    error: r.error,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    refreshedAt: r.refreshedAt ? r.refreshedAt.toISOString() : null,
  };
}

/** Что из ответа Saby пишем в строку: состояние и ссылку (пустая ссылка не затирает прежнюю). */
function stateData(info: SabyDraftInfo) {
  return {
    stateCode: sabyStateCodeToInt(info.state.code),
    stateName: info.state.label || null,
    ...(info.state.signUrl ? { signUrl: info.state.signUrl } : {}),
    error: null,
    refreshedAt: new Date(),
  };
}

/** Ошибки ввода и источника → 400, остальное как есть. */
function asServiceError(e: unknown): never {
  if (e instanceof EdoServiceError) throw e;
  if (e instanceof EdoSourceError || e instanceof EdoInputError) throw new EdoServiceError(400, e.message);
  throw e;
}

// ---------------------------------------------------------------------------------------------
// Получатель
// ---------------------------------------------------------------------------------------------

export interface EdoRecipient {
  ref: OrgRef;
  name: string;
  inn: string;
  kpp: string | null;
  isIp: boolean;
}

/**
 * Получатель из реквизитов организации (правки «Моя компания → Реквизиты» поверх ЕГРЮЛ): ООО — по
 * ИНН и КПП с полным названием, ИП — по ИНН и ФИО (руководитель ИП в снимке ЕГРИП — он сам).
 */
export async function loadEdoRecipient(organizationId: string): Promise<EdoRecipient> {
  const block = await loadDocumentOrgBlock(organizationId);
  if (!block) throw new EdoServiceError(404, "Организация не найдена");
  const { org } = block;
  const inn = (org.inn ?? "").trim();
  if (!inn) throw new EdoServiceError(400, `У «${org.shortName}» не указан ИНН — без него получателя в ЭДО не найти`);
  const isIp = isIpInn(inn) || org.ogrnLabel === "ОГРНИП";
  const kpp = (org.kpp ?? "").trim();
  if (!isIp && !/^\d{9}$/.test(kpp)) {
    throw new EdoServiceError(400, `У «${org.shortName}» не указан КПП — Saby ищет юр. лицо по ИНН и КПП. Обновите реквизиты организации из ЕГРЮЛ`);
  }
  try {
    const ref = entityOrgRef({ inn, kpp, isIp, fullName: org.fullName, shortName: org.shortName, director: org.directorName ?? "" });
    return { ref, name: org.fullName || org.shortName, inn, kpp: isIp ? null : kpp, isIp };
  } catch (e) {
    return asServiceError(e);
  }
}

function checkView(organizationId: string, r: EdoRecipient, c: CounterpartyEdo): EdoRecipientCheckView {
  return {
    organizationId,
    name: c.name || r.name,
    inn: r.inn,
    kpp: r.kpp,
    isIp: r.isIp,
    kind: c.kind,
    operator: c.box ? operatorLabel(c.box.operatorCode, c.box.operatorName) : "",
    participantId: c.box?.participantId ?? "",
    statusText: c.box?.statusText ?? "",
  };
}

/** «Определение по ИНН»: подключён ли клиент к ЭДО и через какого оператора. */
export async function checkEdoRecipient(organizationId: string): Promise<EdoRecipientCheckView> {
  const recipient = await loadEdoRecipient(organizationId);
  const cabinet = await requireEdoCabinet({ forSending: false });
  try {
    return checkView(organizationId, recipient, await checkCounterpartyEdo(cabinet.caller, recipient.ref));
  } catch (e) {
    if (e instanceof EdoServiceError) throw e;
    throw new EdoServiceError(502, describeSabyError(e));
  }
}

// ---------------------------------------------------------------------------------------------
// Отправка
// ---------------------------------------------------------------------------------------------

export interface SendToEdoInput {
  organizationId: string;
  kind: EdoKind;
  sourceId?: string | null;
  file?: { name: string; bytes: Uint8Array } | null;
  /** Номер и дата — для файла с компьютера; у источника берутся из него. */
  number?: string | null;
  date?: string | null;
  /** ID участника ЭДО получателя — только если реквизитов мало (Saby не находит клиента). */
  participantId?: string | null;
  sentByUserId: string | null;
}

export interface SendToEdoResult {
  document: EdoDocumentView;
  recipient: EdoRecipientCheckView | null;
  /** Перезаписан прежний черновик (тот же документ в Saby), а не создан новый. */
  rewritten: boolean;
}

/** Отправки одного источника не идут параллельно (один процесс PM2): вторая ждёт первую. */
const sendLocks = new Map<string, Promise<unknown>>();

async function withSendLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = sendLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  sendLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (sendLocks.get(key) === next) sendLocks.delete(key);
  }
}

interface PreparedDoc {
  number: string;
  date: string;
  files: Array<{ name: string; bytes: Uint8Array }>;
  sourceId: string | null;
}

async function prepareDocument(input: SendToEdoInput): Promise<PreparedDoc> {
  const plan = planEdoSend({ kind: input.kind, sourceId: input.sourceId, hasFile: !!input.file });
  if ("error" in plan) throw new EdoServiceError(400, plan.error);
  if (plan.mode === "source") {
    try {
      const doc = await resolveEdoSource(input.kind, plan.sourceId, input.organizationId);
      return { number: doc.number, date: doc.date, files: doc.files, sourceId: plan.sourceId };
    } catch (e) {
      return asServiceError(e);
    }
  }
  const file = input.file!;
  const problem = checkEdoUpload(file.name, file.bytes);
  if (problem) throw new EdoServiceError(400, problem);
  const name = cleanFileName(file.name);
  const guess = guessDocMeta(name);
  const number = (input.number ?? "").trim() || guess.number;
  const date = (input.date ?? "").trim() || guess.date;
  if (!number) throw new EdoServiceError(400, "Укажите номер документа");
  if (number.length > 100) throw new EdoServiceError(400, "Номер документа слишком длинный");
  if (!isValidDocDate(date)) throw new EdoServiceError(400, "Укажите дату документа");
  return { number, date, files: [{ name, bytes: file.bytes }], sourceId: null };
}

export async function sendToEdo(input: SendToEdoInput): Promise<SendToEdoResult> {
  const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
  if (!org) throw new EdoServiceError(404, "Организация не найдена");

  let participantId: string | null = null;
  if (input.participantId?.trim()) {
    participantId = normalizeParticipantId(input.participantId);
    if (!participantId) throw new EdoServiceError(400, "Это не похоже на ID участника ЭДО: ожидается код оператора, дефис и код участника — например, 2BM-…");
  }

  const doc = await prepareDocument(input);
  const recipient = await loadEdoRecipient(input.organizationId);
  const cabinet = await requireEdoCabinet();

  const lockKey = doc.sourceId ? `${input.kind}|${doc.sourceId}` : `${input.organizationId}|${input.kind}|${doc.number}|${doc.date}`;
  return withSendLock(lockKey, () => sendLocked(input, doc, recipient, cabinet, participantId));
}

async function sendLocked(
  input: SendToEdoInput,
  doc: PreparedDoc,
  recipient: EdoRecipient,
  cabinet: EdoWorkingCabinet,
  participantId: string | null,
): Promise<SendToEdoResult> {
  const api = createSabyEdoApi(cabinet.caller);
  const sabyType = EDO_SABY_TYPE[input.kind];

  const candidates = await db.edoDocument.findMany({
    where: doc.sourceId
      ? { kind: input.kind, sourceId: doc.sourceId }
      : { organizationId: input.organizationId, kind: input.kind, sourceId: null, number: doc.number, docDate: doc.date },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, sabyDocId: true, cabinetClientId: true, stateCode: true, deletedAt: true, error: true, number: true, createdAt: true },
  });

  let reuseRowId: string | null = null;
  const decision = decideDuplicate(candidates, cabinet.clientId);
  if (decision.action === "conflict") {
    throw new EdoServiceError(
      409,
      `Документ № ${decision.row.number} уже записан в другой кабинет Saby (ID подключения ${decision.row.cabinetClientId}) — второй не создаём. Удалите или аннулируйте его там`,
    );
  }
  if (decision.action === "reuse") {
    let found: SabyDraftInfo | null;
    try {
      found = await api.readDraft(decision.row.sabyDocId);
    } catch (e) {
      // Не знаем, что с прежним документом, — второй не пишем.
      throw new EdoServiceError(502, `Не удалось проверить прежний документ в Saby: ${describeSabyError(e)}`);
    }
    const next = decideAfterReread(decision.row.stateCode, found ? found.state : null);
    if (next.action === "conflict") {
      if (found) await db.edoDocument.update({ where: { id: decision.row.id }, data: stateData(found) });
      throw new EdoServiceError(
        409,
        `Документ № ${decision.row.number} уже в Saby: «${found?.state.label || "отправлен"}». Повторно не отправляем — откройте его в Saby`,
      );
    }
    if (next.action === "create") {
      await db.edoDocument.update({
        where: { id: decision.row.id },
        data: next.markDeleted ? { deletedAt: new Date(), signUrl: null, refreshedAt: new Date() } : found ? stateData(found) : {},
      });
    } else {
      reuseRowId = decision.row.id;
    }
  }

  // Проверка получателя — по возможности: сбой не мешает записи (Saby сам найдёт по реквизитам).
  let check: EdoRecipientCheckView | null = null;
  if (!participantId) {
    try {
      check = checkView(input.organizationId, recipient, await checkCounterpartyEdo(cabinet.caller, recipient.ref));
    } catch (e) {
      console.warn("[edo/send] проверка получателя не удалась:", describeSabyError(e));
    }
  }

  const rowData = {
    organizationId: input.organizationId,
    kind: input.kind,
    sourceId: doc.sourceId,
    sabyType,
    number: doc.number,
    docDate: doc.date,
    fileName: doc.files.map((f) => f.name).join(", ").slice(0, 400),
    cabinetClientId: cabinet.clientId,
    recipientInn: recipient.inn,
    recipientKpp: recipient.kpp,
    recipientName: recipient.name,
    recipientEdoId: participantId,
    recipientEdo: participantId ? null : check?.kind ?? null,
    recipientOperator: check?.operator || null,
    sentByUserId: input.sentByUserId,
  };

  // GUID — до вызова Saby: повтор или потерянный ответ находят именно этот документ.
  const row = reuseRowId
    ? await db.edoDocument.update({ where: { id: reuseRowId }, data: { ...rowData, error: null }, select: { id: true, sabyDocId: true } })
    : await db.edoDocument.create({ data: { ...rowData, sabyDocId: randomUUID() }, select: { id: true, sabyDocId: true } });

  let info: SabyDraftInfo | null = null;
  let failure: unknown = null;
  try {
    info = await api.writeDraft({
      id: row.sabyDocId,
      type: sabyType,
      ours: cabinet.sender,
      recipient: participantId ? { by: "participant", id: participantId } : { by: "requisites", org: recipient.ref },
      number: doc.number,
      date: doc.date,
      files: doc.files.map((f) => ({ name: f.name, base64: Buffer.from(f.bytes).toString("base64") })),
    });
  } catch (e) {
    failure = e;
    // Ответ мог потеряться после записи: есть документ с нашим GUID — значит, записан.
    info = await api.readDraft(row.sabyDocId).catch(() => null);
  }

  const message = failure instanceof EdoInputError ? failure.message : failure ? describeSabyError(failure) : null;
  const saved = await db.edoDocument.update({
    where: { id: row.id },
    data: info ? stateData(info) : { error: message, refreshedAt: new Date() },
    select: ROW_SELECT,
  });
  if (!info) {
    if (!(failure instanceof EdoInputError)) console.error("[edo/send] запись в Saby не удалась:", failure);
    throw new EdoServiceError(failure instanceof EdoInputError ? 400 : 502, message ?? "Saby не записал документ");
  }
  return { document: edoRowView(saved), recipient: check, rewritten: !!reuseRowId };
}

// ---------------------------------------------------------------------------------------------
// История и статусы
// ---------------------------------------------------------------------------------------------

export async function listEdoDocuments(filter: { organizationId?: string; limit?: number } = {}): Promise<EdoDocumentView[]> {
  const rows = await db.edoDocument.findMany({
    where: filter.organizationId ? { organizationId: filter.organizationId } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(filter.limit ?? LIST_LIMIT, LIST_LIMIT),
    select: ROW_SELECT,
  });
  return rows.map(edoRowView);
}

export interface EdoRefreshResult {
  checked: number;
  changed: number;
  failed: number;
}

/**
 * Перечитать в Saby документы, которые ещё могут измениться (не подписаны, не отклонены, не
 * аннулированы, не удалены), не старше 90 дней, свежие первыми, не больше `limit`. Документ из
 * другого кабинета не читается (его там нет) — строка получает пояснение. Сбой по одной строке не
 * останавливает остальные. Вебхуков у Saby нет — это кнопка «Обновить статусы».
 */
export async function refreshEdoDocuments(opts: { organizationId?: string; limit?: number } = {}): Promise<EdoRefreshResult> {
  const since = new Date(Date.now() - REFRESH_MAX_AGE_DAYS * 86_400_000);
  const limit = Math.max(1, Math.min(opts.limit ?? EDO_REFRESH_LIMIT, EDO_REFRESH_LIMIT));
  const candidates = await db.edoDocument.findMany({
    where: {
      createdAt: { gte: since },
      deletedAt: null,
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      OR: [{ stateCode: null }, { stateCode: { notIn: [7, 9, 22] } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit * 2,
    select: { id: true, sabyDocId: true, cabinetClientId: true, stateCode: true, deletedAt: true, error: true },
  });
  const rows = candidates.filter((r) => !isEdoSettled(r)).slice(0, limit);
  if (rows.length === 0) return { checked: 0, changed: 0, failed: 0 };

  const cabinet = await requireEdoCabinet({ forSending: false });
  const api: SabyEdoApi = createSabyEdoApi(cabinet.caller);
  let changed = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.cabinetClientId !== cabinet.clientId) {
      await db.edoDocument.update({
        where: { id: r.id },
        data: { error: `Документ записан в кабинет ${r.cabinetClientId}, а подключён ${cabinet.clientId} — статус смотрите в прежнем кабинете`, refreshedAt: new Date() },
      });
      failed++;
      continue;
    }
    try {
      const info = await api.readDraft(r.sabyDocId);
      if (info) {
        const next = stateData(info);
        if (next.stateCode !== r.stateCode) changed++;
        await db.edoDocument.update({ where: { id: r.id }, data: next });
      } else if (r.stateCode !== null) {
        // Был записан, а теперь его нет: черновик удалили в Saby руками.
        await db.edoDocument.update({ where: { id: r.id }, data: { deletedAt: new Date(), signUrl: null, error: null, refreshedAt: new Date() } });
        changed++;
      } else {
        // Запись упала, и документа так и нет — прежняя ошибка остаётся.
        await db.edoDocument.update({ where: { id: r.id }, data: { refreshedAt: new Date() } });
      }
    } catch (e) {
      failed++;
      await db.edoDocument.update({ where: { id: r.id }, data: { error: describeSabyError(e), refreshedAt: new Date() } });
    }
  }
  return { checked: rows.length, changed, failed };
}

// ---------------------------------------------------------------------------------------------
// Организации-клиенты для формы
// ---------------------------------------------------------------------------------------------

export interface EdoOrganizationOption {
  id: string;
  name: string;
  inn: string | null;
  kpp: string | null;
}

/** Поиск клиента по названию или ИНН (платформенная и демо-организации не показываются). */
export async function searchEdoOrganizations(query: string, limit = 20): Promise<EdoOrganizationOption[]> {
  const q = query.trim().slice(0, 100);
  const digits = q.replace(/\D/g, "");
  const rows = await db.organization.findMany({
    where: {
      id: { not: (process.env.PLATFORM_ORG_ID ?? "platform").trim() },
      isDemo: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { legalFullName: { contains: q, mode: "insensitive" as const } },
              ...(digits.length >= 4 ? [{ inn: { startsWith: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: q ? { name: "asc" } : { createdAt: "desc" },
    take: Math.min(limit, 50),
    select: { id: true, name: true, inn: true, kpp: true },
  });
  return rows;
}
