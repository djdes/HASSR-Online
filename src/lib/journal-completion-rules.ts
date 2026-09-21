/**
 * Общие чистые проверки заполнения задачи — одни и те же для сервера
 * (`journal-completion-validators.ts`) и экрана задачи в приложении
 * (`/mini/claim/[id]`).
 *
 * Раньше условная обязательность жила только на сервере: кнопка
 * «Завершить» на экране была активной, поле «Корректирующее действие»
 * подписано «по желанию», а сервер отказывал «температура вне нормы —
 * опишите действия». Булев «Все сотрудники допущены» тоже не считался
 * обязательным на экране.
 *
 * Модуль без Prisma и без обращений к базе — только данные формы и уже
 * известная норма.
 */

export type CompletionIssue = { field?: string; message: string };

export type TemperatureNorm = { min: number | null; max: number | null };

/** Норма холодильника, если в карточке оборудования её нет. */
export const DEFAULT_COLD_NORM = { min: -30, max: 12 } as const;

export function numValue(
  data: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(",", ".").trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function strValue(
  data: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

export function boolValue(
  data: Record<string, unknown>,
  keys: string[]
): boolean | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

export function resolveColdNorm(norm: TemperatureNorm | null | undefined): {
  min: number;
  max: number;
} {
  return {
    min: typeof norm?.min === "number" ? norm.min : DEFAULT_COLD_NORM.min,
    max: typeof norm?.max === "number" ? norm.max : DEFAULT_COLD_NORM.max,
  };
}

export function formatNormRange(min: number, max: number): string {
  return `${min}…${max}°C`;
}

/**
 * Холодильник: температура обязательна; вне нормы — обязательно
 * описать, что сделали (не короче 5 символов).
 */
export function coldEquipmentIssues(
  data: Record<string, unknown>,
  norm: TemperatureNorm | null | undefined
): {
  errors: CompletionIssue[];
  /** Температура вне нормы — поле действий становится обязательным. */
  outOfRange: { t: number; min: number; max: number } | null;
  correctiveAction: string | null;
} {
  const t = numValue(data, ["temperature", "temp", "tempC"]);
  if (t === null) {
    return {
      errors: [{ field: "temperature", message: "Не указана температура" }],
      outOfRange: null,
      correctiveAction: null,
    };
  }
  const { min, max } = resolveColdNorm(norm);
  const correctiveAction = strValue(data, ["correctiveAction"]);
  if (t >= min && t <= max) {
    return { errors: [], outOfRange: null, correctiveAction };
  }
  const errors: CompletionIssue[] = [];
  if (!correctiveAction || correctiveAction.trim().length < 5) {
    errors.push({
      field: "correctiveAction",
      message: `Температура ${t}°C вне диапазона (${min}…${max}°C). Опишите корректирующие действия (минимум 5 символов).`,
    });
  }
  return { errors, outOfRange: { t, min, max }, correctiveAction };
}

/** Упрощённая форма гигиены / здоровья: «все допущены» или примечание. */
export function hygieneIssues(data: Record<string, unknown>): CompletionIssue[] {
  const allHealthy = boolValue(data, ["allHealthy"]);
  const notes = strValue(data, ["notes"]);
  const hasNotes = Boolean(notes && notes.trim().length >= 3);
  if (allHealthy === false && !hasNotes) {
    return [
      {
        field: "notes",
        message: "Если не все сотрудники допущены — укажите кто и почему",
      },
    ];
  }
  if (allHealthy === null && !hasNotes) {
    return [
      {
        // Формулировка повторяет подпись чек-бокса на экране задачи.
        field: "allHealthy",
        message:
          "Отметьте «Все сотрудники допущены» или опишите ситуацию в примечании",
      },
    ];
  }
  return [];
}

export function incomingIssues(data: Record<string, unknown>): CompletionIssue[] {
  const errors: CompletionIssue[] = [];
  if (!strValue(data, ["supplier"]) && !strValue(data, ["productName"])) {
    errors.push({ message: "Укажите хотя бы поставщика или товар" });
  }
  if (boolValue(data, ["accepted"]) === false) {
    const reason = strValue(data, ["rejectionReason"]);
    if (!reason || reason.trim().length < 3) {
      errors.push({
        field: "rejectionReason",
        message: "Если товар отклонён — укажите причину",
      });
    }
  }
  return errors;
}

export function finishedProductIssues(
  data: Record<string, unknown>
): CompletionIssue[] {
  const dish = strValue(data, ["dish"]);
  return !dish || dish.trim().length < 1
    ? [{ field: "dish", message: "Не указано блюдо" }]
    : [];
}

export function fryerOilIssues(data: Record<string, unknown>): CompletionIssue[] {
  const polar = numValue(data, ["polarCompoundsPercent"]);
  const replaced = boolValue(data, ["replaced"]);
  if (polar !== null && polar > 25 && !replaced) {
    return [
      {
        field: "replaced",
        message: `Полярные соединения ${polar}% > 25% — требуется замена масла. Подтвердите чекбоксом.`,
      },
    ];
  }
  return [];
}

export function climateIssues(data: Record<string, unknown>): CompletionIssue[] {
  const t = numValue(data, ["temperature", "temp"]);
  const h = numValue(data, ["humidity"]);
  return t === null && h === null
    ? [{ message: "Введите температуру или влажность (хотя бы одно поле)" }]
    : [];
}

/**
 * Ошибки полей журнала — то же, что вернёт сервер (без шагов инструкции
 * и без побочных эффектов). `conditionalRequired` — поля, которые при
 * текущих значениях стали обязательными (для бейджа «обязательно»).
 */
export function completionFieldIssues(
  journalCode: string,
  data: Record<string, unknown>,
  ctx: { temperatureNorm?: TemperatureNorm | null } = {}
): { errors: CompletionIssue[]; conditionalRequired: string[] } {
  switch (journalCode) {
    case "cold_equipment_control": {
      const result = coldEquipmentIssues(data, ctx.temperatureNorm);
      return {
        errors: result.errors,
        conditionalRequired: result.outOfRange ? ["correctiveAction"] : [],
      };
    }
    case "climate_control":
      return { errors: climateIssues(data), conditionalRequired: [] };
    case "fryer_oil": {
      const errors = fryerOilIssues(data);
      return {
        errors,
        conditionalRequired: errors.length > 0 ? ["replaced"] : [],
      };
    }
    case "hygiene":
    case "health_check": {
      if (Array.isArray(data.entries) && data.entries.length > 0) {
        return { errors: [], conditionalRequired: [] };
      }
      const errors = hygieneIssues(data);
      return {
        errors,
        conditionalRequired: boolValue(data, ["allHealthy"]) === false ? ["notes"] : [],
      };
    }
    case "incoming_control":
      return {
        errors: incomingIssues(data),
        conditionalRequired:
          boolValue(data, ["accepted"]) === false ? ["rejectionReason"] : [],
      };
    case "finished_product":
      return { errors: finishedProductIssues(data), conditionalRequired: [] };
    default:
      return { errors: [], conditionalRequired: [] };
  }
}
