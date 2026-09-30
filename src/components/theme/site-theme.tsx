"use client";

/* eslint-disable react-hooks/set-state-in-effect --
 * Этот файл — provider темы с legit hydration pattern: server рендерит
 * с темой устройства из куки (иначе — из профиля), client читает
 * localStorage и при необходимости пересинхронизируется. Первый кадр
 * красит inline-скрипт SiteThemeBootstrap — он стоит первым ребёнком
 * `.app-shell` и выставляет data-app-theme до hydration.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeCookieString,
} from "@/lib/theme-cookie";

/**
 * Применить тему до отрисовки кадра. На сервере layout-эффекта нет —
 * там обычный `useEffect` (он и так не выполняется).
 */
const useBeforePaintEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type SiteTheme = "dark" | "light";
/** Что юзер выбрал в UI. effective theme считается из этого + autoBySchedule. */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "wesetup-app-theme"; // effective light/dark (для bootstrap)
const STORAGE_MODE_KEY = "wesetup-theme-mode"; // "system" | "light" | "dark"
const STORAGE_AUTO_KEY = "wesetup-theme-auto-schedule"; // "1" | "0"
const ATTRIBUTE = "data-app-theme";
const CUSTOM_EVENT = "wesetup-theme-change";

/** Legacy key used briefly by the Mini App; we read it once for migration. */
const LEGACY_MINI_KEY = "wesetup-mini-theme";

/** Часы дневного времени — в этот промежуток выбираем светлую (если autoBySchedule). */
const DAY_HOUR_START = 7;
const DAY_HOUR_END = 19; // [7..19) — день, остальное — ночь

type Ctx = {
  /** Effective theme — то что реально применяется к DOM. */
  theme: SiteTheme;
  /** То что юзер выбрал в UI: system / light / dark. */
  mode: ThemeMode;
  /** Включена ли авто-смена по времени суток. */
  autoBySchedule: boolean;
  setMode: (m: ThemeMode) => void;
  setAutoBySchedule: (v: boolean) => void;
  /** Quick toggle между light/dark — пишет конкретный mode и выключает auto. */
  toggle: () => void;
  /** Backward-compat (раньше был setTheme в settings page) — пишет mode напрямую. */
  setTheme: (t: SiteTheme) => void;
};

const SiteThemeContext = createContext<Ctx | null>(null);

function isDayHour(hour: number): boolean {
  return hour >= DAY_HOUR_START && hour < DAY_HOUR_END;
}

function computeEffective(
  mode: ThemeMode,
  autoBySchedule: boolean,
  fallback: SiteTheme
): SiteTheme {
  if (autoBySchedule) {
    const hour = new Date().getHours();
    return isDayHour(hour) ? "light" : "dark";
  }
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  // system
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return fallback;
}

function readStoredMode(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_MODE_KEY);
    if (v === "system" || v === "light" || v === "dark") return v;
  } catch {
    /* storage blocked */
  }
  return null;
}

function readStoredAuto(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

function readInitialThemeFromStorage(fallback: SiteTheme): SiteTheme {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    const legacy = window.localStorage.getItem(LEGACY_MINI_KEY);
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {
    /* storage blocked */
  }
  return fallback;
}

export function SiteThemeProvider({
  children,
  initialTheme = "light",
  controlled = false,
}: {
  children: ReactNode;
  /** Server-loaded `User.themePreference`; используется как seed на первом
      визите этого устройства (когда localStorage пуст). После этого
      localStorage побеждает и переживает reload/SSR mismatch. */
  initialTheme?: SiteTheme;
  /**
   * Тему ведёт кто-то другой — оболочка мини-приложения
   * (`MiniThemeProvider`). Тогда этот провайдер только ОТРАЖАЕТ
   * текущее значение, но сам ничего не пересчитывает и не пишет
   * в localStorage: иначе «system» из браузера затирал выбор
   * человека, сделанный в профиле приложения. Страницам внутри
   * оболочки `useSiteTheme()` отдаёт сама оболочка (`SiteThemeBridge`).
   */
  controlled?: boolean;
}) {
  const [mode, setModeState] = useState<ThemeMode>(
    controlled ? initialTheme : "system"
  );
  const [autoBySchedule, setAutoState] = useState<boolean>(false);
  const [theme, setThemeState] = useState<SiteTheme>(initialTheme);
  // Выбор человека ещё не прочитан из localStorage. До этого `mode` —
  // значение по умолчанию ("system"), и пересчёт по нему на первом кадре
  // перекрашивал страницу в тему устройства и отправлял её в профиль —
  // при каждой загрузке у тех, чей выбор с темой устройства не совпадает:
  // мигание и пачка лишних POST /api/me/theme, из которых последним мог
  // доехать неверный.
  const [hydrated, setHydrated] = useState(false);

  // Hydrate из localStorage (см. file-level eslint-disable выше — это
  // legit hydration pattern, SSR-mismatch снимается SiteThemeBootstrap).
  // До отрисовки кадра: при клиентском переходе в кабинет (вход, возврат
  // из /root) скрипт до гидрации не выполняется, и обычный эффект успевал
  // показать кадр в теме сервера, если она расходилась с устройством.
  useBeforePaintEffect(() => {
    if (controlled) {
      // Читаем ТО ЖЕ значение, что и оболочка, и ничего не пишем.
      const current = readInitialThemeFromStorage(initialTheme);
      setThemeState(current);
      setModeState(current);
      setAutoState(false);
      return;
    }
    const storedMode = readStoredMode();
    const storedAuto = readStoredAuto();
    const storedEffective = readInitialThemeFromStorage(initialTheme);

    // Если mode не сохранён — пробуем восстановить из effective:
    //  light/dark в storage → юзер явно выбрал → mode="light"|"dark"
    //  пусто → mode="system"
    const effectiveMode: ThemeMode =
      storedMode ?? (storedEffective === "dark" ? "dark" : "light");

    setModeState(effectiveMode);
    setAutoState(storedAuto);

    const next = computeEffective(effectiveMode, storedAuto, storedEffective);
    setThemeState(next);
    applyThemeToDOM(next);
    setHydrated(true);

    // Seed effective storage для bootstrap script на следующем reload.
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
        if (storedMode === null) {
          window.localStorage.setItem(STORAGE_MODE_KEY, effectiveMode);
        }
      } catch {
        /* storage blocked */
      }
    }
  }, [controlled, initialTheme]);

  // Cross-tab/cross-instance sync.
  useEffect(() => {
    function onCustom(e: Event) {
      const next = (e as CustomEvent<SiteTheme>).detail;
      if (next === "light" || next === "dark") {
        setThemeState(next);
        applyThemeToDOM(next);
      }
    }
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        if (e.newValue === "light" || e.newValue === "dark") {
          setThemeState(e.newValue);
          applyThemeToDOM(e.newValue);
        }
      } else if (e.key === STORAGE_MODE_KEY) {
        const v = e.newValue;
        if (v === "system" || v === "light" || v === "dark") {
          setModeState(v);
        }
      } else if (e.key === STORAGE_AUTO_KEY) {
        setAutoState(e.newValue === "1");
      }
    }
    window.addEventListener(CUSTOM_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CUSTOM_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Live-recompute effective theme when mode / auto-schedule / system pref / time changes.
  useEffect(() => {
    // В оболочке приложения пересчитывать нечего: тему ведёт
    // `MiniThemeProvider`, а его выбор доезжает сюда событием
    // `wesetup-theme-change` (слушатель выше).
    if (controlled) return;
    // Пока выбор не прочитан — пересчитывать не по чему (см. `hydrated`).
    if (!hydrated) return;
    function recompute() {
      // Functional setState — читаем актуальное значение `theme` без него
      // в deps (иначе цикл: setTheme → useEffect re-run → setTheme).
      setThemeState((prev) => {
        const next = computeEffective(mode, autoBySchedule, prev);
        if (next !== prev) {
          applyThemeToDOM(next);
          try {
            window.localStorage.setItem(STORAGE_KEY, next);
            window.dispatchEvent(
              new CustomEvent<SiteTheme>(CUSTOM_EVENT, { detail: next })
            );
          } catch {
            /* ignore */
          }
          void persistThemeToServer(next);
        }
        return next;
      });
    }

    // ВАЖНО: пересчитываем сразу при любой смене mode/auto, иначе клик
    // «Тёмная» в popover'е менял только mode-state, но effective theme
    // оставался прежним и DOM не обновлялся.
    recompute();

    // a) System preference change (prefers-color-scheme) — слушаем только
    //    в режиме `system` без auto-by-schedule.
    let mqlCleanup: (() => void) | null = null;
    if (mode === "system" && !autoBySchedule && typeof window !== "undefined") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => recompute();
      if (mql.addEventListener) {
        mql.addEventListener("change", handler);
        mqlCleanup = () => mql.removeEventListener("change", handler);
      }
    }

    // b) Auto-by-schedule: проверять каждые 5 минут (час пересёк границу).
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (autoBySchedule) {
      intervalId = setInterval(recompute, 5 * 60 * 1000);
    }

    return () => {
      if (mqlCleanup) mqlCleanup();
      if (intervalId) clearInterval(intervalId);
    };
  }, [controlled, mode, autoBySchedule, hydrated]);

  /**
   * Переключение темы внутри оболочки приложения. Пишем ОБА ключа
   * (`…-app-theme` и `…-theme-mode`) согласованно и сообщаем событием —
   * шапка и нижнее меню перекрашиваются сразу, без перезагрузки.
   */
  const applyControlled = useCallback((next: SiteTheme) => {
    setModeState(next);
    setThemeState(next);
    applyThemeToDOM(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.localStorage.setItem(STORAGE_MODE_KEY, next);
      window.localStorage.setItem(STORAGE_AUTO_KEY, "0");
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(
        new CustomEvent<SiteTheme>(CUSTOM_EVENT, { detail: next })
      );
    } catch {
      /* ignore */
    }
    void persistThemeToServer(next);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    if (controlled) {
      // «Как в системе» в оболочке приложения смысла не имеет: экран
      // один и тема у него ровно одна — оставляем текущую.
      applyControlled(
        next === "dark" || next === "light"
          ? next
          : computeEffective("system", false, "light")
      );
      return;
    }
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_MODE_KEY, next);
      // Явный выбор режима = авто по времени выключено. Кнопки режимов и так
      // недоступны при включённом авто, но публичные страницы считают
      // отсутствие ключа «авто ещё не выключали» — фиксируем решение.
      window.localStorage.setItem(STORAGE_AUTO_KEY, "0");
    } catch {
      /* ignore */
    }
  }, [applyControlled, controlled]);

  const setAutoBySchedule = useCallback(
    (next: boolean) => {
      // В оболочке авто-смены по времени нет — переключатель там скрыт.
      if (controlled) return;
      setAutoState(next);
      try {
        window.localStorage.setItem(STORAGE_AUTO_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [controlled]
  );

  const toggle = useCallback(() => {
    // Quick toggle — отключает auto (юзер явно выбрал), флипает mode.
    setAutoBySchedule(false);
    setMode(theme === "dark" ? "light" : "dark");
  }, [setAutoBySchedule, setMode, theme]);

  const setTheme = useCallback(
    (next: SiteTheme) => {
      // Backward-compat: явный выбор light/dark — отключает auto, ставит mode.
      setAutoBySchedule(false);
      setMode(next);
    },
    [setAutoBySchedule, setMode]
  );

  return (
    <SiteThemeContext.Provider
      value={{
        theme,
        mode,
        autoBySchedule,
        setMode,
        setAutoBySchedule,
        toggle,
        setTheme,
      }}
    >
      {children}
    </SiteThemeContext.Provider>
  );
}

/** То, что отдаёт `useSiteTheme()`. */
export type SiteThemeState = Ctx;

/**
 * Отдать `useSiteTheme()` другому владельцу темы. В оболочке мини-приложения
 * тему ведёт `MiniThemeProvider` (Telegram, приложение WeSetup), и страницы
 * сайта внутри неё — например «Настройки → Внешний вид» — должны
 * переключать ту же тему, что и профиль приложения: с «Как на устройстве»
 * и сменой по времени суток, а не свою копию.
 */
export function SiteThemeBridge({
  value,
  children,
}: {
  value: SiteThemeState;
  children: ReactNode;
}) {
  return (
    <SiteThemeContext.Provider value={value}>{children}</SiteThemeContext.Provider>
  );
}

export function useSiteTheme(): Ctx {
  const ctx = useContext(SiteThemeContext);
  if (!ctx) {
    return {
      theme: "light",
      mode: "system",
      autoBySchedule: false,
      setMode: () => {},
      setAutoBySchedule: () => {},
      toggle: () => {},
      setTheme: () => {},
    };
  }
  return ctx;
}

/**
 * Покрасить экран. `rememberOnDevice` — записать тему в куку устройства
 * (`lib/theme-cookie.ts`): по ней сервер рисует следующий кадр — загрузку,
 * `router.refresh()`, переход в другой раздел — сразу в этой теме. Для
 * публичных страниц не пишем: там своя тема (по времени суток), а кука —
 * про кабинет.
 */
function applyThemeToDOM(theme: SiteTheme, rememberOnDevice = true) {
  if (typeof document === "undefined") return;
  const shells = document.querySelectorAll<HTMLElement>(".app-shell");
  shells.forEach((el) => el.setAttribute(ATTRIBUTE, theme));

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (meta) {
    meta.setAttribute("content", theme === "dark" ? "#2b2841" : "#ffffff");
  }
  if (rememberOnDevice) writeThemeCookie(theme);
}

function writeThemeCookie(theme: SiteTheme) {
  try {
    if (readThemeCookie() !== theme) document.cookie = themeCookieString(theme);
  } catch {
    /* cookies blocked */
  }
}

function readThemeCookie(): SiteTheme | null {
  const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)`).exec(
    document.cookie
  );
  return match ? (match[1] as SiteTheme) : null;
}

async function persistThemeToServer(theme: SiteTheme): Promise<void> {
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
 * Код inline-скрипта до hydration: применяет выбор устройства к `.app-shell`.
 * Учитывает mode + autoBySchedule, чтобы не было flash:
 *   1. Если autoBySchedule — выбирает по часу.
 *   2. Иначе если mode=system — спрашивает matchMedia.
 *   3. Иначе берёт mode напрямую (light/dark).
 *   4. Fallback — старый ключ STORAGE_KEY (effective).
 * Красит оболочку, в которой стоит сам (`document.currentScript`), цвет
 * строки браузера и обновляет куку темы устройства — сервер нарисует
 * следующий кадр уже в ней.
 */
export function siteThemeBootstrapCode(): string {
  return `(function(){try{
    var modeKey=${JSON.stringify(STORAGE_MODE_KEY)};
    var autoKey=${JSON.stringify(STORAGE_AUTO_KEY)};
    var effectiveKey=${JSON.stringify(STORAGE_KEY)};
    var legacyKey=${JSON.stringify(LEGACY_MINI_KEY)};
    var attr=${JSON.stringify(ATTRIBUTE)};
    var cookieName=${JSON.stringify(THEME_COOKIE)};
    var t=null;
    var auto=localStorage.getItem(autoKey)==='1';
    var mode=localStorage.getItem(modeKey);
    if(auto){
      var h=new Date().getHours();
      t=(h>=${DAY_HOUR_START}&&h<${DAY_HOUR_END})?'light':'dark';
    } else if(mode==='light'||mode==='dark'){
      t=mode;
    } else if(mode==='system'){
      try{
        t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
      }catch(_){t='light';}
    } else {
      t=localStorage.getItem(effectiveKey);
      if(t!=='light'&&t!=='dark'){t=localStorage.getItem(legacyKey);}
    }
    if(t==='light'||t==='dark'){
      var host=document.currentScript&&document.currentScript.parentElement;
      var els=host&&host.classList&&host.classList.contains('app-shell')?[host]:document.querySelectorAll('.app-shell');
      for(var i=0;i<els.length;i++){
        var was=els[i].getAttribute?els[i].getAttribute(attr):null;
        els[i].setAttribute(attr,t);
        if(was&&was!==t){try{console.info('[theme] до отрисовки: сервер '+was+' → устройство '+t);}catch(_){}}
      }
      var m=document.querySelector('meta[name="theme-color"]');
      if(m){m.setAttribute('content',t==='dark'?'#2b2841':'#ffffff');}
      if(!new RegExp('(?:^|;\\\\s*)'+cookieName+'='+t+'(?:;|$)').test(document.cookie)){
        document.cookie=cookieName+'='+t+'; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax';
      }
    }
  }catch(e){}})();`;
}

/**
 * Inline `<script>` до hydration. Ставить ПЕРВЫМ ребёнком `.app-shell`:
 * когда браузер его выполняет, открывающий тег оболочки уже разобран, а
 * её содержимое ещё нет — кадр рисуется сразу в теме устройства. Раньше
 * скрипт стоял перед `<div class="app-shell">`, не находил её и ничего не
 * делал — первый кадр всегда был в теме профиля.
 */
export function SiteThemeBootstrap() {
  return <script dangerouslySetInnerHTML={{ __html: siteThemeBootstrapCode() }} />;
}

/* ======================================================================
 * Публичные страницы: лендинг, блог, каталог журналов, тарифы.
 *
 * Тема вешается на <body> (класс `app-shell public-theme` + data-атрибут):
 * у публичных страниц нет общего layout-обёртки, а body есть у всех.
 * Правило: авто по времени суток, пока пользователь явно не выключил
 * авто в кабинете; тогда — выбранный там режим. Переключателя на
 * публичных страницах нет — решение владельца.
 * ==================================================================== */

const PUBLIC_BODY_CLASSES = ["app-shell", "public-theme"] as const;

/** Авто по времени — по умолчанию; "0" пишется только явным выбором в кабинете. */
function readPublicAuto(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

function computePublicTheme(): SiteTheme {
  return computeEffective(readStoredMode() ?? "system", readPublicAuto(), "light");
}

/**
 * Держит тему публичной страницы актуальной: применяет при монтировании,
 * пересчитывает раз в 5 минут (граница 7:00/19:00), слушает изменения
 * из кабинета в соседней вкладке и системную тему. При уходе со страницы
 * снимает классы с body — кабинет и форма входа живут своей темой.
 */
export function usePublicAutoTheme(): void {
  // До отрисовки кадра: при клиентском переходе на публичную страницу
  // скрипт до гидрации не выполняется, и первый кадр иначе выходил без
  // темы (ночью — светлая вспышка), а при уходе в кабинет — с чужими
  // классами на body.
  useBeforePaintEffect(() => {
    const body = document.body;
    body.classList.add(...PUBLIC_BODY_CLASSES);
    const apply = () => applyThemeToDOM(computePublicTheme(), false);
    apply();

    const interval = setInterval(apply, 5 * 60 * 1000);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("wesetup-theme")) apply();
    };
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    window.addEventListener("storage", onStorage);
    mql?.addEventListener?.("change", apply);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      mql?.removeEventListener?.("change", apply);
      body.classList.remove(...PUBLIC_BODY_CLASSES);
      body.removeAttribute(ATTRIBUTE);
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#0b1024");
    };
  }, []);
}

/** Клиентская часть: хук выше, разметки не рисует. */
export function PublicThemeScope() {
  usePublicAutoTheme();
  return null;
}

/**
 * Inline-скрипт до гидрации для публичных страниц — чтобы ночью не было
 * вспышки светлого. Рендерить в начале body (шапка), не в подвале:
 * браузер успевает отрисовать первый экран раньше, чем дойдёт до конца.
 */
export function PublicThemeBootstrap() {
  const code = `(function(){try{
    var modeKey=${JSON.stringify(STORAGE_MODE_KEY)};
    var autoKey=${JSON.stringify(STORAGE_AUTO_KEY)};
    var attr=${JSON.stringify(ATTRIBUTE)};
    var mode=localStorage.getItem(modeKey);
    var t;
    if(localStorage.getItem(autoKey)!=='0'){
      var h=new Date().getHours();
      t=(h>=${DAY_HOUR_START}&&h<${DAY_HOUR_END})?'light':'dark';
    } else if(mode==='light'||mode==='dark'){
      t=mode;
    } else {
      try{
        t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
      }catch(_){t='light';}
    }
    var b=document.body;
    b.classList.add('app-shell','public-theme');
    b.setAttribute(attr,t);
    var m=document.querySelector('meta[name="theme-color"]');
    if(m){m.setAttribute('content',t==='dark'?'#2b2841':'#ffffff');}
  }catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
