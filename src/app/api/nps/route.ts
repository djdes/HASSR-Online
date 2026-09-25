import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canEditNpsResponse, isNpsScoreOnScale, normalizeNpsScale, npsScaleRange, parseNpsAnswer, parseNpsUpdate } from "@/lib/nps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    select: { id: true, scale: true, createdAt: true },
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
  return NextResponse.json({ ok: true });
}
