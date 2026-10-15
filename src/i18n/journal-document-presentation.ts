import { buildDocumentAutoTitle, formatJournalPeriodLabel, getDocumentTitlePeriod } from "@/lib/journal-document-title";
import type { Locale } from "./locales";

/** Recognize only complete known generated names; customer edits stay verbatim. */
export function presentDocumentTitle(input: {
  title: string;
  templateCode: string;
  sourceNames: readonly string[];
  localizedName: string;
  dateFrom: string;
  dateTo: string;
  locale: Locale;
  formatTitle: (name: string, period: string) => string;
}) {
  if (input.locale === "ru") return input.title || input.localizedName;
  if (!input.title) return input.localizedName;
  if (input.sourceNames.includes(input.title)) return input.localizedName;
  const generated = input.sourceNames.some(journalName => input.title === buildDocumentAutoTitle({ ...input, journalName }));
  if (!generated) return input.title;
  const period = getDocumentTitlePeriod(input.templateCode, input);
  return period
    ? input.formatTitle(input.localizedName, formatJournalPeriodLabel(period.dateFrom, period.dateTo, input.locale))
    : input.localizedName;
}
