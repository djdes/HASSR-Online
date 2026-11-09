/**
 * Настройки автоворонки CRM (`PlatformSetting` `crm:lifecycle`, страница
 * /root/crm/automation). Чистый модуль: значения по умолчанию, разбор и
 * проверка — их читают и сервер, и форма настроек.
 */

import { z } from "zod";

export const LIFECYCLE_SETTING_KEY = "crm:lifecycle";

export type DiscountStep = { minUsers: number; percent: number };

export type LifecycleSettings = {
  /** Автоворонка работает: сделки, задачи, письма. */
  enabled: boolean;
  /** Письма и Telegram клиентам (выключено — только сделки и задачи менеджерам). */
  clientMessages: boolean;
  /** Счёт PDF во вложении письма (у организаций с ИНН). */
  attachInvoice: boolean;
  /** На какой период выставлять счёт новому клиенту. */
  invoiceCycle: "year" | "month";
  /** За сколько дней до конца пробного — письмо и задача. */
  trialStages: number[];
  /** Продление годового тарифа: за сколько дней — письма; задачи — на ступенях ≤ taskStageMax. */
  renewalYearStages: number[];
  /** Продление помесячного тарифа. */
  renewalMonthStages: number[];
  /** Задачи менеджеру ставятся на ступенях не раньше стольких дней до конца. */
  taskStageMax: number;
  /** За сколько дней до конца грейса — последнее письмо и срочная задача. */
  graceLastStage: number;
  /** Через сколько рабочих дней после перехода на бесплатный — задача «вернуть». */
  winbackAfterWorkingDays: number;
  /** Лестница скидок спец-КП по числу сотрудников (для работающих аккаунтов). */
  discountLadder: DiscountStep[];
  /** Ответственный, если у клиента нет менеджера (null — первый РОП). */
  defaultAssigneeId: string | null;
  /** Дополнительные выходные «ГГГГ-ММ-ДД» (переносы праздников). */
  holidays: string[];
};

export const DEFAULT_LIFECYCLE_SETTINGS: LifecycleSettings = {
  enabled: true,
  clientMessages: true,
  attachInvoice: true,
  invoiceCycle: "year",
  trialStages: [4, 2],
  renewalYearStages: [30, 14, 4, 2, 1],
  renewalMonthStages: [7, 4, 2, 1],
  taskStageMax: 4,
  graceLastStage: 2,
  winbackAfterWorkingDays: 3,
  discountLadder: [
    { minUsers: 100, percent: 25 },
    { minUsers: 30, percent: 15 },
    { minUsers: 10, percent: 10 },
  ],
  defaultAssigneeId: null,
  holidays: [],
};

const stages = z
  .array(z.number().int().min(1).max(90))
  .max(8)
  .transform((list) => [...new Set(list)].sort((a, b) => b - a));

export const lifecycleSettingsSchema = z.object({
  enabled: z.boolean(),
  clientMessages: z.boolean(),
  attachInvoice: z.boolean(),
  invoiceCycle: z.enum(["year", "month"]),
  trialStages: stages,
  renewalYearStages: stages,
  renewalMonthStages: stages,
  taskStageMax: z.number().int().min(1).max(30),
  graceLastStage: z.number().int().min(1).max(30),
  winbackAfterWorkingDays: z.number().int().min(1).max(30),
  discountLadder: z
    .array(z.object({ minUsers: z.number().int().min(1).max(100_000), percent: z.number().int().min(1).max(90) }))
    .max(10)
    .transform((list) => [...list].sort((a, b) => b.minUsers - a.minUsers)),
  defaultAssigneeId: z.string().min(1).max(64).nullable(),
  holidays: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата — ГГГГ-ММ-ДД"))
    .max(60),
});

/** Сохранённое значение → настройки; битое поле — значение по умолчанию. */
export function normalizeLifecycleSettings(raw: unknown): LifecycleSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_LIFECYCLE_SETTINGS };
  for (const key of Object.keys(DEFAULT_LIFECYCLE_SETTINGS) as (keyof LifecycleSettings)[]) {
    if (!(key in source)) continue;
    const parsed = lifecycleSettingsSchema.shape[key].safeParse(source[key]);
    if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data;
  }
  return result;
}

/** Скидка спец-КП по числу сотрудников: первая ступень, до которой дотянулись. */
export function ladderDiscount(ladder: readonly DiscountStep[], users: number): number {
  const sorted = [...ladder].sort((a, b) => b.minUsers - a.minUsers);
  return sorted.find((step) => users >= step.minUsers)?.percent ?? 0;
}
