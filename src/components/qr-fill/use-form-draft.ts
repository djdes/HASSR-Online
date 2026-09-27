"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Черновик формы в localStorage: обновил страницу, пропал интернет, телефон
 * закрыл вкладку — введённое не теряется. Ключ включает объект и день,
 * после успешной записи черновик стирается, старше 12 часов — не подхватывается.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

export function draftKeyFor(scope: string, date: string | null | undefined): string {
  return `wesetup.draft:${scope}:${date ?? ""}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; v?: T };
    if (!parsed || typeof parsed.t !== "number" || Date.now() - parsed.t > TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.v ?? null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* приватный режим */
  }
}

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "-";
  return true;
}

/**
 * @param key      ключ черновика (null — не сохранять)
 * @param values   текущие значения формы (сериализуемые)
 * @param apply    как положить восстановленный черновик в состояние
 * @param finished true после успешной записи — черновик стирается
 */
export function useFormDraft<T extends Record<string, unknown>>(
  key: string | null,
  values: T,
  apply: (draft: Partial<T>) => void,
  finished: boolean
): { restored: boolean; reset: () => void } {
  const [restored, setRestored] = useState(false);
  const readyRef = useRef(false);
  // «Начать заново» стирает черновик и перезагружает страницу. Без стопа запись
  // успевала сработать ещё раз до перезагрузки (значения формы те же) — и
  // черновик возвращался: фото незаконченного замера восстанавливалось снова.
  const stoppedRef = useRef(false);
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  useEffect(() => {
    if (!key) return;
    const draft = readDraft<Partial<T>>(key);
    if (draft && Object.values(draft).some(meaningful)) {
      applyRef.current(draft);
      setRestored(true);
    }
    readyRef.current = true;
  }, [key]);

  useEffect(() => {
    if (!key || !readyRef.current || finished || stoppedRef.current) return;
    try {
      if (Object.values(values).some(meaningful)) localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: values }));
      else localStorage.removeItem(key);
    } catch {
      /* приватный режим */
    }
  }, [key, values, finished]);

  useEffect(() => {
    if (key && finished) clearDraft(key);
  }, [key, finished]);

  return {
    restored,
    reset: () => {
      stoppedRef.current = true;
      if (key) clearDraft(key);
      setRestored(false);
    },
  };
}
