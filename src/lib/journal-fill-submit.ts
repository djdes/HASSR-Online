import { z } from "zod";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { isRowKeyAllowed, listJournalFillDocuments, loadJournalFillForm, loadOrganizationForFill, todayKeyFor, verifyJournalFillToken } from "@/lib/journal-fill";
import { journalFillHints } from "@/lib/journal-fill-hints";
import { isNameSuggestionScope } from "@/lib/name-suggestions";
import { rememberNames } from "@/lib/name-suggestions-db";
import { isBrakerageJournalCode } from "@/lib/brakerage-row-merge";
import { FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE } from "@/lib/finished-product-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import { appendFinishedProductRows } from "@/lib/tasksflow-adapters/finished-product";
import { appendPerishableRows } from "@/lib/tasksflow-adapters/perishable-rejection";
import { normalizeQrFillMode, resolveQrFillActor } from "@/lib/qr-fill-actor";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey, recordQrFillAudit } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyWithQrAppend } from "@/lib/tasksflow-adapters/row-key";
import { TASK_FORM_CORRECTION_KEY, TASK_FORM_OFF_KEY, buildCompletionValidator } from "@/lib/tasksflow-adapters/task-form";
import { cleanLabel, isObjectField } from "@/lib/journal-fill-html";
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

export async function submitJournalFill(input: JournalFillSubmitInput): Promise<JournalFillSubmitResult> {
  const { request, orgId, code } = input;
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "journal", input.documentId))) {
    return { ok: false, status: 429, error: QR_FILL_RATE_LIMIT_ERROR };
  }
  const check = verifyJournalFillToken(input.token, orgId, code);
  if (!check.ok) return { ok: false, status: 401, error: "QR-код недействителен" };
  const org = await loadOrganizationForFill(orgId);
  if (!org) return { ok: false, status: 404, error: "Организация не найдена" };
  const mode = normalizeQrFillMode(org.qrFillMode);
  const todayKey = todayKeyFor(org.timezone);

  const docs = await listJournalFillDocuments(orgId, code, todayKey);
  const document = docs.find((doc) => doc.id === input.documentId);
  if (!document) return { ok: false, status: 409, error: "На сегодня нет активного документа этого журнала" };

  const actor = await resolveQrFillActor({
    mode,
    organizationId: orgId,
    employeeId: input.employeeId,
    pin: input.pin,
    // PIN уже подтверждён отдельным шагом ДО формы — второй раз не спрашиваем
    // (раньше в public-режиме сотрудника с PIN спрашивали повторно).
    pinVerified: input.pinVerified === true,
    includeCommission: isBrakerageJournalCode(code),
  });
  if (!actor.ok) return { ok: false, status: actor.status, error: actor.error };

  if (!(await isRowKeyAllowed({ orgId, code, documentId: input.documentId, employeeId: actor.employee.id, rowKey: input.rowKey }))) {
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
      where: { documentId: input.documentId, employeeId: actor.employee.id, date: new Date(`${todayKey}T00:00:00.000Z`) },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, status: 403, error: "Сегодня вы уже отметились. Изменить запись может только руководитель." };
    }
  }

  const schema = await loadJournalFillForm(code, input.documentId, input.rowKey);
  // «Выключено / Нет показания» снимает обязательность с числового поля — вместо
  // цифры в журнал идёт прочерк с пометкой, а не выдуманный ноль.
  const offKeys = new Set((input.off ?? []).filter((key) => schema?.fields.some((field) => field.key === key && field.type === "number")));
  let values: Record<string, string | number | boolean | null> = {};
  if (schema) {
    // «Несколько сразу»: температура у каждого блюда своя — общая необязательна.
    const bulkOptional = (key: string) => Boolean(input.bulkNames?.length) && key === "productTemp";
    const effective = {
      ...schema,
      fields: schema.fields.map((field) =>
        field.type === "number" && (offKeys.has(field.key) || bulkOptional(field.key)) ? { ...field, required: false } : field
      ),
    };
    try {
      values = buildCompletionValidator(effective).parse(input.values) as typeof values;
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
          const hint = hasObjects
            ? " Если оборудование выключено или показание снять нельзя — отметьте это в карточке: в журнал попадёт прочерк с пометкой, руководитель получит уведомление."
            : "";
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
        ? await appendFinishedProductRows({ documentId: input.documentId, employee, todayKey, entries })
        : await appendPerishableRows({ documentId: input.documentId, employee, todayKey, entries });
    if (count === 0) return { ok: false, status: 500, error: "Не удалось записать в журнал" };
    values.productName = bulkNames[0];
  } else {
    const applied = await adapter.applyRemoteCompletion({
      documentId: input.documentId,
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
        dedupeKey: `qr-fill-off:${input.documentId}:${todayKey}:${actor.employee.id}`,
        title: `${document.title}: выключено или нет показания — ${actor.employee.name}`,
        linkHref: `/journals/${code}/documents/${input.documentId}`,
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
    objectId: input.documentId,
    objectName: document.title,
    employee: { id: actor.employee.id, name: actor.employee.name },
    documentIds: [input.documentId],
    dateKey: todayKey,
    authMode: mode,
    values,
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
