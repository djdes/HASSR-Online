"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Locale } from "@/i18n/locales";
import type { ProductErrorKey } from "@/lib/settings-products-presentation";

type ProductTranslator = ReturnType<typeof useTranslations<"settingsProducts">>;
type CommonTranslator = ReturnType<typeof useTranslations<"common">>;
type Copy = { locale: Locale; t: ProductTranslator; common: CommonTranslator };
type FeedbackKey = ProductErrorKey | "delete.success" | "delete.failed" | "delete.network";

function createFeedback(initial: Copy) {
  let copy = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => copy,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    commit(next: Copy) { copy = next; for (const listener of listeners) listener(); },
  };
}
type FeedbackStore = ReturnType<typeof createFeedback>;

function FeedbackMessage({ store, message }: { store: FeedbackStore; message: FeedbackKey }) {
  const copy = useSyncExternalStore(store.subscribe, store.current, store.current);
  return copy.t(message);
}

/** An instance belongs to one delete button; only committed renders publish copy. */
export function useSettingsProductsFeedback() {
  const locale = useLocale() as Locale;
  const t = useTranslations("settingsProducts");
  const common = useTranslations("common");
  const [store] = useState(() => createFeedback({ locale, t, common }));
  useLayoutEffect(() => { store.commit({ locale, t, common }); }, [store, locale, t, common]);
  return {
    current: store.current,
    success(message: FeedbackKey) { toast.success(<FeedbackMessage store={store} message={message} />); },
    error(message: FeedbackKey) { toast.error(<FeedbackMessage store={store} message={message} />); },
  };
}
