import { z } from "zod";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { isRowKeyAllowed, listJournalFillDocuments, loadJournalFillForm, loadOrganizationForFill, todayKeyFor, verifyJournalFillToken } from "@/lib/journal-fill";
import { journalFillHints } from "@/lib/journal-fill-hints";
import { isNameSuggestionScope } from "@/lib/name-suggestions";
import { rememberNames } from "@/lib/name-suggestions-db";
import { normalizeQrFillMode, resolveQrFillActor } from "@/lib/qr-fill-actor";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey, recordQrFillAudit } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyWithQrAppend } from "@/lib/tasksflow-adapters/row-key";
import { buildCompletionValidator } from "@/lib/tasksflow-adapters/task-form";
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
  pin?: string | null;
  /** PIN уже проверен на отдельном шаге (HTML-форма, cookie-пропуск). */
  pinVerified?: boolean;
  openedAt?: number | null;
};

export type JournalFillSubmitResult =
  | { ok: false; status: number; error: string }
  | { ok: true; mode: "appended" | "updated"; documentTitle: string; employeeName: string; employeeId: string };

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
    // PIN уже подтверждён отдельным шагом — сотрудника ищем как в публичном режиме.
    mode: mode === "pin" && input.pinVerified ? "public" : mode,
    organizationId: orgId,
    employeeId: input.employeeId,
    pin: input.pin,
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
  let values: Record<string, string | number | boolean | null> = {};
  if (schema) {
    try {
      values = buildCompletionValidator(schema).parse(input.values) as typeof values;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues[0];
        const key = Array.isArray(issue?.path) ? issue?.path[0] : null;
        const label = schema.fields.find((field) => field.key === key)?.label ?? "поле";
        return { ok: false, status: 400, error: `Проверьте «${label}»: ${issue?.message ?? "некорректное значение"}` };
      }
      throw error;
    }
  }

  const applied = await adapter.applyRemoteCompletion({
    documentId: input.documentId,
    rowKey: hints.append ? rowKeyWithQrAppend(input.rowKey) : input.rowKey,
    completed: true,
    todayKey,
    values,
  });
  if (!applied) return { ok: false, status: 500, error: "Не удалось записать в журнал" };

  // Память наименований — по карте подсказок журнала.
  if (hints.nameFields) {
    const byScope = new Map<string, { values: string[]; meta: Record<string, unknown> }>();
    for (const [key, scope] of Object.entries(hints.nameFields)) {
      const value = values[key];
      if (typeof value !== "string" || value.trim() === "") continue;
      const bucket = byScope.get(scope) ?? { values: [], meta: {} };
      bucket.values.push(value);
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

  return { ok: true, mode: isShared ? "appended" : "updated", documentTitle: document.title, employeeName: actor.employee.name, employeeId: actor.employee.id };
}
