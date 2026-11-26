/**
 * Слияние `data` внешнего API (`POST /api/external/entries`) с `config`
 * документа журнала, который хранит строки в конфиге (реестры, приёмка,
 * бракераж, охлаждение…).
 *
 * Списки записей журнала (`rows`, поступления и расход дезсредств, замечания
 * отчёта аудита) сливаются по `id`: строка с известным `id` обновляется
 * (поля, которых нет в запросе, — подписи, правки с сайта — остаются), новые
 * дописываются, строки, которых нет в запросе, остаются. Раньше `data.rows`
 * заменял все строки документа и стирал записи с сайта, QR и TasksFlow (аудит
 * перезаписи 2026-11-26). Публичная документация замену строк не обещала.
 *
 * Остальные ключи заменяются значением из запроса; `appendX` дописывает в
 * список `x` — как раньше.
 */
const RECORD_LIST_KEYS = new Set(["rows", "receipts", "consumptions", "findings"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function recordId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" && value.id !== "" ? value.id : null;
}

function mergeRecordList(current: unknown[], incoming: unknown[]): unknown[] {
  const next = [...current];
  const indexById = new Map<string, number>();
  next.forEach((item, index) => {
    const id = recordId(item);
    if (id !== null && !indexById.has(id)) indexById.set(id, index);
  });
  for (const item of incoming) {
    const id = recordId(item);
    const at = id === null ? undefined : indexById.get(id);
    if (at === undefined) {
      if (id !== null) indexById.set(id, next.length);
      next.push(item);
      continue;
    }
    const existing = next[at];
    next[at] = isRecord(existing) && isRecord(item) ? { ...existing, ...item } : item;
  }
  return next;
}

export function mergeConfigPatch(currentConfig: unknown, patch: unknown): unknown {
  if (!isRecord(currentConfig) || !isRecord(patch)) {
    return patch;
  }

  const next: Record<string, unknown> = { ...currentConfig };
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith("append") && key.length > 6) {
      const targetKey = key.charAt(6).toLowerCase() + key.slice(7);
      if (Array.isArray(value)) {
        next[targetKey] = [...(Array.isArray(next[targetKey]) ? (next[targetKey] as unknown[]) : []), ...value];
        continue;
      }
      next[targetKey] = [...(Array.isArray(next[targetKey]) ? (next[targetKey] as unknown[]) : []), value];
      continue;
    }

    if (RECORD_LIST_KEYS.has(key) && Array.isArray(value) && Array.isArray(next[key])) {
      next[key] = mergeRecordList(next[key] as unknown[], value);
      continue;
    }

    next[key] = value;
  }

  return next;
}
