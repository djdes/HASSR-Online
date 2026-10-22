"use client";
import { useLayoutEffect, useRef } from "react";
/** Feedback follows the latest committed instance, including detached instances. */
export function usePpeCommittedRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; }, [value]);
  return ref;
}
