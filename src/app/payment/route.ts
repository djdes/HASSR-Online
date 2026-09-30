import { NextRequest, NextResponse } from "next/server";
import { relativeRedirect } from "@/lib/relative-redirect";
import { db } from "@/lib/db";
import { formatOutSum, verifyResultSignature } from "@/lib/robokassa";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { settlePaidOrder } from "@/lib/balance/topup";

export const dynamic = "force-dynamic";

/**
 * ResultURL Робокассы.
 *
 * Адрес зафиксирован в кабинете магазина как `https://wesetup.ru/payment/`,
 * поэтому вебхук живёт здесь, а не в /api/* — URL-схему кабинета менять
 * не стали.
 *
 * Контракт Робокассы: в ответ строго `OK{InvId}` текстом. Любой другой
 * ответ считается неуспехом, и уведомление будет повторяться, поэтому на
 * уже обработанный заказ отвечаем тем же `OK` вместо ошибки.
 *
 * Endpoint публичный по своей природе. Защита: подпись Пароля #2, сверка
 * суммы с сохранённым заказом и атомарный переход pending → paid.
 */

function ok(invId: string): NextResponse {
  return new NextResponse(`OK${invId}`, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function bad(message: string): NextResponse {
  // Робокасса ретраит всё, что не OK; для битой подписи это и нужно —
  // пусть в кабинете останется след неуспешного уведомления.
  return new NextResponse(message, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("bad request");
  }

  const raw: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") raw[key] = value;
  }

  const outSum = raw.OutSum ?? raw.outSum ?? "";
  const invIdRaw = raw.InvId ?? raw.invId ?? "";
  const signature = raw.SignatureValue ?? raw.signatureValue ?? "";
  const invId = Number(invIdRaw);

  if (!outSum || !signature || !Number.isInteger(invId) || invId <= 0) {
    return bad("bad request");
  }

  const order = await db.paymentOrder.findUnique({ where: { id: invId } });
  if (!order) return bad("unknown order");

  // Сумма сверяется с сохранённой в заказе, а не берётся из уведомления,
  // иначе подменённый OutSum «оплатил» бы подписку на любую сумму.
  if (formatOutSum(outSum) !== formatOutSum(order.amountRub.toString())) {
    console.error(
      `robokassa: amount mismatch on order ${invId}: got ${outSum}, expected ${order.amountRub}`,
    );
    return bad("amount mismatch");
  }

  const signatureOk = verifyResultSignature({
    outSum,
    invId: invIdRaw,
    signature,
    isTest: order.isTest,
    receipt: raw.Receipt ?? null,
  });
  if (!signatureOk) {
    console.error(`robokassa: bad signature on order ${invId}`);
    return bad("bad signature");
  }

  // Идемпотентность: перевести в paid может только один запрос. Повторное
  // уведомление получит claimed = false и просто подтвердится. Пополнение
  // баланса зачисляется в той же транзакции (settlePaidOrder): заказ не
  // бывает «оплачен, но не зачислен», а сбой откатит оба — касса повторит.
  const settled = await settlePaidOrder({ orderId: invId, rawResult: raw });
  if (!settled.claimed) {
    // Заказ уже не «ожидает». Обычно это повторное уведомление по
    // оплаченному заказу — подтверждаем молча. Но если холд баллов
    // истёк и заказ закрыт как `expired`, а деньги всё-таки пришли,
    // разбирать это должен человек: баллы уже вернулись на баланс.
    const fresh = await db.paymentOrder.findUnique({
      where: { id: invId },
      select: { status: true },
    });
    if (fresh?.status === "expired") {
      await notifyPlatformAdmin(
        `⚠️ Оплата по истёкшему заказу №${invId} — разобрать вручную. Баллы по нему уже вернулись на баланс организации.`,
        { kind: "payment", dedupeKey: `expired-paid:${invId}` },
      ).catch((err) => console.error("expired order notify failed", err));
    }
    return ok(invIdRaw);
  }

  // Продление подписки, письма, партнёрские и реферальные начисления —
  // одной точкой, общей с оплатой баллами. Внутри всё best-effort:
  // деньги уже получены, и упавшая почта не должна ломать ответ кассе.
  await completePaidOrder(order);

  return ok(invIdRaw);
}

/**
 * Живой GET нужен, чтобы случайный переход по адресу из кабинета или
 * закладки не отдавал 405 — уводим человека на страницу заказа.
 */
export async function GET() {
  return relativeRedirect("/order");
}
