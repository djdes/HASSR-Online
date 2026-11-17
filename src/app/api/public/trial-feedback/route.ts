import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { isTrialFeedbackAnswer, normalizeTrialFeedbackComment } from "@/lib/trial-feedback";
import { recordTrialFeedback } from "@/lib/trial-feedback.server";
import { verifyTrialFeedbackToken } from "@/lib/trial-feedback-token";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Пять ответов в час на организацию — человек может уточнить комментарий, бот — нет.
const limiter = createRateLimiter({ tokensPerInterval: 5, intervalMs: 60 * 60 * 1000 });

/**
 * POST /api/public/trial-feedback `{ t, answer, comment? }` — ответ на письмо
 * «Удалось оценить электронные журналы?» (спека trial-emails-rename-2026-11).
 * Токен из письма подписан и несёт организацию и владельца; без него — 403.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const claims = verifyTrialFeedbackToken(typeof body?.t === "string" ? body.t : null);
  if (!claims) return NextResponse.json({ error: "Ссылка недействительна", errorCode: "bad_token" }, { status: 403 });
  if (!isTrialFeedbackAnswer(body?.answer)) {
    return NextResponse.json({ error: "Выберите ответ", errorCode: "answer_required" }, { status: 400 });
  }
  if (!limiter.consume(`trial-feedback:${claims.organizationId}`)) {
    return NextResponse.json({ error: "Слишком много ответов. Попробуйте позже", errorCode: "rate_limit" }, { status: 429 });
  }
  const ok = await recordTrialFeedback({
    organizationId: claims.organizationId,
    userId: claims.userId,
    answer: body.answer,
    comment: normalizeTrialFeedbackComment(body?.comment),
    ip: clientIp(request),
  }).catch((error) => {
    console.error("[trial-feedback] record failed", error);
    return false;
  });
  if (!ok) return NextResponse.json({ error: "Не получилось сохранить ответ", errorCode: "server_failure" }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
