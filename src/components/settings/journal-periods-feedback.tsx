"use client";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import { journalPeriodsDisplayName, type JournalPeriodsErrorKey } from "@/lib/settings-journal-periods-presentation";

type Copy = { locale: Locale; messages: Messages; t: ReturnType<typeof useTranslations<"settingsJournalPeriods">> };
type Message = { key: JournalPeriodsErrorKey } | { key: "invalidDays"; item: { code: string; name: string } } | { key: "saved"; updated: number; skipped: number };
function createStore(initial: Copy) {
  let copy = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => copy,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    commit(next: Copy) { copy = next; for (const listener of listeners) listener(); },
  };
}
function FeedbackMessage({ store, message }: { store: ReturnType<typeof createStore>; message: Message }) {
  const copy = useSyncExternalStore(store.subscribe, store.current, store.current);
  if (message.key === "invalidDays") return copy.t("invalidDays", { journal: journalPeriodsDisplayName(copy.locale, copy.messages.journals.names, message.item) });
  if (message.key === "saved") {
    if (message.updated > 0 && message.skipped > 0) return copy.t("feedback.savedBoth", { updated: message.updated, skipped: message.skipped });
    if (message.updated > 0) return copy.t("feedback.savedUpdated", { count: message.updated });
    if (message.skipped > 0) return copy.t("feedback.savedSkipped", { count: message.skipped });
    return copy.t("feedback.saved");
  }
  return copy.t(message.key);
}
export function useJournalPeriodsFeedback() {
  const locale = useLocale() as Locale;
  const messages = useMessages() as Messages;
  const t = useTranslations("settingsJournalPeriods");
  const [store] = useState(() => createStore({ locale, messages, t }));
  useLayoutEffect(() => { store.commit({ locale, messages, t }); }, [store, locale, messages, t]);
  return {
    error(key: JournalPeriodsErrorKey) { toast.error(<FeedbackMessage store={store} message={{ key }} />); },
    invalidDays(item: { code: string; name: string }) { toast.error(<FeedbackMessage store={store} message={{ key: "invalidDays", item }} />); },
    saved(updated: number, skipped: number) { toast.success(<FeedbackMessage store={store} message={{ key: "saved", updated, skipped }} />); },
  };
}
