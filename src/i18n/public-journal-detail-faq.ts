import { createTranslator } from "use-intl/core";
import type { JournalInfo } from "@/content/journal-info";
import type { JournalFaqItem } from "@/lib/journal-faq";
import type { Locale } from "./locales";
import type { Messages } from "./messages";

/** Whole sentences keep language-specific order; catalog identifiers and field order stay intact. */
export function publicJournalDetailFaq(
  info: JournalInfo,
  name: string,
  locale: Locale,
  messages: Pick<Messages, "publicJournalDetailFaq">,
): JournalFaqItem[] {
  const t = createTranslator({ locale, messages, namespace: "publicJournalDetailFaq" });
  const subject = locale === "ru" ? name.charAt(0).toLowerCase() + name.slice(1) : name;
  const items: JournalFaqItem[] = [];
  if (info.whatToFill.length > 0) {
    const fields = info.whatToFill.map(field => field.replace(/\s*\(.*?\)\s*/g, " ").trim()).filter(Boolean);
    items.push({ q: t("fieldsQuestion", { name: subject }), a: t("fieldsAnswer", { fields: fields.join("; ") }) });
  }
  items.push({ q: t("cadenceQuestion", { name: subject }), a: t(`cadence.${info.category}`) });
  if (info.normative.length > 0) {
    const norms = info.normative.map(norm => norm.pointer ? `${norm.title}, ${norm.pointer}` : norm.title).join("; ");
    items.push({ q: t("normativeQuestion", { name: subject }), a: t("normativeAnswer", { norms }) });
  }
  items.push({ q: t("electronicQuestion", { name: subject }), a: t("electronicAnswer") });
  items.push({ q: t("retentionQuestion", { name: subject }), a: t("retentionAnswer") });
  return items;
}
