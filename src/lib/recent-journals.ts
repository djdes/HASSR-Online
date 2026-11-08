/**
 * «Недавно открывали» (08.11.2026): коды журналов, которые человек открывал
 * на ЭТОМ устройстве, — свежие первыми, без повторов. Повар каждый день
 * открывает одни и те же два-три журнала: на «Сегодня» они под рукой.
 *
 * Хранится в localStorage (настройка устройства, как тема). Чистые функции —
 * их берут клиент и тест.
 */

export const RECENT_JOURNALS_KEY = "wesetup-recent-journals";
export const RECENT_JOURNALS_MAX = 8;
/** Сколько кнопок показываем на «Сегодня». */
export const RECENT_JOURNALS_SHOWN = 4;

const CODE = /^[a-z0-9_-]{1,64}$/i;

/** Значение из хранилища → список кодов. Мусор — пустой список. */
export function parseRecentJournals(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const codes = value.filter((item): item is string => typeof item === "string" && CODE.test(item));
    return [...new Set(codes)].slice(0, RECENT_JOURNALS_MAX);
  } catch {
    return [];
  }
}

/** Открыли журнал `code`: он первым, без повторов, не больше лимита. */
export function pushRecentJournal(list: readonly string[], code: string): string[] {
  if (!CODE.test(code)) return [...list];
  return [code, ...list.filter((item) => item !== code)].slice(0, RECENT_JOURNALS_MAX);
}

/** Недавние журналы, которые есть в списке «Сегодня», в порядке недавности. */
export function pickRecentJournals<T extends { code: string }>(recent: readonly string[], items: readonly T[], limit = RECENT_JOURNALS_SHOWN): T[] {
  const byCode = new Map(items.map((item) => [item.code, item]));
  const out: T[] = [];
  for (const code of recent) {
    const item = byCode.get(code);
    if (item) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
