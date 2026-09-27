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
 *
 * Тема Telegram. Скрипт Telegram (`telegram-web-app.js`) Next загружает уже
 * после разбора страницы (`beforeInteractive` — очередь `self.__next_s`),
 * поэтому здесь `window.Telegram` обычно ещё нет. Тогда тему считаем так
 * же, как посчитает он сам: параметры запуска — из адреса (`#tgWebAppPlatform=…
 * &tgWebAppThemeParams=…`) и из его `sessionStorage` (`__telegram__initParams`
 * — после переходов адрес их теряет; `__telegram__themeParams` — последняя
 * тема после `themeChanged`), тёмная — если у `bg_color` яркость HSP < 120.
 */
export function miniThemeBootstrapCode(hasProfileTheme: boolean): string {
  const key = (name: keyof typeof THEME_KEYS) => JSON.stringify(THEME_KEYS[name]);
  return `(function(){try{
  var s=window.localStorage;
  var tg=null;
  var w=window.Telegram&&window.Telegram.WebApp;
  if(w){
    var p=typeof w.platform==='string'?w.platform.trim():'';
    var inside=(typeof w.initData==='string'&&w.initData.length>0)||(p!==''&&p!=='unknown');
    if(inside&&(w.colorScheme==='light'||w.colorScheme==='dark')){tg=w.colorScheme;}
  }else{
    var ss=null;try{ss=window.sessionStorage;}catch(_){}
    var sget=function(k){try{return JSON.parse(ss.getItem('__telegram__'+k));}catch(_){return null;}};
    var ip=sget('initParams')||{};
    var h=String(window.location&&window.location.hash||'').replace(/^#/,'');
    var qi=h.indexOf('?');if(qi>=0){h=h.substr(qi+1);}
    if(h.indexOf('=')>=0){
      var ps=h.split('&');
      for(var i=0;i<ps.length;i++){
        var kv=ps[i].split('=');
        try{ip[decodeURIComponent(kv[0])]=kv[1]==null?null:decodeURIComponent(kv[1].replace(/\\+/g,'%20'));}catch(_){}
      }
    }
    var pl=typeof ip.tgWebAppPlatform==='string'?ip.tgWebAppPlatform.trim():'';
    if((typeof ip.tgWebAppData==='string'&&ip.tgWebAppData.length>0)||(pl!==''&&pl!=='unknown')){
      var bg=null;
      try{var tp=JSON.parse(ip.tgWebAppThemeParams||'null');if(tp&&tp.bg_color){bg=tp.bg_color;}}catch(_){}
      var st=sget('themeParams');if(st&&st.bg_color){bg=st.bg_color;}
      var c=String(bg||''),r=-1,g=0,b=0,m;
      if((m=/^\\s*#([0-9a-f]{6}|[0-9a-f]{3})\\s*$/i.exec(c))){
        var x=m[1];if(x.length==3){x=x[0]+x[0]+x[1]+x[1]+x[2]+x[2];}
        r=parseInt(x.substr(0,2),16);g=parseInt(x.substr(2,2),16);b=parseInt(x.substr(4,2),16);
      }else if((m=/^\\s*rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c))){r=+m[1];g=+m[2];b=+m[3];}
      tg=r>=0&&Math.sqrt(0.299*(r*r)+0.587*(g*g)+0.114*(b*b))<120?'dark':'light';
    }
  }
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
