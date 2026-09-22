/**
 * Когда на QR-странице нужен шаг PIN. Единое правило для всех журналов
 * (серверный HTML и React-страницы помещений/холодильников): PIN — ДО
 * формы, а не перед «Сохранить». Модуль без серверных зависимостей.
 *
 *   • open   — показать форму;
 *   • pin    — сначала шаг «Ваш PIN»;
 *   • no-pin — PIN нужен, а у сотрудника его нет: экран «Запросить доступ».
 */
export type PinGateDecision = "open" | "pin" | "no-pin";

export function decidePinGate(params: {
  mode: "public" | "pin" | "auth";
  /** У сотрудника задан PIN. */
  hasPin: boolean;
  /** Вход в кабинет (режим auth) — это уже подтверждение личности. */
  sessionVerified: boolean;
  /** Действующий пропуск этого визита (`qr-pin-pass`). */
  passValid: boolean;
  /** Журнал требует PIN всегда (подпись: гигиена, комиссия бракеража). */
  requirePin?: boolean;
  /** Экран «Сохранено» — повторно не спрашиваем. */
  isResultPage?: boolean;
}): PinGateDecision {
  if (params.isResultPage) return "open";
  if (params.mode === "auth") return "open";
  if (params.sessionVerified || params.passValid) return "open";
  const required = params.mode === "pin" || params.hasPin || params.requirePin === true;
  if (!required) return "open";
  return params.hasPin ? "pin" : "no-pin";
}
