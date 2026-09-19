import { NextResponse } from "next/server";
import { z } from "zod";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import {
  isRowKeyAllowed,
  listEmployeeDailyStatus,
  listJournalFillDocuments,
  loadJournalFillForm,
  loadOrganizationForFill,
  resolveJournalFillRows,
  todayKeyFor,
  verifyJournalFillToken,
} from "@/lib/journal-fill";
import { journalFillHints } from "@/lib/journal-fill-hints";
import { listNameSuggestions, rememberNames } from "@/lib/name-suggestions-db";
import { isNameSuggestionScope } from "@/lib/name-suggestions";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey, recordQrFillAudit } from "@/lib/qr-fill-audit";
import { normalizeQrFillMode, resolveQrFillActor } from "@/lib/qr-fill-actor";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyForEmployee, rowKeyWithQrAppend } from "@/lib/tasksflow-adapters/row-key";
import { buildCompletionValidator } from "@/lib/tasksflow-adapters/task-form";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string; code: string }> }) {
  const { orgId, code } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const check = verifyJournalFillToken(token, orgId, code);
  if (!check.ok) return NextResponse.json({ error: "QR-код недействителен" }, { status: 401 });
  const org = await loadOrganizationForFill(orgId);
  if (!org) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const todayKey = todayKeyFor(org.timezone);

  const scope = url.searchParams.get("scope");
  if (scope) {
    if (!isNameSuggestionScope(scope)) return NextResponse.json({ error: "Неизвестная область" }, { status: 400 });
    return NextResponse.json(await listNameSuggestions(orgId, scope));
  }

  const employeeId = url.searchParams.get("employeeId") ?? "";
  if (url.searchParams.get("daily") === "1") {
    if (!employeeId) return NextResponse.json({ error: "Не указан сотрудник" }, { status: 400 });
    const daily = await listEmployeeDailyStatus({ orgId, employeeId, disabledCodes: org.disabledJournalCodes as string[], todayKey });
    return NextResponse.json({ daily });
  }

  const documentId = url.searchParams.get("documentId") ?? "";
  if (!documentId || !employeeId) return NextResponse.json({ error: "Не указан документ или сотрудник" }, { status: 400 });
  const docs = await listJournalFillDocuments(orgId, code, todayKey);
  if (!docs.some((doc) => doc.id === documentId)) return NextResponse.json({ error: "Документ не активен" }, { status: 404 });

  const rowKeyParam = url.searchParams.get("rowKey");
  const resolved = await resolveJournalFillRows({ orgId, code, documentId, employeeId });
  const rowKey = resolved.perEmployee ? rowKeyForEmployee(employeeId) : rowKeyParam || null;
  if (!rowKey) return NextResponse.json({ rows: resolved.rows, form: null, rowKey: null });
  if (!resolved.perEmployee && !resolved.rows.some((row) => row.rowKey === rowKey)) {
    return NextResponse.json({ error: "Строка не найдена" }, { status: 404 });
  }
  const form = await loadJournalFillForm(code, documentId, rowKey);
  const template = await db.journalTemplate.findFirst({ where: { code }, select: { taskScope: true } });
  return NextResponse.json({
    rows: resolved.rows,
    rowKey,
    form,
    taskScope: template?.taskScope ?? "personal",
    hints: journalFillHints(code),
  });
}

const bodySchema = z.object({
  token: z.string().min(10),
  documentId: z.string().min(1),
  employeeId: z.string().min(1),
  rowKey: z.string().min(1),
  values: z.record(z.string(), z.unknown()).default({}),
  pin: z.string().max(12).optional(),
  openedAt: z.number().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string; code: string }> }) {
  const { orgId, code } = await params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "journal", body.documentId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }
  const check = verifyJournalFillToken(body.token, orgId, code);
  if (!check.ok) return NextResponse.json({ error: "QR-код недействителен" }, { status: 401 });
  const org = await loadOrganizationForFill(orgId);
  if (!org) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const mode = normalizeQrFillMode(org.qrFillMode);
  const todayKey = todayKeyFor(org.timezone);

  const docs = await listJournalFillDocuments(orgId, code, todayKey);
  const document = docs.find((doc) => doc.id === body.documentId);
  if (!document) return NextResponse.json({ error: "На сегодня нет активного документа этого журнала" }, { status: 409 });

  const actor = await resolveQrFillActor({ mode, organizationId: orgId, employeeId: body.employeeId, pin: body.pin });
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  if (!(await isRowKeyAllowed({ orgId, code, documentId: body.documentId, employeeId: actor.employee.id, rowKey: body.rowKey }))) {
    return NextResponse.json({ error: "Строка не найдена" }, { status: 404 });
  }

  const adapter = getAdapter(code);
  if (!adapter) return NextResponse.json({ error: "Журнал не поддерживается" }, { status: 400 });
  const template = await db.journalTemplate.findFirst({ where: { code }, select: { id: true, taskScope: true } });
  const hints = journalFillHints(code);
  // Строчные журналы: каждая запись по QR — новая строка, не upsert по сотруднику.
  const isShared = template?.taskScope === "shared" || hints.append === true;

  // Гейт «только администраторы правят выполненное»: повторная отметка
  // за сегодня линейным сотрудником — как в /api/task-fill.
  if (!isShared && org.requireAdminForJournalEdit && !isManagementRole(actor.employee.role)) {
    const existing = await db.journalDocumentEntry.findFirst({
      where: { documentId: body.documentId, employeeId: actor.employee.id, date: new Date(`${todayKey}T00:00:00.000Z`) },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Сегодня вы уже отметились. Изменить запись может только руководитель." },
        { status: 403 }
      );
    }
  }

  const schema = await loadJournalFillForm(code, body.documentId, body.rowKey);
  let values: Record<string, string | number | boolean | null> = {};
  if (schema) {
    try {
      values = buildCompletionValidator(schema).parse(body.values) as typeof values;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues[0];
        const key = Array.isArray(issue?.path) ? issue?.path[0] : null;
        const label = schema.fields.find((field) => field.key === key)?.label ?? "поле";
        return NextResponse.json({ error: `Проверьте «${label}»: ${issue?.message ?? "некорректное значение"}` }, { status: 400 });
      }
      throw error;
    }
  }

  const applied = await adapter.applyRemoteCompletion({
    documentId: body.documentId,
    rowKey: hints.append ? rowKeyWithQrAppend(body.rowKey) : body.rowKey,
    completed: true,
    todayKey,
    values,
  });
  if (!applied) return NextResponse.json({ error: "Не удалось записать в журнал" }, { status: 500 });

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
    objectId: body.documentId,
    objectName: document.title,
    employee: { id: actor.employee.id, name: actor.employee.name },
    documentIds: [body.documentId],
    dateKey: todayKey,
    authMode: mode,
    values,
  });

  if (template && typeof body.openedAt === "number" && body.openedAt > 0) {
    const durationMs = Date.now() - body.openedAt;
    if (durationMs > 0 && durationMs < 6 * 60 * 60 * 1000) {
      await db.formFillTiming
        .create({ data: { organizationId: orgId, templateId: template.id, userId: actor.employee.id, durationMs, source: mode === "auth" ? "qr-journal-auth" : "qr-journal" } })
        .catch(() => null);
    }
  }

  return NextResponse.json({ mode: isShared ? "appended" : "updated", documentTitle: document.title, employeeName: actor.employee.name });
}
