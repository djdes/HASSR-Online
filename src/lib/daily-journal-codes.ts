/**
 * Pure-data file (no Prisma, no db imports) listing journal templates
 * that legitimately expect at least one row for today every working
 * day AND store their rows as `JournalDocumentEntry` records.
 *
 * Lives in its own module so Client Components can import the set
 * without dragging the Prisma client into the browser bundle. Keep
 * in sync with the product definition — when a journal's cadence
 * changes, update the appropriate set.
 *
 * Three sets, plus the union:
 *
 *  - `DAILY_JOURNAL_CODES` — entries-based dailies. today-compliance
 *    inspects `JournalDocumentEntry` rows directly for these.
 *
 *  - `CONFIG_DAILY_CODES` — dailies whose rows live inside
 *    `JournalDocument.config` JSON (cleaning's matrix, finished-
 *    product/perishable-rejection's `rows[]`). today-compliance has
 *    a per-template inspector (`rollupConfigDocumentForDay`) that
 *    handles these.
 *
 *  - `COUNTS_UNBOUNDED_CODES` — subset of CONFIG_DAILY where there is
 *    no fixed roster, so the banner shows «N записей за сегодня»
 *    instead of «X из Y строк».
 *
 *  - `ALL_DAILY_JOURNAL_CODES` — union used by UI to gate banners /
 *    stat-pill colors.
 */
export const DAILY_JOURNAL_CODES = new Set<string>([
  "hygiene",
  "health_check",
  "climate_control",
  "cold_equipment_control",
  "cleaning_ventilation_checklist",
  "uv_lamp_runtime",
  "fryer_oil",
]);

/**
 * Daily journals that store rows inside `JournalDocument.config` JSON
 * instead of `JournalDocumentEntry`. today-compliance.ts inspects the
 * config directly for these (see `rollupConfigDocumentForDay`).
 *
 * Keep distinct from `DAILY_JOURNAL_CODES` so the two code paths can
 * be reasoned about separately.
 */
export const CONFIG_DAILY_CODES = new Set<string>([
  "cleaning",
  "finished_product",
  "perishable_rejection",
]);

/**
 * Journals where the "expected count" isn't a fixed roster — every row
 * is an event (a batch inspection, a delivery acceptance). The UI
 * should treat these as «at least one row for today» instead of the
 * normal «X из Y». Subset of CONFIG_DAILY_CODES.
 */
export const COUNTS_UNBOUNDED_CODES = new Set<string>([
  "finished_product",
  "perishable_rejection",
]);

/**
 * Union of all daily codes — used wherever UI just needs to know
 * «does this journal have a daily obligation?» (dashboard tile
 * badges, banner visibility gating).
 */
export const ALL_DAILY_JOURNAL_CODES = new Set<string>([
  ...DAILY_JOURNAL_CODES,
  ...CONFIG_DAILY_CODES,
]);

/**
 * Журналы, которые умеет дозаполнять «Закрыть день»
 * (`/api/dashboard/close-day`). Всё остальное кнопка не трогает —
 * дашборд считает по этому набору, сколько журналов она реально
 * закроет, чтобы в подтверждении не обещать больше, чем будет.
 */
export const CLOSE_DAY_JOURNAL_CODES = new Set<string>([
  ...DAILY_JOURNAL_CODES,
  "cleaning",
]);

/**
 * Journals that genuinely require one task/obligation per employee for
 * the same day. Other selected journals are organization-level daily
 * work: one responsible employee fills the journal for the day.
 */
export const PER_EMPLOYEE_DAILY_JOURNAL_CODES = new Set<string>([
  "hygiene",
  "health_check",
]);
