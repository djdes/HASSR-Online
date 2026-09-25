"use client";

import { useSession } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isInsideTelegram } from "./telegram-web-app";

export type MiniTheme = "dark" | "light";

/**
 * Shared with the site (`SiteThemeProvider`) — both providers read/write
 * the same localStorage key, so toggling theme in Mini App propagates to
 * any open `wesetup.ru/dashboard` tab and vice versa via the storage
 * event. DB column `User.themePreference` is the cross-device source of
 * truth, hydrated server-side into `initialTheme` on every layout render.
 */
const STORAGE_KEY = "wesetup-app-theme";
/** Ключи сайтового провайдера (`site-theme.tsx`) — держим согласованными:
 *  иначе обычный кабинет на компьютере считает, что человек выбрал
 *  «как в системе», и перекрашивает страницы обратно. */
const SITE_MODE_KEY = "wesetup-theme-mode";
const SITE_AUTO_KEY = "wesetup-theme-auto-schedule";
const ATTRIBUTE = "data-theme";
const APP_SHELL_ATTRIBUTE = "data-app-theme";
const MINI_ROOT_ID = "mini-root";
const CUSTOM_EVENT = "wesetup-theme-change";

/** Legacy key — only read for one-time migration. */
const LEGACY_MINI_KEY = "wesetup-mini-theme";

/**
 * Цвет фирменной шапки — тот же, что `theme-color` QR-страниц. Шапка
 * Telegram красится в него же и сливается с нашей в одну полосу.
 */
export const MINI_HERO_COLOR = "#0b1024";

/** Фон экрана под шапкой: `--mini-bg` светлой и тёмной темы (mini-theme.css). */
export function miniBackgroundColor(theme: MiniTheme): string {
  return theme === "dark" ? "#2b2841" : "#fafbff";
}

type Ctx = {
  theme: MiniTheme;
  setTheme: (t: MiniTheme) => void;
  toggle: () => void;
};

const MiniThemeContext = createContext<Ctx | null>(null);

/** Выбор, сохранённый на этом устройстве. Пишется только явным
    переключением темы — ни сервером, ни значением по умолчанию. */
function readStoredTheme(): MiniTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    const legacy = window.localStorage.getItem(LEGACY_MINI_KEY);
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {
    /* localStorage blocked */
  }
  return null;
}

/** Светлый или тёмный сам клиент Telegram. Вне Telegram — null. */
function readTelegramColorScheme(): MiniTheme | null {
  if (typeof window === "undefined") return null;
  if (!isInsideTelegram()) return null;
  const scheme = (
    window as unknown as {
      Telegram?: { WebApp?: { colorScheme?: string } };
    }
  ).Telegram?.WebApp?.colorScheme;
  return scheme === "light" || scheme === "dark" ? scheme : null;
}

/**
 * Какая тема должна быть прямо сейчас.
 *
 * Порядок строгий:
 *   1. выбор человека в профиле (`User.themePreference`) — он и на
 *      другом устройстве тот же;
 *   2. выбор, сделанный на этом устройстве, пока человек не вошёл;
 *   3. тема самого Telegram, если открыто внутри него;
 *   4. значение по умолчанию.
 */
function resolveTheme(
  profileTheme: MiniTheme | null,
  fallback: MiniTheme
): MiniTheme {
  return (
    profileTheme ??
    readStoredTheme() ??
    readTelegramColorScheme() ??
    fallback
  );
}

export function MiniThemeProvider({
  children,
  initialTheme = "dark",
  profileTheme = null,
}: {
  children: ReactNode;
  /** Тема, в которой отрисован сервер: profileTheme либо значение
      по умолчанию для ещё не вошедшего. */
  initialTheme?: MiniTheme;
  /** `User.themePreference` вошедшего; null — сессии на сервере не было. */
  profileTheme?: MiniTheme | null;
}) {
  const [theme, setThemeState] = useState<MiniTheme>(initialTheme);
  // Тема из профиля, доехавшая уже после входа (вход в Telegram
  // происходит на клиенте, и серверная разметка про него не знает).
  const [lateProfileTheme, setLateProfileTheme] = useState<MiniTheme | null>(
    null
  );
  const effectiveProfileTheme = profileTheme ?? lateProfileTheme;

  useEffect(() => {
    const next = resolveTheme(effectiveProfileTheme, initialTheme);
    setThemeState(next);
    applyThemeToDOM(next);
    // Ничего не пишем в localStorage: значение по умолчанию, записанное
    // до входа, потом побеждало настоящий выбор человека в профиле.
  }, [effectiveProfileTheme, initialTheme]);

  // Вход из Telegram проходит на клиенте, серверная разметка отдана
  // раньше и с темой по умолчанию. Как только сессия появилась —
  // спрашиваем сохранённый выбор и применяем его сразу, без
  // перезагрузки страницы.
  const { status } = useSession();
  const profileAsked = useRef(false);
  // Человек переключил тему сам — ответ сервера, выехавший следом, не
  // должен вернуть экран к прежнему виду.
  const userPicked = useRef(false);
  useEffect(() => {
    if (status !== "authenticated") return;
    if (profileTheme !== null || profileAsked.current) return;
    profileAsked.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/me/theme", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { theme?: unknown };
        if (userPicked.current) return;
        if (body.theme === "light" || body.theme === "dark") {
          setLateProfileTheme(body.theme);
        }
      } catch {
        /* нет связи — остаёмся на том, что уже показано */
      }
    })();
  }, [profileTheme, status]);

  useEffect(() => {
    function onCustom(e: Event) {
      const next = (e as CustomEvent<MiniTheme>).detail;
      if (next === "light" || next === "dark") {
        setThemeState(next);
        applyThemeToDOM(next);
      }
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === "light" || e.newValue === "dark") {
        setThemeState(e.newValue);
        applyThemeToDOM(e.newValue);
      }
    }
    window.addEventListener(CUSTOM_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CUSTOM_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = useCallback((next: MiniTheme) => {
    userPicked.current = true;
    setThemeState(next);
    // Чтобы эффект-расчёт, если он ещё раз запустится, дал тот же ответ.
    setLateProfileTheme(next);
    applyThemeToDOM(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      // Явный выбор человека: сайтовый провайдер не должен трактовать
      // его как «как в системе» и не должен включать авто по времени.
      window.localStorage.setItem(SITE_MODE_KEY, next);
      window.localStorage.setItem(SITE_AUTO_KEY, "0");
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(
        new CustomEvent<MiniTheme>(CUSTOM_EVENT, { detail: next })
      );
    } catch {
      /* ignore */
    }
    // Best-effort cross-device sync. Source of truth — localStorage.
    void persistThemeToServer(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return (
    <MiniThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </MiniThemeContext.Provider>
  );
}

export function useMiniTheme(): Ctx {
  const ctx = useContext(MiniThemeContext);
  if (!ctx) {
    return {
      theme: "dark",
      setTheme: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}

function applyThemeToDOM(theme: MiniTheme) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(MINI_ROOT_ID);
  if (el) {
    // Mini App уровень — для всех Mini-card/Mini-pill/Mini-btn компонентов.
    el.setAttribute(ATTRIBUTE, theme);
    // App-shell уровень — для site-компонентов, встроенных в Mini App
    // (например site-редактор документа в /mini/documents/[id]). Без
    // этого встроенные `bg-white` карточки сайта оставались белыми,
    // когда Mini App в dark — некрасиво и плохо читаемо.
    el.setAttribute(APP_SHELL_ATTRIBUTE, theme);
  }

  // Sync Telegram WebApp chrome.
  const tg = (
    window as unknown as {
      Telegram?: { WebApp?: TelegramWebAppChrome };
    }
  ).Telegram?.WebApp;
  if (tg) {
    try {
      tg.setHeaderColor?.(MINI_HERO_COLOR);
      tg.setBackgroundColor?.(miniBackgroundColor(theme));
    } catch {
      /* old client — silent */
    }
  }
}

async function persistThemeToServer(theme: MiniTheme): Promise<void> {
  try {
    await fetch("/api/me/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}

type TelegramWebAppChrome = {
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
};

/**
 * Скрипт до гидрации: применяет нужную тему к `#mini-root`, чтобы не
 * было вспышки светлого по тёмному и наоборот.
 *
 * Тот же порядок, что и у провайдера. Когда человек вошёл, сервер уже
 * отрисовал разметку с его темой из профиля — трогать нечего. Когда не
 * вошёл, разметка пришла с темой по умолчанию, и тут выбираем: выбор,
 * сделанный на этом устройстве, иначе тема самого Telegram.
 */
export function MiniThemeBootstrap({
  hasProfileTheme = false,
}: {
  /** У сервера была сессия и тема из профиля уже в разметке. */
  hasProfileTheme?: boolean;
} = {}) {
  const code = `(function(){try{
  if(${hasProfileTheme ? "true" : "false"})return;
  var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
  if(t!=='light'&&t!=='dark'){t=localStorage.getItem(${JSON.stringify(
    LEGACY_MINI_KEY
  )});}
  if(t!=='light'&&t!=='dark'){
    var w=window.Telegram&&window.Telegram.WebApp;
    var p=w&&typeof w.platform==='string'?w.platform.trim():'';
    var inside=!!w&&((typeof w.initData==='string'&&w.initData.length>0)||(p!==''&&p!=='unknown'));
    if(inside&&(w.colorScheme==='light'||w.colorScheme==='dark')){t=w.colorScheme;}
  }
  if(t==='light'||t==='dark'){
    var el=document.getElementById(${JSON.stringify(MINI_ROOT_ID)});
    if(el){el.setAttribute(${JSON.stringify(
      ATTRIBUTE
    )},t);el.setAttribute(${JSON.stringify(APP_SHELL_ATTRIBUTE)},t);}
  }
}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
