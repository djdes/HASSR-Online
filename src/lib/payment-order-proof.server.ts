import { db } from "@/lib/db";
import {
  formatOutSum,
  verifySuccessSignature,
  verifyPaymentRequestSignature,
} from "@/lib/robokassa";

/**
 * Заказ по доказательству из адреса возврата с оплаты: подписи success-редиректа
 * Робокассы (`OutSum`, `InvId`, `SignatureValue`) или подписи запроса оплаты
 * (`invId`, `psig`), которую страница оформления получила при создании заказа.
 * Без доказательства — null: перебором InvId нельзя узнать, кто и на сколько
 * платил. Общий для статуса заказа и повторной отправки ссылки на достройку.
 */
export async function findOrderByReturnProof(url: URL) {
  // `psig` — подпись запроса оплаты, которую страница оформления получила
  // при создании заказа. Нужна, потому что при оплате в iFrame возврат на
  // SuccessURL происходит ВНУТРИ рамки: внешняя страница о нём не узнаёт и
  // должна сама опрашивать статус, пока клиент платит.
  const paymentSig = url.searchParams.get("psig");
  if (paymentSig) {
    const invId = Number(url.searchParams.get("invId") ?? "");
    if (!Number.isInteger(invId) || invId <= 0) return null;
    const order = await db.paymentOrder.findUnique({ where: { id: invId } });
    if (!order) return null;
    const ok = verifyPaymentRequestSignature({
      outSum: formatOutSum(order.amountRub.toString()),
      invId: String(invId),
      signature: paymentSig,
      isTest: order.isTest,
    });
    return ok ? order : null;
  }

  const outSum = url.searchParams.get("OutSum") ?? "";
  const invIdRaw = url.searchParams.get("InvId") ?? "";
  const signature = url.searchParams.get("SignatureValue") ?? "";
  const invId = Number(invIdRaw);

  if (!outSum || !signature || !Number.isInteger(invId) || invId <= 0) {
    return null;
  }

  const order = await db.paymentOrder.findUnique({ where: { id: invId } });
  if (!order) return null;
  if (formatOutSum(outSum) !== formatOutSum(order.amountRub.toString())) {
    return null;
  }
  const ok = verifySuccessSignature({
    outSum,
    invId: invIdRaw,
    signature,
    isTest: order.isTest,
  });
  return ok ? order : null;
}
