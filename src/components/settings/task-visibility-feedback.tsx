"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Locale } from "@/i18n/locales";
import type { TaskVisibilityErrorKey } from "@/lib/task-visibility-presentation";

type Copy = {
  locale: Locale;
  t: ReturnType<typeof useTranslations<"settingsTaskVisibility">>;
};
type Message = { key: TaskVisibilityErrorKey } | { key: "saved"; count: string };

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
type Store = ReturnType<typeof createFeedback>;

function FeedbackMessage({ store, message }: { store: Store; message: Message }) {
  const copy = useSyncExternalStore(store.subscribe, store.current, store.current);
  return message.key === "saved"
    ? message.count === "0" ? copy.t("saved.none") : copy.t("saved.some", { count: message.count })
    : copy.t(message.key);
}

/** Each detached request keeps its form's last committed language and arguments. */
export function useTaskVisibilityFeedback() {
  const locale = useLocale() as Locale;
  const t = useTranslations("settingsTaskVisibility");
  const [store] = useState(() => createFeedback({ locale, t }));
  useLayoutEffect(() => { store.commit({ locale, t }); }, [store, locale, t]);
  return {
    error(key: TaskVisibilityErrorKey) {
      toast.error(<FeedbackMessage store={store} message={{ key }} />);
    },
    saved(count: string) {
      toast.success(<FeedbackMessage store={store} message={{ key: "saved", count }} />);
    },
  };
}
