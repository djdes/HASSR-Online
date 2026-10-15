import { createHash } from "node:crypto";

export type TextOccurrence = { file: string; line: number; kind: string; text: string };
export type TranslationMemory = { source: string; locale: "en" | "uz"; text: string; origin: string };

/** Exact-source grouping only. Whitespace, punctuation and template fragments
 * must not be silently merged: they can carry layout or grammatical meaning. */
export function prepareTranslationInventory(occurrences: TextOccurrence[], memory: TranslationMemory[]) {
  const groups = new Map<string, TextOccurrence[]>();
  for (const item of occurrences) {
    const list = groups.get(item.text) ?? [];
    list.push(item);
    groups.set(item.text, list);
  }
  const remembered = new Map<string, TranslationMemory[]>();
  for (const item of memory) {
    if (!item.text.trim()) continue;
    const list = remembered.get(item.source) ?? [];
    if (!list.some((previous) => previous.locale === item.locale && previous.text === item.text && previous.origin === item.origin)) list.push(item);
    remembered.set(item.source, list);
  }
  return [...groups].map(([source, locations]) => {
    const suggestions = remembered.get(source) ?? [];
    const conflicts = (["en", "uz"] as const).filter((locale) =>
      new Set(suggestions.filter((item) => item.locale === locale).map((item) => item.text)).size > 1);
    return {
      // A review identity, never a runtime message key. Runtime keys are semantic.
      id: createHash("sha256").update(source).digest("hex"),
      source,
      status: "NEEDS_CONTEXT_REVIEW" as const,
      fragment: locations.some((item) => /^(TemplateHead|TemplateMiddle|TemplateTail)$/.test(item.kind)),
      occurrences: locations.map(({ file, line, kind }) => ({ file, line, kind })),
      suggestions: suggestions.map(({ locale, text, origin }) => ({ locale, text, origin })),
      conflicts,
    };
  }).sort((a, b) => b.occurrences.length - a.occurrences.length || a.id.localeCompare(b.id));
}
