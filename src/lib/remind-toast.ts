"use client";

import { toast } from "sonner";

/**
 * Показ результата «Напомнить» одинаково на контрольной доске и на
 * странице проверок.
 *
 * Раньше оба экрана писали «Напоминание отправлено» на любой ответ со
 * статусом 200 — в том числе когда сервер вернул `sent: 0` (у человека
 * нет Telegram, он вне зоны ответственности, все уже взяли задачи).
 * Заведующая видела зелёный тост и была уверена, что сотрудника тыкнули.
 */
export type RemindResult = {
  sent?: number;
  failed?: number;
  total?: number;
  /** Код причины — нужен только для отладки, человеку не показываем. */
  reason?: string | null;
  /** Готовая фраза от сервера: почему никому не отправили. */
  reasonText?: string | null;
  error?: string;
};

/** Русские числительные: 1 сотруднику, 2 сотрудникам, 5 сотрудникам. */
export function pluralRu(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function showRemindResult(
  result: RemindResult,
  successText: (sent: number) => string
): void {
  const sent = result.sent ?? 0;
  if (sent > 0) {
    toast.success(successText(sent));
    return;
  }
  toast.warning(
    result.reasonText ||
      "Напоминание никому не ушло — отправлять было некому."
  );
}
