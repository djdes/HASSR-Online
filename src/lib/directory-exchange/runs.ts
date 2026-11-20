import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";

/**
 * Журнал обменов справочниками (серия D, Р2) — чистая часть: повод обмена,
 * итог, текст ошибки и «здоровье» кабинета для страницы ROOT «Обмен
 * справочниками». Запись в базу — `runs.server.ts`.
 */

/**
 * Повод обмена: «Синхронизировать сейчас» (`manual`), сохранение настроек
 * обмена (`save`), подтверждение запроса другой компании (`approval`),
 * плановый обмен из крона (`schedule`).
 */
export const EXCHANGE_TRIGGERS = ["manual", "save", "approval", "schedule"] as const;
export type ExchangeTrigger = (typeof EXCHANGE_TRIGGERS)[number];

export function isExchangeTrigger(value: unknown): value is ExchangeTrigger {
  return typeof value === "string" && (EXCHANGE_TRIGGERS as readonly string[]).includes(value);
}

/** Итог обмена: идёт, готово, кабинет занят другим обменом, ошибка. */
export const EXCHANGE_RUN_STATUSES = ["running", "ok", "busy", "error"] as const;
export type ExchangeRunStatus = (typeof EXCHANGE_RUN_STATUSES)[number];

export function isExchangeRunStatus(value: unknown): value is ExchangeRunStatus {
  return typeof value === "string" && (EXCHANGE_RUN_STATUSES as readonly string[]).includes(value);
}

/** Сколько дней хранится журнал обменов (`DirectoryExchangeRun`). */
export const RUN_RETENTION_DAYS = 90;
/** Сколько дней хранится история изменений (`DirectoryExchangeChange`). */
export const CHANGE_RETENTION_DAYS = 30;
export const DAY_MS = 86_400_000;

/**
 * Обмен, который всё ещё «идёт» дольше этого, оборвался вместе с процессом
 * (выкат, перезапуск): замок обмена держится не дольше 10 минут.
 */
export const STALE_RUN_MS = 15 * 60_000;
/** Кабинет без успешного обмена дольше этого — в списке «нужно посмотреть». */
export const HEALTHY_WINDOW_MS = DAY_MS;

const ERROR_MAX = 500;

/**
 * Текст ошибки для журнала: первая строка сообщения без стека, не длиннее
 * 500 знаков. Пустое сообщение — имя ошибки или «Ошибка».
 */
export function runErrorText(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === "string"
        ? error
        : error && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part !== "");
  const text = (line ?? "").replace(/\s+/g, " ");
  if (!text) return "Ошибка";
  return text.length > ERROR_MAX ? `${text.slice(0, ERROR_MAX - 1)}…` : text;
}

export type RunTotals = { created: number; updated: number; skipped: number };

/** Итог обмена в журнал: создано, обновлено, пропущено (тариф и занятые названия). */
export function runTotals(summary: ExchangeSummary): RunTotals {
  const totals = summaryTotals(summary);
  return { created: totals.created, updated: totals.updated, skipped: totals.skippedLimit + totals.skippedConflict };
}

/** Статус для показа: «идёт» дольше `STALE_RUN_MS` — оборвался (`stale`). */
export function displayRunStatus(run: { status: string; startedAt: Date }, now: Date): ExchangeRunStatus | "stale" {
  const status = isExchangeRunStatus(run.status) ? run.status : "error";
  if (status === "running" && now.getTime() - run.startedAt.getTime() > STALE_RUN_MS) return "stale";
  return status;
}

/**
 * Что с кабинетом не так: последний обмен — ошибка (`error`) или успешного
 * обмена не было больше суток (`no_success`). Всё хорошо — null. Последний
 * «занято» — не проблема сам по себе: решает, был ли успешный обмен за сутки.
 */
export function cabinetProblem(input: {
  lastStatus: string | null;
  lastOkAt: Date | null;
  now: Date;
}): "error" | "no_success" | null {
  if (input.lastStatus === "error") return "error";
  if (!input.lastOkAt || input.now.getTime() - input.lastOkAt.getTime() > HEALTHY_WINDOW_MS) return "no_success";
  return null;
}
