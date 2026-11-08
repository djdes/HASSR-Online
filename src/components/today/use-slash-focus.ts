"use client";

import { useEffect, type RefObject } from "react";

import { isTypingTarget } from "@/lib/hotkeys";

/**
 * «/» — сразу в поиск журналов (как на GitHub и в Gmail), если человек не
 * печатает в другом поле. «Сегодня» и «Журналы».
 */
export function useSlashFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const input = ref.current;
      if (!input || input.getClientRects().length === 0) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}
