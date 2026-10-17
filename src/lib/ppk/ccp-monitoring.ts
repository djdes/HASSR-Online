/**
 * Сверка точек ККТ/ОПП с журналом «Мониторинг ККТ» (`ccp_monitoring`).
 * Чистая логика без БД: записи журнала приходят готовыми.
 */

export type CcpJournalEntry = {
  id: string;
  createdAt: string;
  filledByName: string | null;
  ccpName: string;
  actualValue: string;
  withinLimit: boolean | null;
  correctiveAction: string;
};

type Limits = { limitMin: number | null; limitMax: number | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/** Число из свободного текста: «75,5 °C» → 75.5, «−18 °С» → -18, «норма» → null. */
export function parseMeasurement(raw: string): number | null {
  const match = raw.match(/([-+−–]?)\s*(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const value = Number(match[2].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return match[1] === "-" || match[1] === "−" || match[1] === "–" ? -value : value;
}

/** Без регистра, пробелов, дефисов и знаков препинания: «ККТ-1», «ккт 1», «ККТ1» совпадают. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[\s\-–—−.,:;()«»"]/g, "");
}

/** Запись журнала относится к точке: по номеру (в начале названия) или по названию этапа целиком. */
export function matchesCcp(point: { number: string; step: string }, ccpName: string): boolean {
  const name = normalize(ccpName);
  if (!name) return false;
  const number = normalize(point.number);
  if (number) {
    if (name === number) return true;
    // «ККТ-1 Тепловая обработка» — но не «ККТ-12» для точки «ККТ-1».
    if (name.startsWith(number) && !/\d/.test(name[number.length])) return true;
  }
  const step = normalize(point.step);
  return step.length > 0 && name === step;
}

/** Оценка записи: числовые пределы точки, иначе отметка «в пределах» из журнала, иначе неизвестно. */
export function evaluateEntry(
  point: Limits,
  entry: CcpJournalEntry,
): { ok: boolean | null; value: number | null } {
  const value = parseMeasurement(entry.actualValue);
  const hasLimits = point.limitMin !== null || point.limitMax !== null;
  if (hasLimits && value !== null) {
    const ok =
      (point.limitMin === null || value >= point.limitMin) && (point.limitMax === null || value <= point.limitMax);
    return { ok, value };
  }
  return { ok: entry.withinLimit, value };
}

export type CcpSummary = {
  last: (CcpJournalEntry & { ok: boolean | null }) | null;
  deviations30: number;
  lastDeviation: (CcpJournalEntry & { value: number | null }) | null;
  /** Время последней записи «в норме» — чтобы понять, свежее ли отклонение. */
  lastOkAt: string | null;
};

/** Сводка по записям точки за 30 дней до `nowIso`; более старые записи не учитываются. */
export function summarizeCcp(point: Limits, entries: CcpJournalEntry[], nowIso: string): CcpSummary {
  const from = new Date(nowIso).getTime() - WINDOW_DAYS * DAY_MS;
  const recent = entries
    .filter((item) => new Date(item.createdAt).getTime() >= from)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((item) => ({ item, ...evaluateEntry(point, item) }));

  const lastRow = recent[0];
  const deviations = recent.filter((row) => row.ok === false);
  const deviation = deviations[0];
  const okRow = recent.find((row) => row.ok === true);
  return {
    last: lastRow ? { ...lastRow.item, ok: lastRow.ok } : null,
    deviations30: deviations.length,
    lastDeviation: deviation ? { ...deviation.item, value: deviation.value } : null,
    lastOkAt: okRow ? okRow.item.createdAt : null,
  };
}

const fmt = (n: number) => String(n).replace("-", "−");

/** Текст предела для карточки и листа: «≥ 75 °C», «2…6 °C», «≤ −18 °C»; без чисел — пусто. */
export function limitText(point: Limits & { unit: string }): string {
  const unit = point.unit.trim() ? ` ${point.unit.trim()}` : "";
  const { limitMin: min, limitMax: max } = point;
  if (min !== null && max !== null) return `${fmt(min)}…${fmt(max)}${unit}`;
  if (min !== null) return `≥ ${fmt(min)}${unit}`;
  if (max !== null) return `≤ ${fmt(max)}${unit}`;
  return "";
}
