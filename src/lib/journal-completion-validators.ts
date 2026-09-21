import { db } from "@/lib/db";
import {
  climateIssues,
  coldEquipmentIssues,
  finishedProductIssues,
  fryerOilIssues,
  hygieneIssues,
  incomingIssues,
} from "@/lib/journal-completion-rules";

/**
 * Валидаторы и побочные эффекты при completion claim'а для каждого
 * журнала. Принимают form-payload (data) и контекст scope, возвращают
 * { ok, errors[], warnings[], side_effects[] }.
 *
 * Используются:
 *   - на endpoint /api/journal-task-claims/[id] complete (если payload
 *     передан) — отказывает completion если errors есть.
 *   - в адаптере TasksFlow при applyRemoteCompletion с form values.
 *
 * Side-effects:
 *   - "create_capa": автоматически открывает CAPA-тикет при out-of-range
 *     температуре, тёмном масле и т.п.
 *   - "telegram_alert": нотифицирует менеджера через TG.
 */

export type ValidationResult = {
  ok: boolean;
  errors: { field?: string; message: string }[];
  warnings: { field?: string; message: string }[];
  sideEffects: SideEffect[];
};

export type SideEffect =
  | { kind: "create_capa"; title: string; severity: "low" | "medium" | "high"; data?: Record<string, unknown> }
  | { kind: "telegram_alert"; recipients: "managers" | "owners"; message: string };

export type ScopeContext = {
  organizationId: string;
  journalCode: string;
  scopeKey: string;
  scopeLabel: string;
  userId: string;
  userName: string | null;
  data: Record<string, unknown>;
};

/**
 * Главный validator dispatcher.
 *
 * Пошаговая инструкция (pipeline) НЕ отменяет проверку полей журнала.
 * Раньше отменяла: при `pipelineCompleted:true` хватало одного тапа по
 * любому шагу, и замер температуры холодильника — критическая точка
 * ХАССП — закрывался вообще без значения. Теперь обе проверки идут
 * подряд: все шаги должны быть отмечены И поля журнала заполнены.
 */
export async function validateCompletion(ctx: ScopeContext): Promise<ValidationResult> {
  const pipelineErrors = validatePipelineSteps(ctx);
  const journal = await validateJournalFields(ctx);
  const errors = [...pipelineErrors, ...journal.errors];
  return {
    ok: errors.length === 0,
    errors,
    warnings: journal.warnings,
    sideEffects: journal.sideEffects,
  };
}

/**
 * Все шаги пошаговой инструкции должны быть отмечены.
 *
 * «Хотя бы один» не годится: шаг «Запиши значение» — это и есть работа,
 * а закрывали задачу тапом по «Возьми термометр».
 */
function validatePipelineSteps(ctx: ScopeContext): ValidationResult["errors"] {
  if (ctx.data.pipelineCompleted !== true) return [];
  const steps = Array.isArray(ctx.data.steps)
    ? (ctx.data.steps as Array<{ done?: boolean }>)
    : [];
  if (steps.length === 0) {
    return [{ message: "Отметьте шаги инструкции как выполненные" }];
  }
  const doneCount = steps.filter((s) => s.done === true).length;
  if (doneCount < steps.length) {
    return [
      {
        message: `Отметьте все шаги инструкции: ${doneCount} из ${steps.length}`,
      },
    ];
  }
  return [];
}

/** Проверка полей конкретного журнала — работает и с pipeline, и без него. */
async function validateJournalFields(
  ctx: ScopeContext
): Promise<ValidationResult> {
  switch (ctx.journalCode) {
    case "cold_equipment_control":
      return validateColdEquipment(ctx);
    case "climate_control":
      return validateClimate(ctx);
    case "fryer_oil":
      return validateFryerOil(ctx);
    case "hygiene":
    case "health_check":
      return validateHygiene(ctx);
    case "incoming_control":
      return validateIncoming(ctx);
    case "finished_product":
      return validateFinishedProduct(ctx);
    default:
      return { ok: true, errors: [], warnings: [], sideEffects: [] };
  }
}

/* ---------- per-journal ---------- */

async function validateColdEquipment(ctx: ScopeContext): Promise<ValidationResult> {
  const warnings: ValidationResult["warnings"] = [];
  const sideEffects: SideEffect[] = [];

  // Извлекаем equipmentId из scopeKey: fridge:<id>:<shift>:<date>
  const m = /^fridge:([^:]+):/.exec(ctx.scopeKey);
  let norm: { min: number | null; max: number | null } | null = null;
  let equipmentName = "холодильник";
  if (m) {
    const eq = await db.equipment.findUnique({
      where: { id: m[1] },
      select: { name: true, tempMin: true, tempMax: true },
    });
    if (eq) {
      equipmentName = eq.name;
      norm = { min: eq.tempMin, max: eq.tempMax };
    }
  }

  // Сама проверка — общая с экраном задачи (journal-completion-rules).
  const check = coldEquipmentIssues(ctx.data, norm);
  const errors: ValidationResult["errors"] = [...check.errors];
  if (errors.length === 0 && check.outOfRange) {
    const { t, min: tempMin, max: tempMax } = check.outOfRange;
    const correctiveAction = check.correctiveAction;
    warnings.push({
      message: `Температура ${t}°C вне диапазона (${tempMin}…${tempMax}°C). Создан CAPA, менеджер уведомлён.`,
    });
    sideEffects.push({
      kind: "create_capa",
      title: `${equipmentName}: температура ${t}°C вне диапазона (${tempMin}…${tempMax}°C)`,
      severity: "high",
      data: {
        equipmentId: m?.[1],
        temperature: t,
        tempMin,
        tempMax,
        correctiveAction,
        actionBy: ctx.userName,
      },
    });
    sideEffects.push({
      kind: "telegram_alert",
      recipients: "managers",
      message:
        `🚨 <b>Температура ${equipmentName}: ${t}°C</b>\n` +
        `Диапазон: ${tempMin}…${tempMax}°C\n` +
        `Сотрудник: ${ctx.userName ?? ""}\n` +
        `Действие: ${correctiveAction}`,
    });
  }
  return { ok: errors.length === 0, errors, warnings, sideEffects };
}

async function validateClimate(ctx: ScopeContext): Promise<ValidationResult> {
  const t = numField(ctx.data, ["temperature", "temp"]);
  const h = numField(ctx.data, ["humidity"]);
  // Минимум — хотя бы одно из двух.
  const errors: ValidationResult["errors"] = climateIssues(ctx.data);
  const warnings: ValidationResult["warnings"] = [];
  // Нормы для пищевых производств: t = +5..+32°C, h = 30-75%.
  if (t !== null && (t < 5 || t > 32)) {
    warnings.push({ message: `Температура ${t}°C вне нормы (+5…+32°C)` });
  }
  if (h !== null && (h < 30 || h > 75)) {
    warnings.push({ message: `Влажность ${h}% вне нормы (30–75%)` });
  }
  return { ok: errors.length === 0, errors, warnings, sideEffects: [] };
}

async function validateFryerOil(ctx: ScopeContext): Promise<ValidationResult> {
  const t = numField(ctx.data, ["temperatureC", "temperature"]);
  const polar = numField(ctx.data, ["polarCompoundsPercent"]);
  const replaced = boolField(ctx.data, ["replaced"]);
  const errors: ValidationResult["errors"] = fryerOilIssues(ctx.data);
  const warnings: ValidationResult["warnings"] = [];
  const sideEffects: SideEffect[] = [];

  if (t !== null && (t < 140 || t > 200)) {
    warnings.push({ message: `Температура жира ${t}°C вне нормы 140–200°C` });
  }
  if (polar !== null && polar > 25) {
    if (replaced) {
      sideEffects.push({
        kind: "create_capa",
        title: `Замена фритюрного жира — полярные соединения ${polar}%`,
        severity: "medium",
        data: { polar, replaced, by: ctx.userName },
      });
    }
  }
  return { ok: errors.length === 0, errors, warnings, sideEffects };
}

async function validateHygiene(ctx: ScopeContext): Promise<ValidationResult> {
  // Mini App шлёт упрощённую форму: { allHealthy: boolean, notes: string }.
  // Полная матричная форма (per-employee entries[]) — отдельный flow в
  // Dashboard, мы её принимаем тоже но не требуем.
  const entries = arrField(ctx.data, ["entries"]);
  const errors: ValidationResult["errors"] = [];
  const sideEffects: SideEffect[] = [];

  // Если есть matrix-entries — валидируем их.
  if (entries.length > 0) {
    for (const e of entries) {
      if (typeof e === "object" && e !== null) {
        const obj = e as Record<string, unknown>;
        if (typeof obj.temperatureC === "number" && obj.temperatureC > 37) {
          sideEffects.push({
            kind: "telegram_alert",
            recipients: "managers",
            message: `⚠️ Сотрудник ${obj.name ?? ""}: температура ${obj.temperatureC}°C — не допущен к работе`,
          });
        }
      }
    }
    return { ok: true, errors, warnings: [], sideEffects };
  }

  // Simplified форма: достаточно allHealthy=true ИЛИ примечание.
  // Проверка общая с экраном задачи (journal-completion-rules).
  errors.push(...hygieneIssues(ctx.data));
  return { ok: errors.length === 0, errors, warnings: [], sideEffects };
}

async function validateIncoming(ctx: ScopeContext): Promise<ValidationResult> {
  // Минимум — поставщик ИЛИ продукт; отказ — с причиной.
  const errors: ValidationResult["errors"] = incomingIssues(ctx.data);
  return { ok: errors.length === 0, errors, warnings: [], sideEffects: [] };
}

async function validateFinishedProduct(ctx: ScopeContext): Promise<ValidationResult> {
  const dish = stringField(ctx.data, ["dish"]);
  const tasteOk = boolField(ctx.data, ["tasteOk"]);
  const errors: ValidationResult["errors"] = finishedProductIssues(ctx.data);
  const sideEffects: SideEffect[] = [];
  if (tasteOk === false) {
    sideEffects.push({
      kind: "create_capa",
      title: `Бракераж: ${dish ?? "блюдо"} — органолептика не соответствует`,
      severity: "high",
    });
  }
  return { ok: errors.length === 0, errors, warnings: [], sideEffects };
}

/* ---------- helpers ---------- */

function numField(data: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(",", ".").trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function stringField(data: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

function boolField(data: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

function arrField(data: Record<string, unknown>, keys: string[]): unknown[] {
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}
