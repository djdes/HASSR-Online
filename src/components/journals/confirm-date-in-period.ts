"use client";

import { confirmAsync } from "@/components/ui/confirm-async";
import { describeDateOutsidePeriod } from "@/lib/date-in-period";

/**
 * Перед сохранением строки со свободной датой: если дата вне периода
 * документа — спросить через наш ConfirmDialog. Внутри периода (или без
 * даты/периода) — сразу `true`, окно не появляется.
 */
export async function confirmDateInPeriod(
  dateKey: string | null | undefined,
  period: { dateFrom?: string | null; dateTo?: string | null }
): Promise<boolean> {
  const warning = describeDateOutsidePeriod(dateKey, period);
  if (!warning) return true;
  return confirmAsync({
    title: "Дата вне периода документа",
    description: warning,
    bullets: [
      {
        label: "Запись попадёт в этот документ и будет напечатана в его бланке",
        tone: "warn",
      },
      {
        label: "Если дата введена по ошибке — нажмите «Отмена» и исправьте её",
        tone: "info",
      },
    ],
    variant: "warn",
    confirmLabel: "Всё равно сохранить",
  });
}
