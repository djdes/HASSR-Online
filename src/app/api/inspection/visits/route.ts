import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { canUseInspectionVisits, parseInspectionVisitFields, parseVisitedAt } from "@/lib/inspection-visits";
import {
  checkInspectionVisitFiles,
  createInspectionVisit,
  inspectionVisitRequestSizeError,
  listInspectionVisits,
  visitFilesFromForm,
} from "@/lib/inspection-visits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Журнал посещений в кабинете («Пришла проверка»).
 *
 *   GET  — список посещений организации (без файлов); `?hidden=1` — со скрытыми.
 *   POST — multipart: поля посещения, visitedAt? (ISO), file (0–5 шт.).
 *          Запись вносит руководство или заведующая, если проверяющий не
 *          внёс её сам по QR.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!canUseInspectionVisits(auth.session.user)) {
    return NextResponse.json({ error: "Журнал посещений доступен руководству" }, { status: 403 });
  }
  const includeHidden = new URL(request.url).searchParams.get("hidden") === "1";
  const visits = await listInspectionVisits(getActiveOrgId(auth.session), { includeHidden });
  return NextResponse.json({ visits }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!canUseInspectionVisits(session.user)) {
    return NextResponse.json({ error: "Журнал посещений доступен руководству" }, { status: 403 });
  }
  const sizeError = inspectionVisitRequestSizeError(request);
  if (sizeError) return sizeError;
  const organizationId = getActiveOrgId(session);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать форму — попробуйте ещё раз" }, { status: 400 });
  }
  const parsed = parseInspectionVisitFields(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const visitedAt = parseVisitedAt(form.get("visitedAt"));
  if (!visitedAt.ok) return NextResponse.json({ error: visitedAt.error, field: "visitedAt" }, { status: 400 });

  const files = await checkInspectionVisitFiles(visitFilesFromForm(form));
  if (!files.ok) return NextResponse.json({ error: files.error, field: "file" }, { status: files.status });

  const visit = await createInspectionVisit({
    organizationId,
    source: "manager",
    fields: parsed.fields,
    visitedAt: visitedAt.date,
    files: files.files,
    createdById: session.user.id,
    createdByName: session.user.name ?? null,
  });
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "inspection_visit.create",
    entity: "InspectionVisit",
    entityId: visit.id,
    details: {
      authority: parsed.fields.authority,
      kind: parsed.fields.kind,
      basisNumber: parsed.fields.basisNumber,
      files: visit.files.length,
    },
  });
  return NextResponse.json({ ok: true, visitId: visit.id, files: visit.files.length }, { status: 201 });
}
