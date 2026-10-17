import { NextResponse } from "next/server";

import {
  inspectorClientIp,
  inspectorLimitKey,
  inspectorUploadLimiter,
  inspectorViewerCookie,
  loadInspectorAccess,
  logInspectorEvent,
} from "@/lib/inspector-access";
import {
  INSPECTION_VISIT_ERRORS,
  INSPECTION_VISITS_PER_TOKEN_PER_DAY,
  parseInspectionVisitFields,
} from "@/lib/inspection-visits";
import {
  checkInspectionVisitFiles,
  countTokenVisitsLastDay,
  createInspectionVisit,
  inspectionVisitRequestTooBig,
  visitFilesFromForm,
} from "@/lib/inspection-visits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Запись проверяющего в журнал посещений — без входа, только по токену QR.
 *
 * POST /api/inspector/[token]/visits — multipart: inspectorName,
 * inspectorPosition, authority, kind, kindNote?, basisNumber?, basisDate?
 * (YYYY-MM-DD), file (0–5 шт., PDF/JPG/PNG до 10 МБ, тип по содержимому).
 *
 * Неизвестный токен — 404, отозванный или истёкший — 410. Лимит запросов
 * тратится до разбора формы. Организация берётся только из токена; данные
 * журналов не меняются. Имя проверяющего ставится в cookie «кто смотрит»,
 * как у прежней отметки о просмотре.
 */
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const access = await loadInspectorAccess(token);
  if (access.status === "not_found") return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (access.status !== "ok") return NextResponse.json({ error: "Доступ отозван или истёк" }, { status: 410 });

  const ip = inspectorClientIp(request.headers);
  if (!inspectorUploadLimiter.consume(inspectorLimitKey(access.token.id, ip))) {
    return NextResponse.json({ error: "Слишком много запросов. Повторите через несколько минут." }, { status: 429 });
  }
  if (inspectionVisitRequestTooBig(request)) {
    return NextResponse.json({ error: INSPECTION_VISIT_ERRORS.requestTooBig }, { status: 413 });
  }
  if ((await countTokenVisitsLastDay(access.token.id)) >= INSPECTION_VISITS_PER_TOKEN_PER_DAY) {
    return NextResponse.json({ error: INSPECTION_VISIT_ERRORS.dailyLimit }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать форму — попробуйте ещё раз" }, { status: 400 });
  }
  const parsed = parseInspectionVisitFields(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });

  const files = await checkInspectionVisitFiles(visitFilesFromForm(form));
  if (!files.ok) {
    console.warn("[inspection-visits] inspector upload rejected", { tokenId: access.token.id, reason: files.error });
    return NextResponse.json({ error: files.error, field: "file" }, { status: files.status });
  }

  const visit = await createInspectionVisit({
    organizationId: access.token.organizationId,
    tokenId: access.token.id,
    source: "inspector",
    fields: parsed.fields,
    files: files.files,
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
  });
  const name = parsed.fields.inspectorName;
  await logInspectorEvent({
    access,
    headers: request.headers,
    action: "inspector.visit",
    viewer: name,
    details: {
      kind: "visit",
      visitId: visit.id,
      authority: parsed.fields.authority,
      checkKind: parsed.fields.kind,
      files: visit.files.length,
    },
  });
  console.info("[inspection-visits] inspector visit", { organizationId: access.token.organizationId, id: visit.id, files: visit.files.length });

  const response = NextResponse.json(
    { ok: true, visitId: visit.id, visitedAt: visit.visitedAt.toISOString(), files: visit.files.length },
    { status: 201 }
  );
  response.cookies.set(inspectorViewerCookie(access.token.id), `${name}, ${parsed.fields.inspectorPosition}`.slice(0, 160), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
