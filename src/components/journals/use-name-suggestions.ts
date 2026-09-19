"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  mergeSuggestions,
  normalizeSuggestionMeta,
  promoteSuggestions,
  suggestionKey,
  type NameSuggestionMeta,
  type NameSuggestionScope,
} from "@/lib/name-suggestions";

/**
 * Недавние наименования организации для выпадающего списка окна строки.
 *
 * `options(catalog)` — готовый список: недавние сверху, затем справочник
 * документа. `remember(values, meta)` — после сохранения строки: значения
 * сразу поднимаются наверх локально и уходят на сервер; ошибка сети
 * подсказки не ломает (список документа остаётся). `metaFor(name)` — что
 * вводили вместе с этим наименованием в прошлый раз (температура блюда).
 */
export function useNameSuggestions(scope: NameSuggestionScope) {
  const [recent, setRecent] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, NameSuggestionMeta>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/name-suggestions?scope=${scope}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload || !Array.isArray(payload.values)) return;
        setRecent(payload.values.filter((value: unknown): value is string => typeof value === "string"));
        const incoming: Record<string, NameSuggestionMeta> = {};
        if (payload.meta && typeof payload.meta === "object") {
          for (const [key, value] of Object.entries(payload.meta as Record<string, unknown>)) {
            const normalized = normalizeSuggestionMeta(value);
            if (normalized) incoming[key] = normalized;
          }
        }
        setMeta(incoming);
      })
      .catch(() => {
        /* без сети — работаем по справочнику документа */
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const remember = useCallback(
    async (
      values: readonly (string | null | undefined)[],
      metaByValue?: Record<string, NameSuggestionMeta | undefined>
    ) => {
      const clean = values.filter((value): value is string => typeof value === "string" && value.trim() !== "");
      if (clean.length === 0) return;
      setRecent((current) => promoteSuggestions(current, clean));
      if (metaByValue) {
        setMeta((current) => {
          const next = { ...current };
          for (const [value, entry] of Object.entries(metaByValue)) {
            const normalized = normalizeSuggestionMeta(entry);
            if (normalized) next[suggestionKey(value)] = { ...(next[suggestionKey(value)] ?? {}), ...normalized };
          }
          return next;
        });
      }
      await fetch("/api/name-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, values: clean, ...(metaByValue ? { meta: metaByValue } : {}) }),
      }).catch(() => {
        /* подсказка не критична */
      });
    },
    [scope]
  );

  const options = useCallback(
    (...catalogs: readonly (readonly string[])[]) => mergeSuggestions(recent, ...catalogs),
    [recent]
  );

  const metaFor = useCallback(
    (name: string): NameSuggestionMeta | null => meta[suggestionKey(name)] ?? null,
    [meta]
  );

  return useMemo(() => ({ recent, remember, options, metaFor }), [recent, remember, options, metaFor]);
}
