import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { ReviewRequestError, requestReview } from "@/lib/review-requests.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { organizationId } — ROOT → «Отзывы» → «Попросить отзыв»: письмо
 * главному руководителю со ссылкой на форму отзыва (2026-11-07). Повтор
 * раньше 30 дней, заведение с отзывом или без активности — 409, без
 * руководителя с почтой — 422.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown } | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId.trim() : "";
  if (!organizationId || organizationId.length > 64) {
    return NextResponse.json({ error: "Не указана организация" }, { status: 400 });
  }
  try {
    const result = await requestReview({ organizationId, actorUserId: session.user.id });
    return NextResponse.json({ ok: true, email: result.email });
  } catch (error) {
    if (error instanceof ReviewRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(`[reviews] просьба об отзыве не ушла: org=${organizationId}`, error);
    return NextResponse.json({ error: "Не удалось отправить письмо" }, { status: 500 });
  }
}
