import type { Messages } from "./messages";
import type { Locale } from "./locales";

export function journalTitle(
  locale: Locale,
  names: Messages["journals"]["names"],
  code: string,
  original: string,
  customName?: string | null,
): string {
  if (customName) return customName;
  if (locale === "ru") return original;
  return Object.hasOwn(names, code) ? names[code as keyof typeof names] : original;
}

export type JournalFieldCopy = {
  label: string;
  options?: Record<string, string>;
};

/** Presentation only: never substitute labels into persisted values or keys. */
export function presentJournalField<T extends { key: string; label: string; options?: { value: string; label: string }[] }>(
  field: T,
  copy: JournalFieldCopy | undefined,
  customLabel?: string | null,
): T & { displayLabel: string; displayOptions: { value: string; label: string }[] | undefined } {
  return {
    ...field,
    displayLabel: customLabel ?? copy?.label ?? field.label,
    displayOptions: field.options?.map((option) => ({
      value: option.value,
      label: copy?.options && Object.hasOwn(copy.options, option.value) ? copy.options[option.value] : option.label,
    })),
  };
}
