import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { composeLowNpsAlert, isLowNpsScore } from "@/lib/lead-alerts";
import { canEditNpsResponse, isNpsScoreOnScale, normalizeNpsScale, npsScaleRange, parseNpsAnswer, parseNpsUpdate, type NpsScale } from "@/lib/nps";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Низкая оценка — сразу админу в Telegram: позвонить, пока человек не ушёл.
 * Сбой Telegram ответ не ломает; `dedupeKey` не даёт повторить сообщение.
 */
function alertLowScore(args: {
  organizationId: string;
  userName: string;
  score: number;
  scale: NpsScale;
  comment: string | null;
  followUp: boolean;
  dedupeKey: string;
}): void {
  void (async () => {
    const organization = await db.organization.findUnique({ where: { id: args.organizationId }, select: { name: true } });
    await notifyPlatformAdmin(
      composeLowNpsAlert({
        organizationName: organization?.name ?? "—",
        userName: args.userName,
        score: args.score,
        scale: args.scale,
        comment: args.comment,
        followUp: args.followUp,
        escape: escapeTelegramHtml,
      }),
      { kind: "nps_low", dedupeKey: args.dedupeKey },
    );
  })().catch((error) => console.error("[nps] admin alert failed", error));
}

/**
 * POST { score, scale: 5, comment? } — ответ 1–5 (сохраняется сразу по клику, в ответе id);
 * POST { score, comment? } без scale — старый формат 0–10;
 * POST { dismiss: true } — «не сейчас» (спросим через 90 дней).
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  const parsed = parseNpsAnswer(await request.json().catch(() => ({})));
  const now = new Date();
  if (parsed.kind === "dismiss") {
    await db.user.update({ where: { id: session.user.id }, data: { npsAskedAt: now } });
    return NextResponse.json({ ok: true, dismissed: true });
  }
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.error }, { status: 400 });
  const [response] = await db.$transaction([
    db.npsResponse.create({
      data: { organizationId: session.user.organizationId, userId: session.user.id, score: parsed.score, scale: parsed.scale, comment: parsed.comment },
      select: { id: true },
    }),
    db.user.update({ where: { id: session.user.id }, data: { npsAskedAt: now } }),
  ]);
  if (isLowNpsScore(parsed.score, parsed.scale)) {
    alertLowScore({
      organizationId: session.user.organizationId,
      userName: session.user.name ?? session.user.email ?? "—",
      score: parsed.score,
      scale: parsed.scale,
      comment: parsed.comment,
      followUp: false,
      dedupeKey: `nps:${response.id}`,
    });
  }
  return NextResponse.json({ ok: true, id: response.id });
}

/**
 * PATCH { id, score?, comment? } — поправить свой ответ в течение суток:
 * сменить оценку (передумал между 3 и 5) или дописать «Что улучшить?».
 */
export async function PATCH(request: Request) {
  const session = await requireAuth();
  const parsed = parseNpsUpdate(await request.json().catch(() => ({})));
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.error }, { status: 400 });
  const existing = await db.npsResponse.findFirst({
    where: { id: parsed.id, userId: session.user.id },
    select: { id: true, scale: true, score: true, comment: true, createdAt: true },
  });
  if (!existing) return NextResponse.json({ error: "Ответ не найден — обновите страницу" }, { status: 404 });
  if (!canEditNpsResponse(existing.createdAt, new Date())) {
    return NextResponse.json({ error: "Этот ответ уже нельзя изменить" }, { status: 409 });
  }
  const scale = normalizeNpsScale(existing.scale);
  if (parsed.score !== undefined && !isNpsScoreOnScale(parsed.score, scale)) {
    const { min, max } = npsScaleRange(scale);
    return NextResponse.json({ error: `Оценка — от ${min} до ${max}` }, { status: 400 });
  }
  await db.npsResponse.update({
    where: { id: existing.id },
    data: {
      ...(parsed.score !== undefined ? { score: parsed.score } : {}),
      ...(parsed.comment !== undefined ? { comment: parsed.comment } : {}),
    },
  });
  // Оценку опустили до низкой — как новая низкая; к низкой дописали
  // комментарий — отдельным сообщением (по одному на ответ).
  const score = parsed.score ?? existing.score;
  const comment = parsed.comment !== undefined ? parsed.comment : existing.comment;
  if (isLowNpsScore(score, scale)) {
    const becameLow = parsed.score !== undefined && !isLowNpsScore(existing.score, scale);
    const commented = parsed.comment !== undefined && Boolean(parsed.comment?.trim());
    if (becameLow || commented) {
      alertLowScore({
        organizationId: session.user.organizationId,
        userName: session.user.name ?? session.user.email ?? "—",
        score,
        scale,
        comment,
        followUp: !becameLow,
        dedupeKey: becameLow ? `nps:${existing.id}` : `nps-comment:${existing.id}`,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
