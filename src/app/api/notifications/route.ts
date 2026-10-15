import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notificationPresenter } from "@/i18n/notification-messages";
import { resolveLocale } from "@/i18n/locales";
import {
  asDismissedItemIds,
  asNotificationItems,
  type NotificationItem,
} from "@/lib/notifications";

/**
 * Auto-migration старых notifications-items: если href в формате
 * `/journals/<code>` (старый, до фикса deep-link) или hint без
 * рекомендации — на лету переписываем в новый формат с deep-link и
 * подсказкой «Совет: ...».
 *
 * Безопасно — мы НЕ пишем обратно в БД, переписываем только в response.
 * При следующем upsertNotification (новый bulk-assign-today run)
 * persistent state обновится через merge.
 */
function migrateLegacyNotificationItem(
  kind: string,
  it: NotificationItem,
): NotificationItem {
  if (kind !== "tasksflow.bulk_assign.skipped") return it;
  if (!it.href) return it;
  let next = it;
  // 1. Перепишем href если старый формат `/journals/<code>`.
  if (!next.href!.startsWith("/settings/journal-responsibles?fix=")) {
    const m = next.href!.match(/^\/journals\/([^/?#]+)/);
    if (m) {
      const code = m[1];
      const reason = next.hint ? next.hint.slice(0, 120) : "";
      next = {
        ...next,
        href: `/settings/journal-responsibles?fix=${encodeURIComponent(code)}&reason=${encodeURIComponent(reason)}`,
      };
    }
  }
  // 2. Если hint без рекомендации (нет «Совет:») — добавим generic
  // подсказку. Реальная персонализированная рекомендация формируется
  // на server'е bulk-assign-today, а здесь — fallback для старых.
  if (next.hint && !next.hint.includes("Совет:")) {
    next = {
      ...next,
      hint: `${next.hint}. Открой настройку — система предложит кого назначить.`,
    };
  }
  return next;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — returns the current user's notification bucket,
 * split into «Новые» (unread) and «Прочитанные» (read), both excluding
 * dismissed rows.
 *
 * Подзадачи (items), id которых попал в `dismissedItemIds`, фильтруются
 * из items на уровне ответа. Клиент видит только живые подзадачи.
 */
export async function GET() {
  const session = await requireAuth();
  const locale = resolveLocale({ authenticated: true, userLocale: session.user.locale, organizationLocale: session.user.organizationLocale });
  const presenter = await notificationPresenter(locale);
  const rows = await db.notification.findMany({
    where: { userId: session.user.id, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const visible = rows.map((n) => {
    const dismissed = asDismissedItemIds(n.dismissedItemIds);
    const items = asNotificationItems(n.items)
      .filter((it) => !dismissed.has(it.id))
      .map((it) => migrateLegacyNotificationItem(n.kind, it));
    return presenter.row({ ...n, items });
  });
  // Если у нотификации не осталось «живых» подзадач — она автоматически
  // считается прочитанной (юзер вычистил все). Отделяем по readAt и по
  // пустому items для нотификаций, у которых items с самого начала был
  // массив подзадач (а не один общий title без items).
  const unread = visible.filter((n) => {
    if (n.readAt) return false;
    const original = asNotificationItems(rows.find((r) => r.id === n.id)?.items ?? []);
    if (original.length > 0 && n.items.length === 0) return false;
    return true;
  });
  const read = visible.filter((n) => {
    if (n.readAt) return true;
    const original = asNotificationItems(rows.find((r) => r.id === n.id)?.items ?? []);
    return original.length > 0 && n.items.length === 0;
  });
  return NextResponse.json({
    locale,
    unread,
    read,
    unreadCount: unread.length,
  }, { headers: { "Cache-Control": "private, no-store", "Content-Language": locale } });
}

/**
 * DELETE /api/notifications — «Удалить все»: dismisses every not-yet
 * dismissed row for the current user.
 */
export async function DELETE() {
  const session = await requireAuth();
  const now = new Date();
  await db.notification.updateMany({
    where: { userId: session.user.id, dismissedAt: null },
    data: { dismissedAt: now, readAt: now },
  });
  return NextResponse.json({ ok: true });
}
