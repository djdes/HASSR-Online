import { describeHardwareConfig, hardwareTotal } from "@/lib/hardware-pricing";
import type { PlatformServiceItem } from "./constants";

/**
 * Доставка уже подключённого к аккаунту оборудования — возможность тарифа
 * «Премиум» (тарифы 2026-10). Заказ из кабинета — заявка в общем списке
 * услуг (`ServiceRequest`, ROOT → «Заявки на услуги»), но в каталоге услуг
 * её нет: состав и сумма собираются из прайса оборудования
 * (`hardware-pricing.ts`), а не правятся в админке.
 *
 * Client-safe: без prisma и node-api.
 */

export const EQUIPMENT_DELIVERY_SERVICE_KEY = "equipment-delivery";

/** Услуга для заявки: сумма — по прайсу, «от» — доставку и монтаж уточняет менеджер. */
export function equipmentDeliveryService(config: Record<string, number>): PlatformServiceItem {
  return {
    key: EQUIPMENT_DELIVERY_SERVICE_KEY,
    title: "Доставка подключённого оборудования",
    summary: "Датчики и планшет приезжают уже привязанными к аккаунту.",
    description: "Заявка из кабинета, тариф «Премиум».",
    priceRub: hardwareTotal(config),
    priceFrom: true,
    unit: null,
    category: "setup",
    active: true,
    sort: 0,
  };
}

/** Текст заявки для админа: адрес, состав по прайсу, комментарий клиента. */
export function equipmentDeliveryComment(args: {
  config: Record<string, number>;
  address: string | null;
  comment: string | null;
}): string {
  return [
    args.address ? `Адрес доставки: ${args.address}` : null,
    "Состав:",
    ...describeHardwareConfig(args.config).map((line) => `• ${line}`),
    `Итого по прайсу: ${hardwareTotal(args.config).toLocaleString("ru-RU")} ₽`,
    args.comment ? `Комментарий: ${args.comment}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
