import { z } from "zod";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import {
  isRowKeyAllowed,
  journalFillCodeBlock,
  journalFillTokenExpired,
  listJournalFillDocuments,
  loadJournalFillForm,
  loadOrganizationForFill,
  scopeDocumentsToBuilding,
  todayKeyFor,
  verifyJournalFillToken,
  type JournalFillTokenCheck,
} from "@/lib/journal-fill";
import { buildingTargets } from "@/lib/building-targets";
import { journalFillHints } from "@/lib/journal-fill-hints";
import { documentInTokenLine, ensureQrPeriodDocuments, qrRolloverMessage, resolveTokenDocumentIds } from "@/lib/journal-qr-rollover";
import { isNameSuggestionScope } from "@/lib/name-suggestions";
import { rememberNames } from "@/lib/name-suggestions-db";
import { isBrakerageJournalCode } from "@/lib/brakerage-row-merge";
import { isCommissionJournalCode } from "@/lib/brakerage-commission";
import { FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE } from "@/lib/finished-product-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import { appendFinishedProductRows } from "@/lib/tasksflow-adapters/finished-product";
import { appendPerishableRows } from "@/lib/tasksflow-adapters/perishable-rejection";
import { normalizeQrFillMode, resolveQrFillActor } from "@/lib/qr-fill-actor";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey, recordQrFillAudit } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyWithQrAppend } from "@/lib/tasksflow-adapters/row-key";
import {
  TASK_FORM_CORRECTION_KEY,
  TASK_FORM_OFF_KEY,
  TASK_FORM_STATUS_KEY,
  buildCompletionValidator,
  encodeStatusMarks,
} from "@/lib/tasksflow-adapters/task-form";
import { cleanLabel, isObjectField, resolveFillMarks } from "@/lib/journal-fill-html";
import { COLD_EQUIPMENT_STATUS_SHORT, type ColdEquipmentStatus } from "@/lib/cold-equipment-document";
import { notifyManagement } from "@/lib/notifications";
import { stampFor } from "@/lib/quick-values";
import { notifyOrganization } from "@/lib/telegram";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Запись в журнал по QR — общее ядро для HTML-формы (`/journal-fill/…`,
 * route handler без React) и JSON-API (`/api/journal-fill/…`).
 *
 * Порядок проверок: лимитер → токен → организация → активный документ →
 * сотрудник по режиму организации → допустимая строка → гейт «правит
 * только руководитель» → схема адаптера → запись → память наименований →
 * аудит → время заполнения.
 */
export type JournalFillSubmitInput = {
  request: Request;
  orgId: string;
  code: string;
  token: string;
  documentId: string;
  employeeId: string;
  rowKey: string;
  values: Record<string, unknown>;
  /** Поля, отмеченные «Выключено / Нет показания»: в журнал идёт прочерк с пометкой, руководитель получает уведомление. */
  off?: string[];
  /**
   * «Обслуживание»/«Ремонт» вместо показания (холодильники, `statusFields`
   * формы): в журнале «обсл»/«рем», температура пустая, норма не проверяется.
   */
  statuses?: Record<string, ColdEquipmentStatus>;
  /** «Что сделали» при отклонении — адаптеры кладут его к строке/карточке с отклонением. */
  correction?: string | null;
  pin?: string | null;
  /** PIN уже проверен на отдельном шаге (HTML-форма, cookie-пропуск). */
  pinVerified?: boolean;
  openedAt?: number | null;
  /** Бракераж «Несколько сразу»: наименования, по строке журнала на каждое (до 30). */
  bulkNames?: string[];
};

export type JournalFillSubmitResult =
  | { ok: false; status: number; error: string; badKeys?: string[] }
  | { ok: true; mode: "appended" | "updated"; documentTitle: string; employeeName: string; employeeId: string; count: number };

/** Текст 410 для дополнительного QR после конца периода документа. */
export const JOURNAL_FILL_TOKEN_EXPIRED_ERROR =
  "Срок этого QR-кода закончился — он был на один документ. Отсканируйте основной QR-код журнала.";

/**
 * Документ из запроса допустим для этого токена (2026-09-23). Раньше
 * submit не сверял `documentId` с документом токена, и QR одного документа
 * писал в любой документ журнала:
 *   • QR со сроком — только свой документ;
 *   • старый QR документа — документ той же линии (та же точка или общий);
 *   • основной QR точки — документ этой точки или общий, и точка должна
 *     принадлежать организации;
 *   • основной QR журнала и хаб — как раньше (любой документ журнала).
 * Организация и журнал документа сверяются запросом.
 */
export async function journalFillTokenAllowsDocument(params: {
  check: Extract<JournalFillTokenCheck, { ok: true }>;
  orgId: string;
  code: string;
  documentId: string;
}): Promise<boolean> {
  const { check, orgId, code, documentId } = params;
  if (check.validUntil !== null) return documentId === check.documentId;
  if (!check.documentId && !check.buildingId) return true;
  const candidate = await db.journalDocument.findFirst({
    where: { id: documentId, organizationId: orgId, template: { code } },
    select: { id: true, buildingId: true },
  });
  if (!candidate) return false;
  if (check.documentId) {
    const tokenDocument = await db.journalDocument.findFirst({
      where: { id: check.documentId, organizationId: orgId, template: { code } },
      select: { id: true, buildingId: true },
    });
    return tokenDocument !== null && documentInTokenLine(tokenDocument, candidate);
  }
  const building = await db.building.findFirst({ where: { id: check.buildingId!, organizationId: orgId }, select: { id: true } });
  if (!building) return false;
  return scopeDocumentsToBuilding([candidate], check.buildingId, await buildingTargets(orgId)).length === 1;
}

export async function submitJournalFill(input: JournalFillSubmitInput): Promise<JournalFillSubmitResult> {
  const { request, orgId, code } = input;
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "journal", input.documentId))) {
    return { ok: false, status: 429, error: QR_FILL_RATE_LIMIT_ERROR };
  }
  const check = verifyJournalFillToken(input.token, orgId, code);
  if (!check.ok) return { ok: false, status: 401, error: "QR-код недействителен" };
  const org = await loadOrganizationForFill(orgId);
  if (!org) return { ok: false, status: 404, error: "Организация не найдена" };
  // Журналы объектов и отключённые — до поиска документа (QR журнала и хаб
  // принимаются для любого кода; HTML-маршрут отсекает их раньше, JSON-API — здесь).
  const blocked = journalFillCodeBlock(code, org.disabledJournalCodes);
  if (blocked) return { ok: false, ...blocked };
  const mode = normalizeQrFillMode(org.qrFillMode);
  const todayKey = todayKeyFor(org.timezone);
  // Срок — до поиска документа и до `ensureQrPeriodDocuments`.
  if (journalFillTokenExpired(check, todayKey)) return { ok: false, status: 410, error: JOURNAL_FILL_TOKEN_EXPIRED_ERROR };
  if (!(await journalFillTokenAllowsDocument({ check, orgId, code, documentId: input.documentId }))) {
    return { ok: false, status: 403, error: "Этот QR-код открывает другой документ — отсканируйте QR-код заново." };
  }

  let docs = await listJournalFillDocuments(orgId, code, todayKey);
  let document = docs.find((doc) => doc.id === input.documentId);
  if (!document && check.validUntil !== null) {
    // QR со сроком не переходит в новый период: документ закрыт или удалён.
    return { ok: false, status: 409, error: "Документ этого QR-кода больше не активен — отсканируйте основной QR-код журнала." };
  }
  if (!document) {
    // Форму открыли 30-го, «Сохранить» нажали 1-го: пишем в документ нового
    // периода той же линии (создаётся по образцу прошлого), а не 409.
    const rollover = await ensureQrPeriodDocuments({
      organizationId: orgId,
      templateCode: code,
      todayKey,
      anchor: { documentId: input.documentId },
      source: "journal-fill-submit",
    });
    const lineage = await resolveTokenDocumentIds({ organizationId: orgId, templateCode: code, todayKey, tokenDocumentId: input.documentId });
    docs = await listJournalFillDocuments(orgId, code, todayKey);
    document = lineage.documentIds.length === 1 ? docs.find((doc) => doc.id === lineage.documentIds[0]) : undefined;
    if (!document) {
      const reason = lineage.reason === "period-closed" ? lineage.reason : rollover.reason;
      return {
        ok: false,
        status: 409,
        error:
          lineage.documentIds.length > 1
            ? "Начался новый период — откройте QR-код заново и выберите документ."
            : reason
              ? qrRolloverMessage(reason)
              : "На сегодня нет активного документа этого журнала",
      };
    }
  }
  // Дальше — только документ, куда запись реально ляжет.
  const documentId = document.id;

  const actor = await resolveQrFillActor({
    mode,
    organizationId: orgId,
    employeeId: input.employeeId,
    pin: input.pin,
    // PIN уже подтверждён отдельным шагом ДО формы — второй раз не спрашиваем
    // (раньше в public-режиме сотрудника с PIN спрашивали повторно).
    pinVerified: input.pinVerified === true,
    // Сторонняя комиссия — только у бракеража готовой продукции.
    includeCommission: isCommissionJournalCode(code),
  });
  if (!actor.ok) return { ok: false, status: actor.status, error: actor.error };

  if (!(await isRowKeyAllowed({ orgId, code, documentId, employeeId: actor.employee.id, rowKey: input.rowKey }))) {
    return { ok: false, status: 404, error: "Строка не найдена" };
  }

  const adapter = getAdapter(code);
  if (!adapter) return { ok: false, status: 400, error: "Журнал не поддерживается" };
  const template = await db.journalTemplate.findFirst({ where: { code }, select: { id: true, taskScope: true } });
  const hints = journalFillHints(code);
  // Строчные журналы: каждая запись по QR — новая строка, не upsert по сотруднику.
  const isShared = template?.taskScope === "shared" || hints.append === true;

  // Гейт «только администраторы правят выполненное»: повторная отметка
  // за сегодня линейным сотрудником — как в /api/task-fill.
  if (!isShared && org.requireAdminForJournalEdit && !isManagementRole(actor.employee.role)) {
    const existing = await db.journalDocumentEntry.findFirst({
      where: { documentId, employeeId: actor.employee.id, date: new Date(`${todayKey}T00:00:00.000Z`) },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, status: 403, error: "Сегодня вы уже отметились. Изменить запись может только руководитель." };
    }
  }

  const schema = await loadJournalFillForm(code, documentId, input.rowKey);
  // «Выключено / Нет показания» и «Обслуживание»/«Ремонт» снимают обязательность с
  // числового поля — вместо цифры в журнал идёт прочерк с пометкой или «обсл»/«рем»,
  // а не выдуманный ноль.
  const marks = resolveFillMarks(schema, input.off, input.statuses);
  const offKeys = marks.offKeys;
  const statusKeys = new Set(Object.keys(marks.statuses));
  let values: Record<string, string | number | boolean | null> = {};
  if (schema) {
    // «Несколько сразу»: температура у каждого блюда своя — общая необязательна.
    const bulkOptional = (key: string) => Boolean(input.bulkNames?.length) && key === "productTemp";
    const effective = {
      ...schema,
      fields: schema.fields.map((field) =>
        field.type === "number" && (offKeys.has(field.key) || statusKeys.has(field.key) || bulkOptional(field.key)) ? { ...field, required: false } : field
      ),
    };
    // У отмеченного поля показания нет: что бы ни осталось в самом поле — не проверяем и не пишем.
    const submitted = { ...input.values };
    for (const key of [...offKeys, ...statusKeys]) delete submitted[key];
    try {
      values = buildCompletionValidator(effective).parse(submitted) as typeof values;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const labelOf = (issue: z.ZodIssue) => {
          const key = Array.isArray(issue.path) ? issue.path[0] : null;
          const field = schema.fields.find((candidate) => candidate.key === key);
          return { key: typeof key === "string" ? key : null, label: field ? cleanLabel(field.label) : "поле" };
        };
        // Пустое обязательное поле — не «expected number, received undefined», а список того, что не заполнено.
        const missing = error.issues.filter((issue) => (issue.code === "invalid_type" && (issue as { input?: unknown }).input === undefined) || issue.code === "too_small");
        if (missing.length > 0) {
          const items = missing.map(labelOf);
          const hasObjects = schema.fields.some((field) => isObjectField(field));
          const hint = !hasObjects
            ? ""
            : (schema.statusFields?.length ?? 0) > 0
              ? " Если холодильник выключен, на обслуживании или в ремонте — отметьте это в его карточке вместо температуры: «Выключено», «Обслуживание» или «Ремонт»."
              : " Если оборудование выключено или показание снять нельзя — отметьте это в карточке: в журнал попадёт прочерк с пометкой, руководитель получит уведомление.";
          return { ok: false, status: 400, error: `Не заполнено: ${items.map((item) => `«${item.label}»`).join(", ")}.${hint}`, badKeys: items.map((item) => item.key).filter((key): key is string => key !== null) };
        }
        const first = labelOf(error.issues[0]);
        return { ok: false, status: 400, error: `Проверьте «${first.label}»: ${error.issues[0]?.message ?? "некорректное значение"}`, badKeys: first.key ? [first.key] : [] };
      }
      throw error;
    }
  }
  const correction = input.correction?.trim() ?? "";
  const adapterValues: Record<string, string | number | boolean | null> = {
    ...values,
    ...(offKeys.size > 0 ? { [TASK_FORM_OFF_KEY]: Array.from(offKeys).join(",") } : {}),
    ...(statusKeys.size > 0 ? { [TASK_FORM_STATUS_KEY]: encodeStatusMarks(marks.statuses) } : {}),
    ...(correction ? { [TASK_FORM_CORRECTION_KEY]: correction } : {}),
  };

  const bulkNames = isBrakerageJournalCode(code) && input.bulkNames && input.bulkNames.length > 0 ? input.bulkNames : null;
  let count = 1;
  if (bulkNames) {
    // Несколько блюд одним вызовом под блокировкой документа, у каждой строки свой ключ.
    const employee = await findTaskEmployee({ employeeId: actor.employee.id, organizationId: orgId });
    if (!employee) return { ok: false, status: 404, error: "Сотрудник не найден" };
    const base = Date.now();
    const entries = bulkNames.map((name, index) => ({
      rowKey: rowKeyWithQrAppend(input.rowKey, base + index),
      values: { ...adapterValues, productName: name },
    }));
    count =
      code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE
        ? await appendFinishedProductRows({ documentId, employee, todayKey, entries })
        : await appendPerishableRows({ documentId, employee, todayKey, entries });
    if (count === 0) return { ok: false, status: 500, error: "Не удалось записать в журнал" };
    values.productName = bulkNames[0];
  } else {
    const applied = await adapter.applyRemoteCompletion({
      documentId,
      rowKey: hints.append ? rowKeyWithQrAppend(input.rowKey) : input.rowKey,
      completed: true,
      todayKey,
      values: adapterValues,
    });
    if (!applied) return { ok: false, status: 500, error: "Не удалось записать в журнал" };
  }

  // «Выключено / Нет показания» — руководителю сразу: в Telegram и в колокольчик.
  if (offKeys.size > 0 && schema) {
    const labels = schema.fields.filter((field) => offKeys.has(field.key)).map((field) => cleanLabel(field.label));
    const stamp = stampFor(org.timezone || "Europe/Moscow");
    const text = `⚠️ ${document.title}: ${actor.employee.name} отметил(а) «Выключено / нет показания» — ${labels.join(", ")} (${stamp.date} ${stamp.time}, по QR). Показание не снято, в журнале прочерк с пометкой.`;
    await Promise.all([
      notifyOrganization(orgId, text, ["owner", "technologist"], "temperature").catch(() => null),
      notifyManagement({
        organizationId: orgId,
        kind: "qr-fill-off",
        dedupeKey: `qr-fill-off:${documentId}:${todayKey}:${actor.employee.id}`,
        title: `${document.title}: выключено или нет показания — ${actor.employee.name}`,
        linkHref: `/journals/${code}/documents/${documentId}`,
        linkLabel: "Открыть журнал",
        items: labels.map((label, index) => ({ id: `${index}`, label })),
      }).catch(() => null),
    ]);
  }

  // Память наименований — по карте подсказок журнала.
  if (hints.nameFields) {
    const byScope = new Map<string, { values: string[]; meta: Record<string, unknown> }>();
    for (const [key, scope] of Object.entries(hints.nameFields)) {
      const value = values[key];
      if (typeof value !== "string" || value.trim() === "") continue;
      const bucket = byScope.get(scope) ?? { values: [], meta: {} };
      if (bulkNames && key === "productName") bucket.values.push(...bulkNames);
      else bucket.values.push(value);
      if (hints.tempField && hints.tempField.nameKey === key) {
        const temp = values[hints.tempField.tempKey];
        if (temp !== null && temp !== undefined && String(temp).trim() !== "") bucket.meta[value] = { productTemp: String(temp) };
      }
      byScope.set(scope, bucket);
    }
    await Promise.all(
      Array.from(byScope.entries()).map(([scope, bucket]) =>
        isNameSuggestionScope(scope)
          ? rememberNames({ organizationId: orgId, scope, values: bucket.values, meta: bucket.meta }).catch(() => 0)
          : Promise.resolve(0)
      )
    );
  }

  await recordQrFillAudit({
    request,
    organizationId: orgId,
    kind: "journal",
    objectId: documentId,
    objectName: document.title,
    employee: { id: actor.employee.id, name: actor.employee.name },
    documentIds: [documentId],
    dateKey: todayKey,
    authMode: mode,
    // «обсл»/«рем» — в аудите тем же словом, что в журнале.
    values:
      statusKeys.size > 0
        ? { ...values, ...Object.fromEntries(Object.entries(marks.statuses).map(([key, status]) => [key, COLD_EQUIPMENT_STATUS_SHORT[status]])) }
        : values,
  });

  if (template && typeof input.openedAt === "number" && input.openedAt > 0) {
    const durationMs = Date.now() - input.openedAt;
    if (durationMs > 0 && durationMs < 6 * 60 * 60 * 1000) {
      await db.formFillTiming
        .create({ data: { organizationId: orgId, templateId: template.id, userId: actor.employee.id, durationMs, source: mode === "auth" ? "qr-journal-auth" : "qr-journal" } })
        .catch(() => null);
    }
  }

  return { ok: true, mode: isShared ? "appended" : "updated", documentTitle: document.title, employeeName: actor.employee.name, employeeId: actor.employee.id, count };
}
