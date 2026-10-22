"use client";

import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { composeCount, composeDiagnosticText, type ComposeFeedbackEvent } from "@/lib/mailing/compose-presentation";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";

type Copy = (event: ComposeFeedbackEvent) => ReactNode;
type Store = {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => Copy;
  commit: (copy: Copy) => void;
  error: (event: ComposeFeedbackEvent) => void;
  success: (event: ComposeFeedbackEvent) => void;
};

function FeedbackMessage({ store, event }: { store: Store; event: ComposeFeedbackEvent }) {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)(event);
}

function createStore(initial: Copy): Store {
  let committed = initial;
  const listeners = new Set<() => void>();
  const store: Store = {
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => committed,
    commit: (copy) => {
      if (copy === committed) return;
      committed = copy;
      for (const listener of listeners) listener();
    },
    error: (event) => { toast.error(<FeedbackMessage store={store} event={event} />); },
    success: (event) => { toast.success(<FeedbackMessage store={store} event={event} />); },
  };
  return store;
}

/** One stable store per Compose. Only a committed layout effect publishes copy. */
export function useComposeFeedback(): Pick<Store, "error" | "success"> {
  const t = useTranslations("rootMailingCompose");
  const diagnostics = useTranslations("rootMailingDiagnostics");
  const locale = useSiteLocale();
  const copy = useMemo<Copy>(() => function ComposeFeedbackCopy(event) {
    const headline = event.key === "launched" ? t("feedback.launched", composeCount(event.count, locale))
      : event.key === "scheduled" ? t("feedback.scheduled", { at: event.at }) : t(`feedback.${event.key}`);
    return "detail" in event && event.detail !== undefined
      ? <>{headline}<span className="block text-[12px] font-normal">{("presentation" in event ? composeDiagnosticText(event.presentation, locale, diagnostics) : null) ?? t("diagnostics.originalTechnical", { detail: event.detail })}</span></>
      : headline;
  }, [t, diagnostics, locale]);
  const [store] = useState(() => createStore(copy));
  useLayoutEffect(() => { store.commit(copy); }, [store, copy]);
  return store;
}
