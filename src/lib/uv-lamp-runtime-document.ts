import { formatTimesRu } from "@/lib/plural-ru";

export const UV_LAMP_RUNTIME_TEMPLATE_CODE = "uv_lamp_runtime";

export const UV_LAMP_RUNTIME_PAGE_TITLE = "Журнал учета работы УФ бактерицидной установки";

export type UvSpecification = {
  disinfectionAir: boolean;
  disinfectionSurface: boolean;
  microorganismType: string;
  radiationMode: "continuous" | "intermittent";
  disinfectionCondition: "with_people" | "without_people";
  lampLifetimeHours: number;
  commissioningDate: string;
  minIntervalBetweenSessions: string;
  controlFrequency: string;
  /** Типовое время включения установки — база для автозаполнения. */
  autoFillStartTime: string;
  /** Типовая длительность одного сеанса, минут — база для автозаполнения. */
  autoFillDurationMinutes: number;
};

export type UvRuntimeDocumentConfig = {
  lampNumber: string;
  areaName: string;
  spec: UvSpecification;
  /** Лампа из «Оборудования» (тип «УФ-лампа»): её QR пишет в этот документ,
   * ресурс считается у лампы, а не заново каждый месяц (2026-09-22). */
  equipmentId?: string;
};

/** Один сеанс работы установки. */
export type UvRuntimeSession = {
  startTime: string;
  endTime: string;
};

export type UvRuntimeEntryData = {
  /** Первый сеанс — плоские поля, чтобы старые записи читались как раньше. */
  startTime: string;
  endTime: string;
  /**
   * Регламент допускает 2-3 сеанса за смену. Здесь лежат ДОПОЛНИТЕЛЬНЫЕ
   * сеансы (второй и далее); первый — в startTime/endTime выше.
   */
  extraSessions?: UvRuntimeSession[];
};

/** Все сеансы дня — первый плюс дополнительные. */
export function listUvRuntimeSessions(
  data: UvRuntimeEntryData
): UvRuntimeSession[] {
  const sessions: UvRuntimeSession[] = [];
  if (data.startTime || data.endTime) {
    sessions.push({ startTime: data.startTime, endTime: data.endTime });
  }
  for (const session of data.extraSessions ?? []) {
    if (session.startTime || session.endTime) sessions.push(session);
  }
  return sessions;
}

/**
 * Сеансы для ПРАВКИ: слот 0 — плоские `startTime`/`endTime`, далее
 * `extraSessions`. В отличие от `listUvRuntimeSessions` пустые слоты не
 * отбрасываются — иначе индекс строки в таблице разъезжается с данными.
 */
export function listUvRuntimeSessionSlots(
  data: UvRuntimeEntryData
): UvRuntimeSession[] {
  return [
    { startTime: data.startTime, endTime: data.endTime },
    ...(data.extraSessions ?? []),
  ];
}

/** Правка одного сеанса по индексу слота. */
export function updateUvRuntimeSession(
  data: UvRuntimeEntryData,
  index: number,
  patch: Partial<UvRuntimeSession>
): UvRuntimeEntryData {
  const slots = listUvRuntimeSessionSlots(data);
  if (index < 0 || index >= slots.length) return data;
  slots[index] = { ...slots[index], ...patch };
  return fromUvRuntimeSessionSlots(slots);
}

/** Удаление сеанса; при удалении первого следующий занимает его место. */
export function removeUvRuntimeSession(
  data: UvRuntimeEntryData,
  index: number
): UvRuntimeEntryData {
  const slots = listUvRuntimeSessionSlots(data);
  if (index < 0 || index >= slots.length) return data;
  slots.splice(index, 1);
  return fromUvRuntimeSessionSlots(slots);
}

/** Добавление сеанса в конец дня. */
export function appendUvRuntimeSession(
  data: UvRuntimeEntryData,
  session: UvRuntimeSession
): UvRuntimeEntryData {
  return fromUvRuntimeSessionSlots([
    ...listUvRuntimeSessionSlots(data),
    session,
  ]);
}

/** Обратная сборка: первый слот — плоские поля, остальные — extraSessions. */
function fromUvRuntimeSessionSlots(
  slots: UvRuntimeSession[]
): UvRuntimeEntryData {
  const first = slots[0] ?? { startTime: "", endTime: "" };
  const extra = slots.slice(1);
  return {
    startTime: first.startTime,
    endTime: first.endTime,
    ...(extra.length > 0 ? { extraSessions: extra } : {}),
  };
}

/** Суммарная длительность всех сеансов дня, минут. */
export function calculateEntryDurationMinutes(
  data: UvRuntimeEntryData
): number | null {
  let total: number | null = null;
  for (const session of listUvRuntimeSessions(data)) {
    const duration = calculateDurationMinutes(session.startTime, session.endTime);
    if (duration === null) continue;
    total = (total ?? 0) + duration;
  }
  return total;
}

/** Типовое время включения установки по умолчанию (начало смены). */
export const UV_AUTOFILL_DEFAULT_START_TIME = "09:00";
/** Типовая длительность сеанса по умолчанию, минут. */
export const UV_AUTOFILL_DEFAULT_DURATION_MINUTES = 60;

export function defaultUvSpecification(): UvSpecification {
  return {
    disinfectionAir: true,
    disinfectionSurface: true,
    microorganismType: "санитарно-показательный",
    radiationMode: "continuous",
    disinfectionCondition: "with_people",
    lampLifetimeHours: 10000,
    commissioningDate: "",
    minIntervalBetweenSessions: "",
    controlFrequency: "1 раз(а) в смену",
    autoFillStartTime: UV_AUTOFILL_DEFAULT_START_TIME,
    autoFillDurationMinutes: UV_AUTOFILL_DEFAULT_DURATION_MINUTES,
  };
}

export function normalizeUvSpecification(value: unknown): UvSpecification {
  const defaults = defaultUvSpecification();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const item = value as Record<string, unknown>;
  return {
    disinfectionAir: typeof item.disinfectionAir === "boolean" ? item.disinfectionAir : defaults.disinfectionAir,
    disinfectionSurface: typeof item.disinfectionSurface === "boolean" ? item.disinfectionSurface : defaults.disinfectionSurface,
    microorganismType: typeof item.microorganismType === "string" && item.microorganismType.trim() ? item.microorganismType.trim() : defaults.microorganismType,
    radiationMode: item.radiationMode === "intermittent" ? "intermittent" : "continuous",
    disinfectionCondition: item.disinfectionCondition === "without_people" ? "without_people" : "with_people",
    lampLifetimeHours: typeof item.lampLifetimeHours === "number" && item.lampLifetimeHours > 0 ? item.lampLifetimeHours : defaults.lampLifetimeHours,
    commissioningDate: typeof item.commissioningDate === "string" ? item.commissioningDate : "",
    minIntervalBetweenSessions: typeof item.minIntervalBetweenSessions === "string" ? item.minIntervalBetweenSessions : "",
    controlFrequency: typeof item.controlFrequency === "string" && item.controlFrequency.trim() ? item.controlFrequency.trim() : defaults.controlFrequency,
    autoFillStartTime: isTimeString(item.autoFillStartTime) ? (item.autoFillStartTime as string) : defaults.autoFillStartTime,
    autoFillDurationMinutes:
      typeof item.autoFillDurationMinutes === "number" &&
      item.autoFillDurationMinutes > 0 &&
      item.autoFillDurationMinutes <= 24 * 60
        ? Math.round(item.autoFillDurationMinutes)
        : defaults.autoFillDurationMinutes,
  };
}

function isTimeString(value: unknown): boolean {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Автозаполнение сегодняшнего сеанса УФ-установки.
 *
 * Осмысленное значение берём из спецификации установки: типовое время
 * включения + типовая длительность сеанса. Ручные строки не трогаем —
 * заполняем только пустые (см. вызовы в API-роуте и в cron'е).
 */
export function buildUvRuntimeAutoFillEntryData(
  spec: UvSpecification
): UvRuntimeEntryData {
  const startTime = isTimeString(spec.autoFillStartTime)
    ? spec.autoFillStartTime
    : UV_AUTOFILL_DEFAULT_START_TIME;
  const duration =
    spec.autoFillDurationMinutes > 0
      ? Math.round(spec.autoFillDurationMinutes)
      : UV_AUTOFILL_DEFAULT_DURATION_MINUTES;

  const [hours, minutes] = startTime.split(":").map(Number);
  const endMinutes = (hours * 60 + minutes + duration) % (24 * 60);

  return {
    startTime,
    endTime: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(
      endMinutes % 60
    ).padStart(2, "0")}`,
  };
}

export function isUvRuntimeEntryDataEmpty(data: UvRuntimeEntryData): boolean {
  return listUvRuntimeSessions(data).length === 0;
}

export function normalizeUvRuntimeDocumentConfig(value: unknown): UvRuntimeDocumentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      lampNumber: "1",
      areaName: "",
      spec: defaultUvSpecification(),
    };
  }

  const item = value as Record<string, unknown>;
  return {
    lampNumber:
      typeof item.lampNumber === "string" && item.lampNumber.trim()
        ? item.lampNumber.trim()
        : "1",
    areaName: normalizeUvAreaName(item.areaName),
    spec: normalizeUvSpecification(item.spec),
    ...(typeof item.equipmentId === "string" && item.equipmentId ? { equipmentId: item.equipmentId } : {}),
  };
}

/**
 * U1: раньше дефолтом `areaName` был обрезок названия журнала
 * («Журнал учета работы»), который печатался на линии
 * «(наименование цеха / участка применения)» — ложные данные в бланке.
 * Теперь цех берётся ТОЛЬКО из настроек документа, а старое
 * значение-заглушка вычищается при чтении конфига.
 */
const UV_LEGACY_AREA_PLACEHOLDER = "Журнал учета работы";

export function normalizeUvAreaName(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed === UV_LEGACY_AREA_PLACEHOLDER ? "" : trimmed;
}

export function normalizeUvRuntimeEntryData(value: unknown): UvRuntimeEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      startTime: "",
      endTime: "",
    };
  }

  const item = value as Record<string, unknown>;
  const extraSessions: UvRuntimeSession[] = Array.isArray(item.extraSessions)
    ? (item.extraSessions as unknown[])
        .filter(
          (session): session is Record<string, unknown> =>
            !!session && typeof session === "object" && !Array.isArray(session)
        )
        .map((session) => ({
          startTime:
            typeof session.startTime === "string" ? session.startTime : "",
          endTime: typeof session.endTime === "string" ? session.endTime : "",
        }))
        .filter((session) => session.startTime || session.endTime)
    : [];

  return {
    startTime: typeof item.startTime === "string" ? item.startTime : "",
    endTime: typeof item.endTime === "string" ? item.endTime : "",
    ...(extraSessions.length > 0 ? { extraSessions } : {}),
  };
}

/**
 * Название документа по эталону: «Бактерицидная установка №N | <полное
 * имя журнала>». Название цеха сюда НЕ попадает — оно живёт только в
 * линии «(наименование цеха / участка применения)» бланка (U1).
 */
export function buildUvRuntimeDocumentTitle(config: UvRuntimeDocumentConfig) {
  return `Бактерицидная установка №${config.lampNumber} | ${UV_LAMP_RUNTIME_PAGE_TITLE}`;
}

export function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function formatRuDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("ru-RU");
}

export function formatRuDateDash(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("ru-RU").replaceAll(".", "-");
}

export function buildDailyRange(from: string, to: string) {
  const result: string[] = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (current <= end) {
    result.push(toIsoDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}

export function getUvResponsibleOptions(users: { id: string; name: string; role: string }[]) {
  // Канонические + legacy management. Раньше: только owner+technologist
  // — manager/head_chef в новых орг'ах попадали в staff, и UI выбора
  // ответственного за УФ-лампы для них не работал.
  const managementRoles = new Set([
    "manager",
    "head_chef",
    "owner",
    "technologist",
  ]);
  const management = users.filter((user) => managementRoles.has(user.role));
  const staff = users.filter((user) => !managementRoles.has(user.role));
  return { management, staff };
}

/**
 * Distinct management titles for the "Должность ответственного" Select.
 * Radix Select concatenates trigger-text when multiple <SelectItem>s share
 * the same `value`, so iterating users here is wrong. Return one title per
 * unique role label.
 */
export function getUvResponsibleTitleOptions(
  users: { id: string; name: string; role: string }[]
): { management: string[]; staff: string[] } {
  const management = new Set<string>();
  const staff = new Set<string>();
  for (const user of users) {
    if (user.role === "owner") management.add("Руководитель");
    else if (user.role === "technologist" || user.role === "manager") management.add("Управляющий");
    // head_chef — это "Шеф-повар" по сути management (заведующий
    // производством), не staff. Раньше попадал в staff из-за чего
    // в выборке должности ответственного его не было видно как
    // management option.
    else if (user.role === "head_chef") management.add("Шеф-повар");
    else if (user.role === "cook") staff.add("Повар");
    else if (user.role === "waiter") staff.add("Официант");
  }
  return { management: [...management], staff: [...staff] };
}

export function calculateDurationMinutes(startTime: string, endTime: string): number | null {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return null;
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

export function calculateMonthlyHours(
  entries: { date: string; data: UvRuntimeEntryData }[],
  lampLifetimeHours: number
): { month: string; hours: number; remaining: number }[] {
  const monthMap = new Map<string, number>();

  for (const entry of entries) {
    // Все сеансы дня, а не только первый.
    const duration = calculateEntryDurationMinutes(entry.data);
    if (duration === null || duration === 0) continue;

    const date = new Date(`${entry.date}T00:00:00.000Z`);
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + duration);
  }

  const sortedMonths = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let totalUsed = 0;
  return sortedMonths.map(([monthKey, minutes]) => {
    const hours = Math.round((minutes / 60) * 100) / 100;
    totalUsed += hours;
    const remaining = Math.round((lampLifetimeHours - totalUsed) * 100) / 100;
    return { month: monthKey, hours, remaining };
  });
}

export function formatMonthLabel(monthKey: string): string {
  const MONTH_NAMES = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];
  const [year, month] = monthKey.split("-");
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
}

export function getDisinfectionObjectLabel(spec: UvSpecification): string {
  const parts: string[] = [];
  if (spec.disinfectionAir) parts.push("воздух");
  if (spec.disinfectionSurface) parts.push("поверхность");
  return parts.join(" и ") || "—";
}

export function getRadiationModeLabel(mode: UvSpecification["radiationMode"]): string {
  return mode === "continuous" ? "непрерывный" : "повторно-кратковременный";
}

export function getDisinfectionConditionLabel(condition: UvSpecification["disinfectionCondition"]): string {
  return condition === "with_people" ? "в присутствии людей" : "в отсутствии людей";
}

/**
 * U7/V10: в конфиге частота хранится канцелярским «1 раз(а) в смену»
 * (менять хранимые значения нельзя — они уже в БД), но ПОКАЗЫВАЕМ
 * согласованное «1 раз / 2 раза / 5 раз».
 */
export function formatControlFrequencyLabel(value: string): string {
  return value.replace(/(\d+)\s*раз\(а\)/gi, (_match, count: string) =>
    formatTimesRu(Number(count))
  );
}

export const CONTROL_FREQUENCY_OPTIONS = [
  "1 раз(а) в смену",
  "2 раз(а) в смену",
  "3 раз(а) в смену",
  "1 раз(а) в день",
  "2 раз(а) в день",
];
