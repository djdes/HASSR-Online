/**
 * Оформление заявки на платную услугу.
 *
 * Один путь на два сценария, потому что заявка нужна в обоих:
 *
 *  1. Цена фиксированная, заказывает руководитель, баллов хватает —
 *     списываем сразу и заводим оплаченную заявку.
 *  2. Всё остальное (цена «от N ₽» или «по запросу», баллов не хватает,
 *     заявка с публичного сайта без авторизации) — заводим заявку без
 *     оплаты, деньги обсуждаются отдельно.
 *
 * Разница только в поле `paidRub`; админ в обоих случаях получает одно
 * и то же уведомление и видит один список.
 */

import { db } from "@/lib/db";
import {
  applyBalanceChange,
  DuplicateBalanceChangeError,
  InsufficientBalanceError,
} from "@/lib/balance/ledger";
import {
  notifyPlatformAdmin,
  sendToPlatformAdminEmails,
} from "@/lib/platform-admin";
import { sendRawEmail } from "@/lib/email";
import { formatServicePrice, isInstantPayable, type PlatformServiceItem } from "./catalog";

export type ServiceRequestInput = {
  service: PlatformServiceItem;
  organizationId: string | null;
  organizationName: string | null;
  userId: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  comment: string | null;
  source: "app" | "site";
  /**
   * Пользователь нажал «Оплатить баллами». Проверку прав и остатка
   * делаем здесь ещё раз: кнопку можно нажать из консоли.
   */
  payFromBalance: boolean;
  /** Прошёл ли заказчик проверку прав руководителя. */
  canSpend: boolean;
};

export type ServiceRequestResult = {
  id: string;
  paidRub: number;
  /** Почему не списали, когда просили. null — вопрос не стоял. */
  paymentSkippedReason: "not_payable" | "no_rights" | "insufficient" | null;
};

/**
 * Заводит заявку и, если нужно и возможно, списывает баллы.
 *
 * Списание и создание заявки — одна транзакция: иначе при падении
 * между ними клиент остался бы без баллов и без заявки.
 */
export async function createServiceRequest(
  input: ServiceRequestInput
): Promise<ServiceRequestResult> {
  const price = input.service.priceRub ?? 0;

  let paymentSkippedReason: ServiceRequestResult["paymentSkippedReason"] = null;
  let shouldPay = false;

  if (input.payFromBalance) {
    if (!isInstantPayable(input.service)) paymentSkippedReason = "not_payable";
    else if (!input.canSpend || !input.organizationId) paymentSkippedReason = "no_rights";
    else shouldPay = true;
  }

  const baseData = {
    serviceKey: input.service.key,
    serviceTitle: input.service.title,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    userId: input.userId,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    comment: input.comment,
    source: input.source,
  };

  let created: { id: string; paidRub: number };

  if (shouldPay && input.organizationId) {
    try {
      created = await db.$transaction(async (tx) => {
        const row = await tx.serviceRequest.create({
          data: { ...baseData, paidRub: price },
          select: { id: true, paidRub: true },
        });
        // dedupeKey привязан к id заявки: повторный вызов создаст новую
        // заявку с новым id, и это честно — человек заказал дважды.
        await applyBalanceChange(tx, {
          organizationId: input.organizationId!,
          amount: -price,
          kind: "service_spend",
          description: `Услуга: ${input.service.title}`,
          dedupeKey: `service_spend:${row.id}`,
          actorUserId: input.userId,
        });
        return row;
      });
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        // Баллов не хватило — заявка всё равно нужна, просто без оплаты.
        paymentSkippedReason = "insufficient";
        created = await db.serviceRequest.create({
          data: { ...baseData, paidRub: 0 },
          select: { id: true, paidRub: true },
        });
      } else if (error instanceof DuplicateBalanceChangeError) {
        // Теоретически недостижимо (dedupeKey строится из свежего id),
        // но молча терять заявку нельзя.
        created = await db.serviceRequest.create({
          data: { ...baseData, paidRub: 0 },
          select: { id: true, paidRub: true },
        });
      } else {
        throw error;
      }
    }
  } else {
    created = await db.serviceRequest.create({
      data: { ...baseData, paidRub: 0 },
      select: { id: true, paidRub: true },
    });
  }

  await notifyAdmin({ ...input, requestId: created.id, paidRub: created.paidRub });

  return {
    id: created.id,
    paidRub: created.paidRub,
    paymentSkippedReason,
  };
}

/**
 * Уведомление владельцу: Telegram и почта.
 *
 * Отметки о доставке пишем в саму заявку — по ним в /root/service-requests
 * видно, что канал промолчал, а не только по console.error.
 * Ошибки отправки не роняют запрос: заявка уже в базе, и потерять её
 * из-за недоступного Telegram нельзя.
 */
async function notifyAdmin(
  input: ServiceRequestInput & { requestId: string; paidRub: number }
): Promise<void> {
  const priceLine =
    input.paidRub > 0
      ? `Оплачено баллами: ${input.paidRub.toLocaleString("ru-RU")} ₽`
      : `Цена по прайсу: ${formatServicePrice(input.service)} (не оплачено)`;

  const lines = [
    "🧾 Заявка на услугу",
    "",
    `Услуга: ${input.service.title}`,
    priceLine,
    `Организация: ${input.organizationName ?? "не указана (заявка с сайта)"}`,
    `Контакт: ${input.contactName}, ${input.contactPhone}`,
    input.contactEmail ? `Почта: ${input.contactEmail}` : null,
    input.comment ? `Комментарий: ${input.comment}` : null,
  ].filter(Boolean) as string[];

  const text = lines.join("\n");

  const tgOk = await notifyPlatformAdmin(text, {
    kind: "service",
    dedupeKey: input.requestId,
    audience: "sales",
    // Своё письмо — ниже, всем администраторам.
    email: false,
  }).catch(() => false);

  let emailOk = false;
  {
    const html = `<h2>Заявка на услугу</h2><p>${lines
      .slice(2)
      .map((line) => escapeHtml(line))
      .join("<br>")}</p>`;
    emailOk = await sendToPlatformAdminEmails((to) =>
      sendRawEmail(to, `Заявка на услугу: ${input.service.title}`, html),
      "sales"
    ).catch(() => false);
  }

  await db.serviceRequest
    .update({
      where: { id: input.requestId },
      data: {
        adminTgNotifiedAt: tgOk ? new Date() : null,
        adminEmailedAt: emailOk ? new Date() : null,
      },
    })
    .catch((error) => {
      console.error("[services] не удалось отметить доставку заявки:", error);
    });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
