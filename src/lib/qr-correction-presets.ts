/**
 * Готовые ответы «Что сделали» при замере вне нормы — одни на React-формы
 * наклеек (`DeviationCorrection`) и HTML-формы журналов (`/journal-fill`).
 *
 * Первый — выбран по умолчанию (владелец, 2026-09-25): чаще всего замер
 * просто повторяют через полчаса.
 */
export const QR_FILL_CORRECTION_PRESETS = [
  "Повторю через 30 минут.",
  "Сообщил руководителю",
  "Вызвал мастера",
  "Переложил продукты",
] as const;

export const QR_FILL_DEFAULT_CORRECTION: string = QR_FILL_CORRECTION_PRESETS[0];
