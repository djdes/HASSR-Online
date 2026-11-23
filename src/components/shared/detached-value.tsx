"use client";

import type { ReactNode } from "react";

import { useDetachedValue, type DetachedState } from "@/lib/detached-state";

/**
 * Renders `children(value)` and re-renders only itself when the detached state
 * changes — the page around it stays as it was. The render function comes from
 * the parent's latest render, so it always sees the parent's current props and
 * handlers.
 */
export function DetachedValue<T>(props: { state: DetachedState<T>; children: (value: T) => ReactNode }) {
  const value = useDetachedValue(props.state);
  return <>{props.children(value)}</>;
}
