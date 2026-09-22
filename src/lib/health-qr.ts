/**
 * QR «Гигиена и здоровье» (2026-09-22) — чистая часть без БД.
 *
 * Сотрудник перед сменой отмечает пять подтверждений. Все пять →
 * «допущен»: в гигиеническом журнале «Здоров», в журнале здоровья —
 * подпись. Хотя бы одно не отмечено → «не допущен»: «Отстранён» и жалобы
 * в «Принятые меры», ответственному сразу уведомление.
 */

export const HEALTH_QR_CODES = new Set(["hygiene", "health_check"]);

export type HealthConfirmationKey = "skin" | "respiratory" | "intestinal" | "temperature" | "family";

export const HEALTH_CONFIRMATIONS: ReadonlyArray<{ key: HealthConfirmationKey; label: string; complaint: string }> = [
  { key: "temperature", label: "Нет повышенной температуры", complaint: "повышенная температура" },
  { key: "respiratory", label: "Нет насморка, кашля, боли в горле", complaint: "признаки ОРВИ" },
  { key: "intestinal", label: "Нет расстройства кишечника (диареи, рвоты)", complaint: "кишечное расстройство" },
  { key: "skin", label: "Нет гнойничков и ран на открытых частях тела", complaint: "гнойничковые поражения кожи" },
  { key: "family", label: "Дома никто не болеет", complaint: "болеют близкие" },
];

export type HealthDecision = {
  admitted: boolean;
  /** Жалобы — что не подтверждено. */
  complaints: string[];
  confirmations: Record<HealthConfirmationKey, boolean>;
  hygiene: { status: "healthy" | "suspended"; temperatureAbove37: boolean };
  health: { signed: boolean; measures: string | null };
};

export function healthDecision(checked: Iterable<string>): HealthDecision {
  const set = new Set(checked);
  const confirmations = Object.fromEntries(
    HEALTH_CONFIRMATIONS.map((item) => [item.key, set.has(item.key)])
  ) as Record<HealthConfirmationKey, boolean>;
  const complaints = HEALTH_CONFIRMATIONS.filter((item) => !confirmations[item.key]).map((item) => item.complaint);
  const admitted = complaints.length === 0;
  return {
    admitted,
    complaints,
    confirmations,
    hygiene: { status: admitted ? "healthy" : "suspended", temperatureAbove37: !confirmations.temperature },
    health: {
      signed: admitted,
      measures: admitted ? null : `Не допущен к работе: ${complaints.join(", ")}. Сообщено ответственному.`,
    },
  };
}

/** Статусы, которые хранитель журналов ставит за сотрудника. */
export const KEEPER_STATUSES = [
  { value: "healthy", label: "Здоров" },
  { value: "day_off", label: "Выходной" },
  { value: "sick_leave", label: "Болен" },
  { value: "vacation", label: "Отпуск" },
  { value: "suspended", label: "Отстранён" },
] as const;

export type KeeperStatus = (typeof KEEPER_STATUSES)[number]["value"];

export function isKeeperStatus(value: unknown): value is KeeperStatus {
  return typeof value === "string" && KEEPER_STATUSES.some((item) => item.value === value);
}

/** Запись гигиены — настоящая отметка (не заготовка строки на месяц). */
export function isRealHygieneEntry(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  if (record._autoSeeded === true) return false;
  return typeof record.status === "string" && record.status !== "";
}

export type DayMark =
  | { state: "admitted"; at: string | null }
  | { state: "suspended"; at: string | null }
  | { state: "absent"; label: string }
  | { state: "missing" };

/** Как показать человека в сводке дня. */
export function dayMarkFromEntry(data: unknown, absenceLabel: string | null): DayMark {
  if (isRealHygieneEntry(data)) {
    const record = data as Record<string, unknown>;
    const at = typeof record.confirmedAt === "string" ? record.confirmedAt : null;
    if (record.status === "healthy") return { state: "admitted", at };
    if (record.status === "suspended") return { state: "suspended", at };
    const labels: Record<string, string> = { day_off: "выходной", sick_leave: "болен", vacation: "отпуск" };
    return { state: "absent", label: labels[String(record.status)] ?? String(record.status) };
  }
  if (absenceLabel) return { state: "absent", label: absenceLabel };
  return { state: "missing" };
}
