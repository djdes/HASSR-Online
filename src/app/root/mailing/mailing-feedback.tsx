"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

type ErrorKey = "saveDraftFailed" | "refreshFailed" | "openDraftFailed" | "loadFailed" | "selectFailed";
type FeedbackEvent = { key: ErrorKey } | { key: "selectedFound" | "clearedFound"; count: string };
type Copy = (event: FeedbackEvent) => string;
type Feedback = { error: (key: ErrorKey) => void; selected: (on: boolean, count: string) => void };
type Store = Feedback & { subscribe: (listener: () => void) => () => void; snapshot: () => Copy; commit: (copy: Copy) => void };
const FeedbackContext = createContext<Feedback | null>(null);

function FeedbackMessage({ store, event }: { store: Store; event: FeedbackEvent }) {
  const copy = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return copy(event);
}

function createStore(initial: Copy): Store {
  let committed = initial;
  const listeners = new Set<() => void>();
  const store: Store = {
    snapshot: () => committed,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    commit: (copy) => {
      if (copy === committed) return;
      committed = copy;
      for (const listener of listeners) listener();
    },
    error: (key) => { toast.error(<FeedbackMessage store={store} event={{ key }} />); },
    selected: (on, count) => {
      toast.success(<FeedbackMessage store={store} event={{ key: on ? "selectedFound" : "clearedFound", count }} />);
    },
  };
  return store;
}

/** Per-page committed copy remains current for retained actions and toasts outside this namespace. */
export function MailingFeedbackProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("rootMailingShellAudience.feedback");
  const copy = useMemo<Copy>(() => (event) => {
    switch (event.key) {
      case "selectedFound": return t("selectedFound", { count: event.count });
      case "clearedFound": return t("clearedFound", { count: event.count });
      default: return t(event.key);
    }
  }, [t]);
  const [store] = useState(() => createStore(copy));
  useLayoutEffect(() => { store.commit(copy); }, [store, copy]);
  return <FeedbackContext.Provider value={store}>{children}</FeedbackContext.Provider>;
}

export function useMailingFeedback(): Feedback {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("MailingFeedbackProvider is required");
  return value;
}
