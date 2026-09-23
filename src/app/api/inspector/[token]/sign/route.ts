import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  inspectorClientIp,
  inspectorLimitKey,
  inspectorPdfLimiter,
  inspectorViewerCookie,
  loadInspectorAccess,
  logInspectorEvent,
} from "@/lib/inspector-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Кто смотрит» на портале проверяющего.
 *
 * POST /api/inspector/[token]/sign
 * Body: { inspectorName?: string, templatesViewed?: string[] }
 *
 * Без входа — только токен. Пишем `InspectorVisit` (визит виден в
 * кабинете), строку `inspector.introduce` в журнал действий и ставим
 * cookie с именем, чтобы дальнейшие просмотры в журнале действий были
 * подписаны «Проверяющий: <ФИО>». Данные организации не меняются.
 */
const Schema = z.object({
  inspectorName: z.string().trim().min(2).max(160).optional(),
  templatesViewed: z.array(z.string().max(80)).max(40).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const access = await loadInspectorAccess(token);
  if (access.status === "not_found") {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (access.status !== "ok") {
    return NextResponse.json({ error: "Доступ отозван или истёк" }, { status: 410 });
  }
  const ip = inspectorClientIp(request.headers);
  if (!inspectorPdfLimiter.consume(inspectorLimitKey(access.token.id, ip))) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Укажите ФИО и должность (от 2 до 160 символов)" }, { status: 400 });
    }
    throw err;
  }

  const name = body.inspectorName?.replace(/\s+/g, " ") ?? null;
  const visit = await db.inspectorVisit.create({
    data: {
      tokenId: access.token.id,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      inspectorName: name,
      templatesViewed: body.templatesViewed ?? [],
    },
  });
  await logInspectorEvent({
    access,
    headers: request.headers,
    action: "inspector.introduce",
    viewer: name,
    details: { kind: "introduce", visitId: visit.id },
  });

  const response = NextResponse.json({
    ok: true,
    visitId: visit.id,
    signedAt: visit.signedAt.toISOString(),
  });
  if (name) {
    // Next сам кодирует значение cookie (encodeURIComponent) — кладём как есть.
    response.cookies.set(inspectorViewerCookie(access.token.id), name, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return response;
}
