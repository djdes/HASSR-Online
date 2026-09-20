import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  asDismissedItemIds,
  asNotificationItems,
} from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/notifications/[id]
 *
 * Body вариантов:
 *   - {} (пустой)            — «Прочитать всю задачу»: ставит readAt=now.
 *   - { dismissedItemIds: [...] } — «Прочитать выбранные подзадачи»:
 *      добавляет id-шники в Notification.dismissedItemIds (union).
 *      Если после этого в items не осталось живых подзадач — readAt
 *      также проставляется автоматически (нечего больше показывать).
 *
 * 404 если запись не принадлежит вызывающему.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  const { id } = await context.params;
  const existing = await db.notification.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      items: true,
      dismissedItemIds: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const incomingDismissed = Array.isArray(body?.dismissedItemIds)
    ? (body.dismissedItemIds as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.length > 0
      )
    : null;

  if (incomingDismissed && incomingDismissed.length > 0) {
    // Per-item «прочитать»: union с существующими.
    const merged = new Set<string>([
      ...asDismissedItemIds(existing.dismissedItemIds),
      ...incomingDismissed,
    ]);
    const allItemIds = asNotificationItems(existing.items).map((it) => it.id);
    const allDismissed =
      allItemIds.length > 0 && allItemIds.every((id) => merged.has(id));
    await db.notification.update({
      where: { id },
      data: {
        dismissedItemIds: Array.from(merged) as object,
        // Если после dismiss'а не осталось ни одной живой подзадачи —
        // считаем всю нотификацию прочитанной (UI «Прочитать одну
        // подзадачу из десяти» эскалируется до полного read, когда
        // юзер пометит все).
        readAt: allDismissed ? new Date() : undefined,
      },
    });
    return NextResponse.json({ ok: true, dismissedCount: incomingDismissed.length });
  }

  // Default — старое поведение «прочитать всю задачу».
  await db.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/notifications/[id] — «Удалить»: dismisses the row so it
 * disappears from both «Новые» и «Прочитанные».
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  const { id } = await context.params;
  const existing = await db.notification.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  const now = new Date();
  await db.notification.update({
    where: { id },
    data: { dismissedAt: now, readAt: now },
  });
  return NextResponse.json({ ok: true });
}
