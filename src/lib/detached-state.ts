import { useState, useSyncExternalStore } from "react";

/**
 * State that lives outside the component that writes it.
 *
 * Why: on a page with heavy content (the staff page has a 117 × 31 timesheet)
 * a `useState` for «which dialog is open» sits in the page component, so every
 * open and close re-renders the whole page — that was seconds of lag on
 * `/settings/users`. With a detached state the page keeps a stable setter (the
 * same call shape as `useState`'s: a value or an updater) and never re-renders
 * when the value changes; only the components that read it with
 * `useDetachedValue` / `<DetachedValue>` do.
 */
export type DetachedState<T> = {
  get: () => T;
  set: (next: T | ((previous: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createDetachedState<T>(initial: T): DetachedState<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      // Like useState: a function is an updater. Values here are dialog
      // descriptors, flags and records — never functions themselves.
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One store per component instance; the object (and its `set`) never changes. */
export function useDetachedState<T>(initial: T): DetachedState<T> {
  const [state] = useState(() => createDetachedState(initial));
  return state;
}

/** Read a detached state; re-renders only the calling component on change. */
export function useDetachedValue<T>(state: DetachedState<T>): T {
  return useSyncExternalStore(state.subscribe, state.get, state.get);
}
