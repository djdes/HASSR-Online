import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  listEmployeeDailyStatus,
  listJournalFillDocuments,
  loadJournalFillForm,
  loadOrganizationForFill,
  resolveJournalFillRows,
  todayKeyFor,
  verifyJournalFillToken,
} from "@/lib/journal-fill";
import { submitJournalFill } from "@/lib/journal-fill-submit";
import { ensureQrPeriodDocuments, qrRolloverMessage, resolveTokenDocumentIds } from "@/lib/journal-qr-rollover";
import { rowKeyForEmployee } from "@/lib/tasksflow-adapters/row-key";
import { journalFillHints } from "@/lib/journal-fill-hints";
import { isNameSuggestionScope } from "@/lib/name-suggestions";
import { listNameSuggestions } from "@/lib/name-suggestions-db";

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

  const requestedDocumentId = url.searchParams.get("documentId") ?? "";
  if (!requestedDocumentId || !employeeId) return NextResponse.json({ error: "Не указан документ или сотрудник" }, { status: 400 });
  let documentId = requestedDocumentId;
  let docs = await listJournalFillDocuments(orgId, code, todayKey);
  if (!docs.some((doc) => doc.id === documentId)) {
    // Период сменился, пока форма была открыта: документ нового периода той
    // же линии (создаётся по образцу прошлого, как у ночного крона).
    const rollover = await ensureQrPeriodDocuments({ organizationId: orgId, templateCode: code, todayKey, anchor: { documentId }, source: "journal-fill-api" });
    const lineage = await resolveTokenDocumentIds({ organizationId: orgId, templateCode: code, todayKey, tokenDocumentId: documentId });
    docs = await listJournalFillDocuments(orgId, code, todayKey);
    const successor = lineage.documentIds.length === 1 ? docs.find((doc) => doc.id === lineage.documentIds[0]) : undefined;
    if (!successor) {
      return NextResponse.json(
        { error: "Документ не активен", reason: lineage.reason ?? rollover.reason ?? null, message: qrRolloverMessage(lineage.reason === "period-closed" ? lineage.reason : rollover.reason) },
        { status: 404 }
      );
    }
    documentId = successor.id;
  }

  const rowKeyParam = url.searchParams.get("rowKey");
  const resolved = await resolveJournalFillRows({ orgId, code, documentId, employeeId });
  const rowKey = resolved.perEmployee ? rowKeyForEmployee(employeeId) : rowKeyParam || null;
  if (!rowKey) return NextResponse.json({ documentId, rows: resolved.rows, form: null, rowKey: null });
  if (!resolved.perEmployee && !resolved.rows.some((row) => row.rowKey === rowKey)) {
    return NextResponse.json({ error: "Строка не найдена" }, { status: 404 });
  }
  const form = await loadJournalFillForm(code, documentId, rowKey);
  const template = await db.journalTemplate.findFirst({ where: { code }, select: { taskScope: true } });
  return NextResponse.json({
    // Может отличаться от запрошенного: период сменился — документ-преемник.
    documentId,
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
  // Общее ядро с HTML-формой `/journal-fill/…` (лимитер, токен, режим, запись, аудит).
  const result = await submitJournalFill({
    request,
    orgId,
    code,
    token: body.token,
    documentId: body.documentId,
    employeeId: body.employeeId,
    rowKey: body.rowKey,
    values: body.values,
    pin: body.pin,
    openedAt: body.openedAt ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ mode: result.mode, documentTitle: result.documentTitle, employeeName: result.employeeName });
}
