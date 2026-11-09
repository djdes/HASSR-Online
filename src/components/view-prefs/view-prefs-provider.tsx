"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import {
  DEFAULT_VIEW_PREFS,
  HIGH_CONTRAST_ATTR,
  STILL_ATTR,
  VIEW_PREFS_COOKIE,
  effectiveViewFlags,
  isDefaultViewPrefs,
  parseViewPrefs,
  viewPrefsCookieString,
  type ViewPrefs,
} from "@/lib/view-prefs";

/**
 * «Удобство чтения» в клиенте: текущие настройки устройства и их смена.
 * Начальное значение — то, что сервер прочитал из куки (`readViewPrefs`), и
 * атрибуты `<html>` уже в нём; смена сразу переписывает атрибуты и куку —
 * без перезагрузки и без запроса к серверу.
 */
type ViewPrefsContextValue = {
  prefs: ViewPrefs;
  update: (patch: Partial<ViewPrefs>) => void;
};

const ViewPrefsContext = createContext<ViewPrefsContextValue | null>(null);

/** Событие смены — для тех, кто живёт вне React (лендинг). */
export const VIEW_PREFS_EVENT = "wesetup-view-change";

function systemFlags() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { highContrast: false, reducedMotion: false };
  }
  return {
    highContrast: window.matchMedia("(prefers-contrast: more)").matches,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/** Атрибуты `<html>` и кука — под новые настройки. */
export function applyViewPrefsToDocument(prefs: ViewPrefs) {
  const root = document.documentElement;
  root.setAttribute("data-view-text", prefs.textSize);
  root.setAttribute("data-view-contrast", prefs.contrast);
  root.setAttribute("data-view-motion", prefs.motion);
  root.setAttribute("data-view-hints", prefs.hints);
  root.setAttribute("data-view-nav", prefs.navLayout);
  const flags = effectiveViewFlags(prefs, systemFlags());
  root.toggleAttribute(HIGH_CONTRAST_ATTR, flags.highContrast);
  root.toggleAttribute(STILL_ATTR, flags.still);
  try {
    document.cookie = isDefaultViewPrefs(prefs)
      ? `${VIEW_PREFS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : viewPrefsCookieString(prefs);
  } catch {
    /* куки запрещены — настройка живёт до перезагрузки */
  }
  window.dispatchEvent(new CustomEvent(VIEW_PREFS_EVENT, { detail: prefs }));
}

/** Текущие настройки по атрибутам `<html>` — для компонентов вне провайдера. */
function readDocumentViewPrefs(): ViewPrefs {
  if (typeof document === "undefined") return DEFAULT_VIEW_PREFS;
  const root = document.documentElement;
  return parseViewPrefs(
    [
      `t:${root.getAttribute("data-view-text") ?? ""}`,
      `c:${root.getAttribute("data-view-contrast") ?? ""}`,
      `m:${root.getAttribute("data-view-motion") ?? ""}`,
      `h:${root.getAttribute("data-view-hints") ?? ""}`,
      `n:${root.getAttribute("data-view-nav") ?? ""}`,
    ].join("|"),
  );
}

export function ViewPrefsProvider({ initial, children }: { initial: ViewPrefs; children: ReactNode }) {
  const [prefs, setPrefs] = useState(initial);
  const current = useRef(initial);
  const update = useCallback((patch: Partial<ViewPrefs>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    applyViewPrefsToDocument(next);
    setPrefs(next);
  }, []);
  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <ViewPrefsContext.Provider value={value}>{children}</ViewPrefsContext.Provider>;
}

/** Настройки «Удобства чтения» и их смена. */
export function useViewPrefs(): ViewPrefsContextValue {
  const context = useContext(ViewPrefsContext);
  const [fallback, setFallback] = useState<ViewPrefs | null>(null);
  if (context) return context;
  const prefs = fallback ?? readDocumentViewPrefs();
  return {
    prefs,
    update: (patch) => {
      const next = { ...readDocumentViewPrefs(), ...patch };
      applyViewPrefsToDocument(next);
      setFallback(next);
    },
  };
}
