import { formatNumber, type Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import { journalTitle } from "@/i18n/journal-presentation";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import type { Difficulty } from "@/lib/journal-workload";

const OFFICIAL_NAMES = new Map<string, string>(
  ACTIVE_JOURNAL_CATALOG.map((journal) => [journal.code, journal.name]),
);

/** A supplied custom name, including an empty name, is never translated. */
export function journalDifficultyDisplayName(
  locale: Locale,
  names: Messages["journals"]["names"],
  journal: { code: string; name: string },
): string {
  if (OFFICIAL_NAMES.get(journal.code) !== journal.name) return journal.name;
  return journalTitle(locale, names, journal.code, journal.name);
}

export const DIFFICULTY_COPY_KEYS = {
  1: { label: "levels.1.label", description: "levels.1.description" },
  2: { label: "levels.2.label", description: "levels.2.description" },
  3: { label: "levels.3.label", description: "levels.3.description" },
  4: { label: "levels.4.label", description: "levels.4.description" },
  5: { label: "levels.5.label", description: "levels.5.description" },
} as const satisfies Record<Difficulty, { label: string; description: string }>;

export function difficultyCopyKeys(level: Difficulty) {
  return Object.hasOwn(DIFFICULTY_COPY_KEYS, level)
    ? DIFFICULTY_COPY_KEYS[level]
    : undefined;
}

/** Only the exact empirical half-per-month label differs from legacy copy. */
export function journalDifficultyFrequencyKey(perMonth: number) {
  if (perMonth === 0.5) return "frequency.timesPerMonth" as const;
  if (perMonth >= 28) return "frequency.daily" as const;
  if (perMonth >= 18) return "frequency.weekdays" as const;
  if (perMonth >= 6) return "frequency.timesPerMonth" as const;
  if (perMonth >= 3) return "frequency.weekly" as const;
  if (perMonth >= 0.9) return "frequency.monthly" as const;
  if (perMonth >= 0.3) return "frequency.quarterly" as const;
  return "frequency.rare" as const;
}

export function journalDifficultyFrequencyCount(locale: Locale, perMonth: number): string {
  return perMonth === 0.5
    ? formatNumber(locale, perMonth, { useGrouping: false, maximumFractionDigits: 1 })
    : String(Math.round(perMonth));
}

export type JournalDifficultyErrorKey =
  | "errors.forbidden"
  | "errors.invalidBody"
  | "errors.unauthorized"
  | "errors.saveFailed"
  | "errors.network";

const ERROR_DESCRIPTORS = {
  JOURNAL_DIFFICULTY_FORBIDDEN: { status: 403, key: "errors.forbidden" },
  JOURNAL_DIFFICULTY_INVALID_BODY: { status: 400, key: "errors.invalidBody" },
} as const;

/** The legacy error field stays on the wire; arbitrary text is not dictionary input. */
export function journalDifficultySaveError(data: unknown, status: number): JournalDifficultyErrorKey {
  if (status === 401) return "errors.unauthorized";
  if (!data || typeof data !== "object" || Array.isArray(data)) return "errors.saveFailed";
  const field = Object.getOwnPropertyDescriptor(data, "errorCode");
  if (field) {
    const code: unknown = field.value;
    if (typeof code !== "string" || !Object.hasOwn(ERROR_DESCRIPTORS, code)) return "errors.saveFailed";
    const descriptor = ERROR_DESCRIPTORS[code as keyof typeof ERROR_DESCRIPTORS];
    return status === descriptor.status ? descriptor.key : "errors.saveFailed";
  }
  // Older versions of this route have exactly one managed family per status.
  if (status === 403) return "errors.forbidden";
  if (status === 400) return "errors.invalidBody";
  return "errors.saveFailed";
}
