"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Locale } from "@/i18n/locales";
import type { JournalDifficultyErrorKey } from "@/lib/settings-journal-difficulty-presentation";

type Copy = {
  locale: Locale;
  t: ReturnType<typeof useTranslations<"settingsJournalDifficulty">>;
};
type Message =
  | { key: JournalDifficultyErrorKey }
  | { key: "saved"; count: string };

function createFeedback(initial: Copy) {
  let copy = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => copy,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    commit(next: Copy) {
      copy = next;
      for (const listener of listeners) listener();
    },
  };
}
type FeedbackStore = ReturnType<typeof createFeedback>;

function FeedbackMessage({ store, message }: { store: FeedbackStore; message: Message }) {
  const copy = useSyncExternalStore(store.subscribe, store.current, store.current);
  return message.key === "saved"
    ? copy.t("saved", { count: message.count })
    : copy.t(message.key);
}

/** Per form; a detached request retains this instance's last committed copy. */
export function useJournalDifficultyFeedback() {
  const locale = useLocale() as Locale;
  const t = useTranslations("settingsJournalDifficulty");
  const [store] = useState(() => createFeedback({ locale, t }));
  useLayoutEffect(() => { store.commit({ locale, t }); }, [store, locale, t]);
  return {
    error(key: JournalDifficultyErrorKey) {
      toast.error(<FeedbackMessage store={store} message={{ key }} />);
    },
    saved(count: string) {
      toast.success(<FeedbackMessage store={store} message={{ key: "saved", count }} />);
    },
  };
}
