import { NextResponse } from "next/server";

import {
  inspectorClientIp,
  inspectorLimitKey,
  inspectorTokenUploadLimiter,
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
  appendInspectionVisitId,
  cookieFromHeader,
  INSPECTION_VISIT_COOKIE_MAX_AGE,
  inspectionVisitCookieName,
} from "@/lib/inspection-visit-cookie";
import {
  checkInspectionVisitFiles,
  countTokenVisitsLastDay,
  createTokenInspectionVisit,
  inspectionVisitRequestSizeError,
  visitFilesFromForm,
} from "@/lib/inspection-visits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tooMany(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 429, headers: { "Retry-After": "600" } });
}

/**
 * Запись проверяющего в журнал посещений — без входа, только по токену QR.
 *
 * POST /api/inspector/[token]/visits — multipart: inspectorName,
 * inspectorPosition, authority, kind, kindNote?, basisNumber?, basisDate?
 * (YYYY-MM-DD), file (0–5 шт., PDF/JPG/PNG до 10 МБ, вместе до 25 МБ,
 * тип и размер картинки — по содержимому, PDF — в изолированном потоке).
 *
 * Неизвестный токен — 404, отозванный или истёкший — 410. Лимиты запросов
 * (токен+IP и один токен) тратятся до разбора формы; без Content-Length —
 * 411, больше предела — 413. Суточные лимиты записей и объёма сканов на
 * токен проверяются под блокировкой токена вместе с созданием записи.
 * Организация — только из токена. id записи добавляется в подписанную
 * cookie браузера: на портале проверяющий видит только свои записи.
 */
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const access = await loadInspectorAccess(token);
  if (access.status === "not_found") return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (access.status !== "ok") return NextResponse.json({ error: "Доступ отозван или истёк" }, { status: 410 });

  const tokenId = access.token.id;
  const ip = inspectorClientIp(request.headers);
  if (!inspectorUploadLimiter.consume(inspectorLimitKey(tokenId, ip)) || !inspectorTokenUploadLimiter.consume(tokenId)) {
    return tooMany("Слишком много запросов. Повторите через несколько минут.");
  }
  const sizeError = inspectionVisitRequestSizeError(request);
  if (sizeError) return sizeError;
  if ((await countTokenVisitsLastDay(tokenId)) >= INSPECTION_VISITS_PER_TOKEN_PER_DAY) {
    return tooMany(INSPECTION_VISIT_ERRORS.dailyLimit);
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
    console.warn("[inspection-visits] inspector upload rejected", { tokenId, reason: files.error });
    return NextResponse.json({ error: files.error, field: "file" }, { status: files.status });
  }

  const created = await createTokenInspectionVisit({
    organizationId: access.token.organizationId,
    tokenId,
    source: "inspector",
    fields: parsed.fields,
    files: files.files,
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
  });
  if (!created.ok) return tooMany(created.error);
  const { visit } = created;

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
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  response.cookies.set(inspectorViewerCookie(tokenId), `${name}, ${parsed.fields.inspectorPosition}`.slice(0, 160), {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 7,
  });
  const visitsCookie = inspectionVisitCookieName(tokenId);
  response.cookies.set(
    visitsCookie,
    appendInspectionVisitId(tokenId, cookieFromHeader(request.headers.get("cookie"), visitsCookie), visit.id),
    { ...cookieOptions, maxAge: INSPECTION_VISIT_COOKIE_MAX_AGE }
  );
  return response;
}
