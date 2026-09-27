import type { ThemeMode } from "@/components/theme/site-theme";
import { isThemeMode } from "@/components/theme/theme-tiles-model";

/**
 * Модель темы мини-приложения — без React и без `window`: порядок выбора,
 * «Как на устройстве», что пишется в localStorage и код скрипта до
 * гидрации. Провайдер (`mini-theme.tsx`) только подставляет сюда живые
 * значения; логика проверяется юнит-тестом (`mini-theme-model.test.ts`).
 */

export type MiniTheme = "dark" | "light";

/**
 * Ключи localStorage — те же, что у сайта (`components/theme/site-theme.tsx`):
 * выбор, сделанный на сайте, мини-приложение видит, и наоборот.
 */
export const THEME_KEYS = {
  /** Действующая тема `light` | `dark` — по ней красят скрипты до гидрации. */
  effective: "wesetup-app-theme",
  /** Выбор человека: `light` | `dark` | `system` («Как на устройстве»). */
  mode: "wesetup-theme-mode",
  /** Смена по времени суток: `"1"` включена, `"0"` выключена явным выбором. */
  auto: "wesetup-theme-auto-schedule",
  /** Ключ прежнего мини-приложения — только читаем. */
  legacy: "wesetup-mini-theme",
} as const;

/** Событие смены темы внутри вкладки — его же шлёт и слушает сайт. */
export const THEME_CHANGE_EVENT = "wesetup-theme-change";

/** `id` корня мини-приложения — его красят скрипт до гидрации и провайдер. */
export const MINI_ROOT_ID = "mini-root";

/** Часы смены по времени суток — как у сайта: [7:00, 19:00) светлая, остальное тёмная. */
export const DAY_HOUR_START = 7;
export const DAY_HOUR_END = 19;

export function isMiniTheme(value: unknown): value is MiniTheme {
  return value === "light" || value === "dark";
}

export function themeForHour(hour: number): MiniTheme {
  return hour >= DAY_HOUR_START && hour < DAY_HOUR_END ? "light" : "dark";
}

/** Что лежит в localStorage этого устройства. */
export type StoredThemeChoice = {
  mode: ThemeMode | null;
  auto: boolean;
  /** Действующая тема (или ключ прежнего мини-приложения). */
  effective: MiniTheme | null;
};

export function readStoredChoice(getItem: (key: string) => string | null): StoredThemeChoice {
  const mode = getItem(THEME_KEYS.mode);
  const effective = getItem(THEME_KEYS.effective);
  const legacy = isMiniTheme(effective) ? null : getItem(THEME_KEYS.legacy);
  return {
    mode: isThemeMode(mode) ? mode : null,
    auto: getItem(THEME_KEYS.auto) === "1",
    effective: isMiniTheme(effective) ? effective : isMiniTheme(legacy) ? legacy : null,
  };
}

/**
 * «Как на устройстве»: внутри Telegram — тема самого Telegram
 * (`WebApp.colorScheme`), вне его (приложение WeSetup, браузер) — тема
 * системы (`prefers-color-scheme`). `telegramColorScheme` — только когда
 * приложение открыто именно в Telegram, иначе `null`.
 */
export function deviceTheme(input: {
  telegramColorScheme: MiniTheme | null;
  prefersDark: boolean;
}): MiniTheme {
  return input.telegramColorScheme ?? (input.prefersDark ? "dark" : "light");
}

/** Выбор человека — как у сайта: режим и смена по времени суток. */
export type MiniThemeChoice = { mode: ThemeMode; autoBySchedule: boolean };

/**
 * Какой выбор действует сейчас. Порядок строгий:
 *   1. смена по времени суток, включённая на этом устройстве (на сайте);
 *   2. «Как на устройстве», выбранное на этом устройстве;
 *   3. тема профиля (`User.themePreference`) — на другом устройстве та же;
 *   4. светлая / тёмная, выбранная на этом устройстве до входа;
 *   5. тема самого Telegram;
 *   6. значение по умолчанию.
 * Первые два — настройки устройства, как на сайте (там localStorage главнее
 * профиля): в профиле лежит только светлая или тёмная, «как на устройстве»
 * туда не записать — на другом телефоне своя тема.
 */
export function resolveMiniThemeChoice(input: {
  profileTheme: MiniTheme | null;
  stored: StoredThemeChoice;
  telegramColorScheme: MiniTheme | null;
  fallback: MiniTheme;
}): MiniThemeChoice {
  const { profileTheme, stored, telegramColorScheme, fallback } = input;
  const storedExplicit = isMiniTheme(stored.mode) ? stored.mode : null;
  const explicit =
    profileTheme ?? storedExplicit ?? stored.effective ?? telegramColorScheme ?? fallback;
  if (stored.auto) {
    // Режим под сменой по времени — тот, к которому вернёт выключение смены.
    return { mode: stored.mode ?? explicit, autoBySchedule: true };
  }
  if (stored.mode === "system") return { mode: "system", autoBySchedule: false };
  return { mode: explicit, autoBySchedule: false };
}

/** Действующая тема для выбора: по часу, по устройству или ровно выбранная. */
export function effectiveMiniTheme(
  choice: MiniThemeChoice,
  env: { hour: number; device: MiniTheme }
): MiniTheme {
  if (choice.autoBySchedule) return themeForHour(env.hour);
  if (choice.mode === "system") return env.device;
  return choice.mode;
}

/**
 * Что пишется в localStorage при выборе человека — то же, что оставляет
 * сайт (`setMode` / `setAutoBySchedule` и пересчёт действующей темы):
 * режим, смена по времени суток, действующая тема.
 */
export function choiceStorageEntries(
  choice: MiniThemeChoice,
  effective: MiniTheme
): Array<[string, string]> {
  return [
    [THEME_KEYS.mode, choice.mode],
    [THEME_KEYS.auto, choice.autoBySchedule ? "1" : "0"],
    [THEME_KEYS.effective, effective],
  ];
}

/**
 * Код скрипта до гидрации: красит `#mini-root`, чтобы не было вспышки
 * светлого по тёмному и наоборот. Тот же порядок, что у
 * `resolveMiniThemeChoice`. Когда у сервера была сессия, разметка уже
 * пришла в теме профиля — её не трогаем, кроме настроек устройства
 * (смена по времени и «как на устройстве»): их сервер знать не может.
 */
export function miniThemeBootstrapCode(hasProfileTheme: boolean): string {
  const key = (name: keyof typeof THEME_KEYS) => JSON.stringify(THEME_KEYS[name]);
  return `(function(){try{
  var s=window.localStorage;
  var w=window.Telegram&&window.Telegram.WebApp;
  var p=w&&typeof w.platform==='string'?w.platform.trim():'';
  var inside=!!w&&((typeof w.initData==='string'&&w.initData.length>0)||(p!==''&&p!=='unknown'));
  var tg=inside&&(w.colorScheme==='light'||w.colorScheme==='dark')?w.colorScheme:null;
  var mode=s.getItem(${key("mode")});
  var t=null;
  if(s.getItem(${key("auto")})==='1'){
    var h=new Date().getHours();
    t=(h>=${DAY_HOUR_START}&&h<${DAY_HOUR_END})?'light':'dark';
  }else if(mode==='system'){
    t=tg||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  }else if(!${hasProfileTheme ? "true" : "false"}){
    t=mode==='light'||mode==='dark'?mode:s.getItem(${key("effective")});
    if(t!=='light'&&t!=='dark'){t=s.getItem(${key("legacy")});}
    if(t!=='light'&&t!=='dark'){t=tg;}
  }
  if(t==='light'||t==='dark'){
    var el=document.getElementById(${JSON.stringify(MINI_ROOT_ID)});
    if(el){el.setAttribute('data-theme',t);el.setAttribute('data-app-theme',t);}
  }
}catch(e){}})();`;
}
