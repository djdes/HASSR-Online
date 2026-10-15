import { QUEUED_PHOTO_PREFIX } from "@/app/mini/_lib/queued-photo-mark";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";

/**
 * Черновик формы журнала — чистые правила. Черновик живёт в localStorage
 * браузера под ключом «пользователь + журнал», хранится двое суток и
 * считается только после правки человеком (значения по умолчанию, которые
 * форма подставляет сама, черновиком не являются).
 */
export const DRAFT_VERSION = 1;
export const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;
export const DRAFT_SAVE_DELAY_MS = 600;

export type DraftSnapshot = {
  data: Record<string, unknown>;
  areaId: string;
  equipmentId: string;
  catalogProductId: string;
};

export type FormDraft = DraftSnapshot & { v: typeof DRAFT_VERSION; savedAt: string };

export function draftStorageKey(scope: string, templateCode: string): string {
  return `wesetup.journal-draft.${scope}.${templateCode}`;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Метки снимков, снятых без связи, живут только в памяти открытой
 * страницы — после перезагрузки за ними ничего нет. В черновик они не
 * попадают; уже загруженные адреса остаются.
 */
export function stripTransientValues(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.includes(QUEUED_PHOTO_PREFIX)) {
      const kept = value.split("\n").filter((part) => part && !part.startsWith(QUEUED_PHOTO_PREFIX));
      if (kept.length === 0) continue;
      out[key] = kept.join("\n");
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function filledCount(snapshot: DraftSnapshot): number {
  const selectors = [snapshot.areaId, snapshot.equipmentId, snapshot.catalogProductId].filter(Boolean).length;
  return selectors + Object.values(snapshot.data).filter((value) => !isEmptyValue(value)).length;
}

export function hasMeaningfulValues(snapshot: DraftSnapshot): boolean {
  return filledCount(snapshot) > 0;
}

/** null — сохранять нечего (и прежний черновик стоит удалить). */
export function serializeDraft(snapshot: DraftSnapshot, now: Date): string | null {
  const cleaned: DraftSnapshot = { ...snapshot, data: stripTransientValues(snapshot.data) };
  if (!hasMeaningfulValues(cleaned)) return null;
  const draft: FormDraft = { v: DRAFT_VERSION, savedAt: now.toISOString(), ...cleaned };
  return JSON.stringify(draft);
}

export function parseDraft(raw: string | null | undefined, now: Date): FormDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as Partial<FormDraft>;
  if (d.v !== DRAFT_VERSION || typeof d.savedAt !== "string") return null;
  if (!d.data || typeof d.data !== "object" || Array.isArray(d.data)) return null;
  const savedAt = new Date(d.savedAt);
  if (Number.isNaN(savedAt.getTime())) return null;
  const age = now.getTime() - savedAt.getTime();
  if (age > DRAFT_TTL_MS || age < -60_000) return null;
  const draft: FormDraft = {
    v: DRAFT_VERSION,
    savedAt: d.savedAt,
    data: d.data as Record<string, unknown>,
    areaId: typeof d.areaId === "string" ? d.areaId : "",
    equipmentId: typeof d.equipmentId === "string" ? d.equipmentId : "",
    catalogProductId: typeof d.catalogProductId === "string" ? d.catalogProductId : "",
  };
  return hasMeaningfulValues(draft) ? draft : null;
}

export type DraftTimeDescription =
  | { key: "recently" }
  | { key: "todayAt"; time: string }
  | { key: "yesterdayAt"; time: string }
  | { key: "dateAt"; date: string; time: string };

/** Returns a translation key and locale-formatted values for a saved draft timestamp. */
export function getDraftTimeDescription(
  savedAt: string,
  now: Date,
  timeZone?: string,
  locale: Locale = "ru",
): DraftTimeDescription {
  const at = new Date(savedAt);
  if (Number.isNaN(at.getTime())) return { key: "recently" };
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const localDay = (value: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const time = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(at);
  const today = localDay(now);
  const savedDay = localDay(at);
  if (savedDay === today) return { key: "todayAt", time };
  const [year, month, day] = today.split("-").map(Number);
  const yesterdayDate = new Date(Date.UTC(year, month - 1, day - 1));
  const yesterday = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getUTCDate()).padStart(2, "0")}`;
  if (savedDay === yesterday) return { key: "yesterdayAt", time };
  const date = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
    timeZone, day: "2-digit", month: "2-digit",
  }).format(at);
  return { key: "dateAt", date, time };
}

/** Legacy Russian API retained for non-localized callers. */
export function describeDraftTime(savedAt: string, now: Date, timeZone?: string): string {
  const description = getDraftTimeDescription(savedAt, now, timeZone, "ru");
  if (description.key === "recently") return "недавно";
  if (description.key === "todayAt") return `сегодня в ${description.time}`;
  if (description.key === "yesterdayAt") return `вчера в ${description.time}`;
  return `${description.date} в ${description.time}`;
}
