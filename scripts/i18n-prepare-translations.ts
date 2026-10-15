import { readFileSync, writeFileSync } from "node:fs";
import { flattenMessages } from "../src/i18n/catalog-validation";
import { prepareTranslationInventory, type TextOccurrence, type TranslationMemory } from "./lib/i18n-translation-preparation";

const directory = ".agent/tasks/english-version-1375e736/raw/full-localization";
const inventory = JSON.parse(readFileSync(`${directory}/inventory.json`, "utf8")) as {
  generatedAt: string; candidates: TextOccurrence[];
};
const memory: TranslationMemory[] = [];
const reference = flattenMessages(JSON.parse(readFileSync("src/i18n/messages/ru.json", "utf8")));
for (const locale of ["en", "uz"] as const) {
  const translated = flattenMessages(JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8")));
  for (const [key, source] of Object.entries(reference)) {
    if (translated[key]) memory.push({ source, locale, text: translated[key], origin: `src/i18n/messages/${locale}.json#${key}` });
  }
}
// Dictionaries are memory, not unlocalized product surfaces. Preserve counts
// of these exclusions; all remaining machine/seed values still require review.
const candidates = inventory.candidates.filter((item) => !item.file.startsWith("src/i18n/"));
const entries = prepareTranslationInventory(candidates, memory);
const summary = {
  candidateOccurrences: candidates.length,
  uniqueCandidates: entries.length,
  repeatedOccurrences: candidates.length - entries.length,
  excludedDictionaryOccurrences: inventory.candidates.length - candidates.length,
  templateFragments: entries.filter((item) => item.fragment).length,
  withEnglishSuggestions: entries.filter((item) => item.suggestions.some((suggestion) => suggestion.locale === "en")).length,
  withUzbekSuggestions: entries.filter((item) => item.suggestions.some((suggestion) => suggestion.locale === "uz")).length,
  conflictingSuggestions: entries.filter((item) => item.conflicts.length).length,
  sourceCharactersBeforeDeduplication: candidates.reduce((total, item) => total + item.text.length, 0),
  sourceCharactersAfterDeduplication: entries.reduce((total, item) => total + item.source.length, 0),
};
writeFileSync(`${directory}/translation-preparation.json`, JSON.stringify({
  generatedAt: new Date().toISOString(),
  inventoryGeneratedAt: inventory.generatedAt,
  status: "NEEDS_CONTEXT_REVIEW",
  warning: "Not a translation batch or proof of coverage. Review product ownership, semantic context and complete sentences before sending. Source scanning has already trimmed outer whitespace. Memory suggestions require context review; no runtime catalogs are changed.",
  externalRequests: 0,
  summary,
  entries,
}, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
