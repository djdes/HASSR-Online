import { NextResponse } from "next/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";
import { clientIp } from "@/lib/client-ip";
import { OFFER_REVISION } from "@/lib/recurring-consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Отключение автопродления.
 *
 * Оферта (п. 13.5-13.6) обещает отказ «в любой момент и без объяснения
 * причин», немедленно и без подтверждений с нашей стороны — поэтому
 * здесь нет ни модалки, ни проверки «а точно ли». Оплаченный период при
 * этом сохраняется: `subscriptionPlan` и `subscriptionEnd` не трогаем.
 *
 * Включения тут НЕТ намеренно. Робокасса подключает рекуррент только на
 * первом платеже серии, и «включить» его на уже оплаченный период
 * технически невозможно — нужен новый платёж с галочкой согласия. Эту
 * дорогу UI ведёт на /order.
 */
const REVOKE_STATEMENT =
  "Отказ от автоматических списаний — кнопка «Отключить автопродление» в кабинете";

export async function DELETE(request: Request) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const orgId = getActiveOrgId(session);
  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: { recurringActive: true },
  });
  if (!organization) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }

  // Повторное нажатие — не ошибка, а тот же результат. Иначе человек,
  // кликнувший дважды, получил бы красный тост на успешном действии.
  if (!organization.recurringActive) {
    return NextResponse.json({ ok: true, recurringActive: false });
  }

  await db.organization.update({
    where: { id: orgId },
    data: {
      recurringActive: false,
      recurringDisabledAt: new Date(),
      // Счётчик неудачных списаний обнуляем: серия закончилась.
      recurringFailedAttempts: 0,
    },
  });

  // История согласий только пополняется — отзыв это новая строка, а не
  // правка старой: в споре о списании нужно показать обе даты.
  await db.paymentConsent.create({
    data: {
      email: session.user.email ?? "",
      organizationId: orgId,
      granted: false,
      statementText: REVOKE_STATEMENT,
      offerRevision: OFFER_REVISION,
      ipAddress: clientIp(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    },
  });

  await recordAuditLog({
    request,
    session,
    organizationId: orgId,
    action: "billing.recurring.disable",
    entity: "Organization",
    entityId: orgId,
  });

  return NextResponse.json({ ok: true, recurringActive: false });
}
