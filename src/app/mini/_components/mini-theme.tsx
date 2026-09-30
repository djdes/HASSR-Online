"use client";

import { useSession } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  SiteThemeBridge,
  type SiteThemeState,
  type ThemeMode,
} from "@/components/theme/site-theme";

import {
  MINI_ROOT_ID,
  THEME_CHANGE_EVENT,
  THEME_KEYS,
  choiceStorageEntries,
  deviceTheme,
  effectiveMiniTheme,
  isMiniTheme,
  miniThemeBootstrapCode,
  readStoredChoice,
  resolveMiniThemeChoice,
  type MiniTheme,
  type MiniThemeChoice,
} from "./mini-theme-model";
import { getTelegramWebApp, isInsideTelegram } from "./telegram-web-app";

export type { MiniTheme } from "./mini-theme-model";

/** До отрисовки кадра в браузере; на сервере эффектов нет. */
const useBeforePaintEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Тема мини-приложения: «Светлая», «Тёмная» или «Как на устройстве» —
 * те же три варианта, что в меню профиля сайта.
 *
 * Выбор общий с сайтом: те же ключи localStorage (`mini-theme-model.ts`,
 * `THEME_KEYS`), то же событие внутри вкладки и тот же профиль
 * (`/api/me/theme`, `User.themePreference` — светлая или тёмная, источник
 * правды между устройствами; сервер подставляет её в разметку).
 * «Как на устройстве», как и на сайте, — настройка устройства: в
 * localStorage режим `system`, в профиль уходит действующая тема. Внутри
 * Telegram «устройство» — сам Telegram (`colorScheme` и событие
 * `themeChanged`), в приложении WeSetup и браузере — тема телефона
 * (`prefers-color-scheme`).
 */
const ATTRIBUTE = "data-theme";
const APP_SHELL_ATTRIBUTE = "data-app-theme";

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
  /** Действующая тема экрана. */
  theme: MiniTheme;
  /** Выбор человека: светлая, тёмная или как на устройстве. */
  mode: ThemeMode;
  /** Смена по времени суток (включается на сайте) — тогда тему задаёт час. */
  autoBySchedule: boolean;
  setMode: (mode: ThemeMode) => void;
  setAutoBySchedule: (on: boolean) => void;
  /** Явная светлая или тёмная — то же, что `setMode`. */
  setTheme: (theme: MiniTheme) => void;
  toggle: () => void;
};

const MiniThemeContext = createContext<Ctx | null>(null);

type State = MiniThemeChoice & { theme: MiniTheme };

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // localStorage blocked
  }
}

function storageWrite(entries: Array<[string, string]>): void {
  try {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
  } catch {
    /* localStorage blocked */
  }
}

/** Светлый или тёмный сам клиент Telegram. Вне Telegram — null. */
function readTelegramColorScheme(): MiniTheme | null {
  if (typeof window === "undefined" || !isInsideTelegram()) return null;
  const scheme = getTelegramWebApp()?.colorScheme;
  return isMiniTheme(scheme) ? scheme : null;
}

function prefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return false;
  }
}

/** Действующая тема для выбора — прямо сейчас (час, Telegram, система). */
function effectiveNow(choice: MiniThemeChoice): MiniTheme {
  return effectiveMiniTheme(choice, {
    hour: new Date().getHours(),
    device: deviceTheme({
      telegramColorScheme: readTelegramColorScheme(),
      prefersDark: prefersDark(),
    }),
  });
}

/**
 * Как применяется выбор:
 *  - `resolve` — выбор прочитан (загрузка, доехала тема профиля, соседняя
 *    вкладка): только экран, ничего не пишем — иначе значение по
 *    умолчанию, записанное до входа, потом побеждало выбор в профиле;
 *  - `live` — тема устройства или час сменились сами: как сайт — новая
 *    действующая тема в localStorage, событие, профиль;
 *  - `explicit` — выбор человека: все три ключа, событие, профиль.
 */
type CommitKind = "resolve" | "live" | "explicit";

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
  const [state, setState] = useState<State>({
    theme: initialTheme,
    mode: initialTheme,
    autoBySchedule: false,
  });
  // То же состояние для обработчиков и подписок — без устаревших замыканий.
  const current = useRef<State>(state);
  // Тема из профиля, доехавшая уже после входа (вход в Telegram
  // происходит на клиенте, и серверная разметка про него не знает).
  const [lateProfileTheme, setLateProfileTheme] = useState<MiniTheme | null>(
    null
  );
  const effectiveProfileTheme = profileTheme ?? lateProfileTheme;
  // Человек выбрал сам — дальше его выбор в localStorage главнее профиля:
  // ответ сервера, выехавший следом, не должен вернуть прежний вид.
  const userPicked = useRef(false);

  const commit = useCallback((choice: MiniThemeChoice, kind: CommitKind) => {
    const theme = effectiveNow(choice);
    const previous = current.current.theme;
    const next: State = { ...choice, theme };
    current.current = next;
    setState(next);
    applyThemeToDOM(theme);
    if (kind === "resolve") return;
    if (kind === "live" && theme === previous) return;
    storageWrite(
      kind === "explicit"
        ? choiceStorageEntries(choice, theme)
        : [[THEME_KEYS.effective, theme]]
    );
    announce(theme);
    persistThemeToServerSoon(theme);
  }, []);

  // Выбор лежит в localStorage и в Telegram — сервер их не видит, прочитать
  // можно только после гидрации (экран уже покрасил скрипт до гидрации,
  // состояние догоняет его). Тот же законный приём, что в site-theme.tsx.
  // До отрисовки кадра: экраны `/mini/*` и страницы кабинета в оболочке —
  // разные layout'ы, при переходе между ними оболочка монтируется заново
  // без скрипта до гидрации, и обычный эффект показывал кадр в теме
  // сервера (профиля), пока не применял «как на устройстве».
  useBeforePaintEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    commit(
      resolveMiniThemeChoice({
        profileTheme: userPicked.current ? null : effectiveProfileTheme,
        stored: readStoredChoice(storageGet),
        telegramColorScheme: readTelegramColorScheme(),
        fallback: initialTheme,
      }),
      "resolve"
    );
  }, [commit, effectiveProfileTheme, initialTheme]);

  // Вход из Telegram проходит на клиенте, серверная разметка отдана
  // раньше и с темой по умолчанию. Как только сессия появилась —
  // спрашиваем сохранённый выбор и применяем его сразу, без
  // перезагрузки страницы.
  const { status } = useSession();
  const profileAsked = useRef(false);
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
        if (isMiniTheme(body.theme)) setLateProfileTheme(body.theme);
      } catch {
        /* нет связи — остаёмся на том, что уже показано */
      }
    })();
  }, [profileTheme, status]);

  // «Как на устройстве» и смена по времени суток живут сами: тема
  // Telegram или телефона сменилась, час перевалил за 7:00 / 19:00.
  const { mode, autoBySchedule } = state;
  useEffect(() => {
    if (!autoBySchedule && mode !== "system") return;
    const recompute = () => commit({ mode, autoBySchedule }, "live");
    if (autoBySchedule) {
      const id = window.setInterval(recompute, 5 * 60 * 1000);
      return () => window.clearInterval(id);
    }
    // В Telegram «устройство» — сам Telegram: его тема и событие.
    const tg = getTelegramWebApp();
    if (readTelegramColorScheme() && tg?.onEvent) {
      tg.onEvent("themeChanged", recompute);
      return () => tg.offEvent?.("themeChanged", recompute);
    }
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    mql?.addEventListener?.("change", recompute);
    return () => mql?.removeEventListener?.("change", recompute);
  }, [autoBySchedule, commit, mode]);

  // Выбор в соседней вкладке (сайт или приложение) и чужой переключатель
  // в этой же вкладке. Своё событие приходит с уже показанной темой.
  useEffect(() => {
    function onCustom(e: Event) {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isMiniTheme(detail) || detail === current.current.theme) return;
      const stored = readStoredChoice(storageGet);
      const next: State = {
        mode: stored.mode ?? detail,
        autoBySchedule: stored.auto,
        theme: detail,
      };
      current.current = next;
      setState(next);
      applyThemeToDOM(detail);
    }
    function onStorage(e: StorageEvent) {
      if (
        e.key !== null &&
        e.key !== THEME_KEYS.effective &&
        e.key !== THEME_KEYS.mode &&
        e.key !== THEME_KEYS.auto
      ) {
        return;
      }
      // Соседняя вкладка уже всё записала и сохранила — только показываем.
      commit(
        resolveMiniThemeChoice({
          profileTheme: null,
          stored: readStoredChoice(storageGet),
          telegramColorScheme: readTelegramColorScheme(),
          fallback: current.current.theme,
        }),
        "resolve"
      );
    }
    window.addEventListener(THEME_CHANGE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, [commit]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      userPicked.current = true;
      commit({ mode: next, autoBySchedule: false }, "explicit");
    },
    [commit]
  );

  const setAutoBySchedule = useCallback(
    (on: boolean) => {
      userPicked.current = true;
      commit({ mode: current.current.mode, autoBySchedule: on }, "explicit");
    },
    [commit]
  );

  const setTheme = useCallback((next: MiniTheme) => setMode(next), [setMode]);

  const toggle = useCallback(() => {
    setMode(current.current.theme === "dark" ? "light" : "dark");
  }, [setMode]);

  const value = useMemo<Ctx & SiteThemeState>(
    () => ({
      theme: state.theme,
      mode: state.mode,
      autoBySchedule: state.autoBySchedule,
      setMode,
      setAutoBySchedule,
      setTheme,
      toggle,
    }),
    [setAutoBySchedule, setMode, setTheme, state, toggle]
  );

  return (
    <MiniThemeContext.Provider value={value}>
      {/* Страницы сайта в оболочке («Настройки → Внешний вид») читают
          `useSiteTheme()` — отвечаем им этой же темой. */}
      <SiteThemeBridge value={value}>{children}</SiteThemeBridge>
    </MiniThemeContext.Provider>
  );
}

export function useMiniTheme(): Ctx {
  const ctx = useContext(MiniThemeContext);
  if (!ctx) {
    return {
      theme: "dark",
      mode: "dark",
      autoBySchedule: false,
      setMode: () => {},
      setAutoBySchedule: () => {},
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
  const tg = getTelegramWebApp();
  if (tg) {
    try {
      tg.setHeaderColor?.(MINI_HERO_COLOR);
      tg.setBackgroundColor?.(miniBackgroundColor(theme));
    } catch {
      /* old client — silent */
    }
  }
}

/** Сообщить остальным слушателям вкладки (сайтовый провайдер оболочки). */
function announce(theme: MiniTheme) {
  try {
    window.dispatchEvent(new CustomEvent<MiniTheme>(THEME_CHANGE_EVENT, { detail: theme }));
  } catch {
    /* ignore */
  }
}

/**
 * Профиль — одним запросом на действие. Выбор карточки при включённой
 * смене по времени — два шага подряд (выключить смену, выбрать режим), и
 * два запроса могли бы доехать в обратном порядке: в профиле осталась бы
 * промежуточная тема. Уходит последняя.
 */
let pendingServerTheme: MiniTheme | null = null;
function persistThemeToServerSoon(theme: MiniTheme) {
  const scheduled = pendingServerTheme !== null;
  pendingServerTheme = theme;
  if (scheduled) return;
  // Следующий такт микрозадач: оба шага одного нажатия уже прошли.
  void Promise.resolve().then(() => {
    const next = pendingServerTheme;
    pendingServerTheme = null;
    if (next) void persistThemeToServer(next);
  });
}

async function persistThemeToServer(theme: MiniTheme): Promise<void> {
  // Best-effort cross-device sync. Source of truth on this device — localStorage.
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

/**
 * Скрипт до гидрации: применяет нужную тему к `#mini-root`, чтобы не было
 * вспышки светлого по тёмному и наоборот. Порядок — как у провайдера
 * (`miniThemeBootstrapCode` в `mini-theme-model.ts`).
 */
export function MiniThemeBootstrap({
  hasProfileTheme = false,
}: {
  /** У сервера была сессия и тема из профиля уже в разметке. */
  hasProfileTheme?: boolean;
} = {}) {
  return (
    <script dangerouslySetInnerHTML={{ __html: miniThemeBootstrapCode(hasProfileTheme) }} />
  );
}
