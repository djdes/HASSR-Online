import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canUseInspectionVisits } from "@/lib/inspection-visits";
import {
  attachInspectionVisitFiles,
  checkInspectionVisitFiles,
  inspectionVisitRequestSizeError,
  visitFilesFromForm,
} from "@/lib/inspection-visits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Приложить скан основания к уже внесённому посещению (проверяющий записал
 * себя по QR без скана — руководитель фотографирует решение сам).
 * POST multipart: file (1–5 шт., всего у посещения не больше 5 — пересчёт
 * под блокировкой записи, параллельные загрузки предел не обойдут).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!canUseInspectionVisits(session.user)) {
    return NextResponse.json({ error: "Журнал посещений доступен руководству" }, { status: 403 });
  }
  const sizeError = inspectionVisitRequestSizeError(request);
  if (sizeError) return sizeError;
  const organizationId = getActiveOrgId(session);
  const { id } = await ctx.params;
  const visit = /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? await db.inspectionVisit.findUnique({
        where: { id },
        select: { id: true, organizationId: true, _count: { select: { files: true } } },
      })
    : null;
  if (!visit || visit.organizationId !== organizationId) {
    return NextResponse.json({ error: "Посещение не найдено" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать файл — попробуйте ещё раз" }, { status: 400 });
  }
  const incoming = visitFilesFromForm(form);
  if (incoming.length === 0) return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
  // Быстрый отказ по уже известному числу файлов; окончательно — под блокировкой.
  const files = await checkInspectionVisitFiles(incoming, visit._count.files);
  if (!files.ok) return NextResponse.json({ error: files.error }, { status: files.status });

  const attached = await attachInspectionVisitFiles({
    visitId: visit.id,
    organizationId,
    files: files.files,
    uploadedByName: session.user.name ?? null,
  });
  if (!attached.ok) return NextResponse.json({ error: attached.error }, { status: attached.status });

  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "inspection_visit.attach",
    entity: "InspectionVisit",
    entityId: visit.id,
    details: { files: files.files.map((file) => ({ name: file.fileName, mime: file.mimeType, size: file.bytes.length })) },
  });
  return NextResponse.json({ ok: true, added: attached.added }, { status: 201 });
}
