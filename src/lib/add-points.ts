import { MAX_POINTS } from "@/lib/tariff-plans";

/**
 * «Добавить точку» одним шагом (серия D, Р12): кнопка в напоминании о конце
 * своих 14 дней организации (письмо, Telegram, колокольчик) ведёт на
 * страницу тарифа с `?addPoints=1`, и та сразу открывает выбор тарифа с
 * числом точек на одну больше оплаченного. Оплата — как обычно.
 */
export const ADD_POINTS_PARAM = "addPoints";
export const ADD_POINTS_HREF = `/settings/subscription?${ADD_POINTS_PARAM}=1`;

/** Метка в адресе: `addPoints=1` (повтор параметра — по первому значению). */
export function isAddPointsRequest(value: string | string[] | undefined | null): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "1";
}

/**
 * С какого числа точек открыть выбор тарифа: оплачено + 1, но не меньше
 * точек в работе (меньше счётчик не даёт). null — открыть страницу как
 * обычно: метки нет, тариф не оплачен или у него нет лимита точек (прежняя
 * «Подписка»).
 */
export function addPointsTarget(input: {
  requested: boolean;
  /** Оплачено точек у тарифа с лимитом; null — не оплачено или лимита нет. */
  paidPoints: number | null;
  pointsInUse: number;
}): number | null {
  if (!input.requested || input.paidPoints === null || !Number.isFinite(input.paidPoints)) return null;
  const paid = Math.max(1, Math.floor(input.paidPoints));
  const inUse = Math.max(1, Math.floor(Number(input.pointsInUse) || 1));
  return Math.min(MAX_POINTS, Math.max(paid + 1, inUse));
}

/** Адрес без метки — чтобы обновление страницы не открывало выбор снова. */
export function withoutAddPointsParam(href: string): string {
  const url = new URL(href, "http://localhost");
  url.searchParams.delete(ADD_POINTS_PARAM);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}
