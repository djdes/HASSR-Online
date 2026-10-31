import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findOrderByReturnProof } from "@/lib/payment-order-proof.server";
import { hashInviteToken } from "@/lib/invite-tokens";
import { isTopupOrder } from "@/lib/balance/topup-core";

export const dynamic = "force-dynamic";

/**
 * Статус заказа для страницы /order: пользователь возвращается с оплаты
 * раньше, чем приходит серверное уведомление, поэтому клиент поллит этот
 * endpoint, пока заказ не станет `paid`.
 *
 * Отдаём данные только тому, кто доказал право их видеть:
 *   • валидной success-подписью (Пароль #1) из редиректа Робокассы, либо
 *   • одноразовым токеном достройки профиля.
 * Иначе перебором InvId можно было бы узнать, кто и на сколько платил.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const completeToken = url.searchParams.get("complete");

  const order = completeToken
    ? await db.paymentOrder.findUnique({
        where: { completeTokenHash: hashInviteToken(completeToken) },
      })
    : await findOrderByReturnProof(url);

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  const tokenAlive =
    order.completeTokenHash !== null &&
    order.completeTokenExpiresAt !== null &&
    order.completeTokenExpiresAt.getTime() > Date.now() &&
    order.status !== "completed";

  return NextResponse.json({
    invId: order.id,
    status: order.status,
    email: order.email,
    amountRub: Number(order.amountRub),
    // Сколько закрыли баллами — страница показывает это рядом с суммой,
    // иначе «оплата 1 490 ₽» при цене 1 990 ₽ читается как недоплата.
    pointsSpent: order.pointsSpent,
    description: order.description,
    isTest: order.isTest,
    // Новому клиенту показываем форму достройки профиля; существующему —
    // просто «подписка продлена, войдите».
    needsCompletion: order.status === "paid" && tokenAlive,
    // Пополнение баланса — страница возврата пишет «Баланс пополнен» и
    // ведёт в «Баланс и бонусы», а не «подписка продлена».
    purpose: isTopupOrder(order) ? "topup" : "subscription",
    // Оплата не применена к тарифу (подписка изменилась после оформления) —
    // страница не пишет «подписка продлена».
    held: Boolean(order.heldAt),
  });
}
