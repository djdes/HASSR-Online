// Заглушка window.Capacitor для e2e моста (bridge-e2e.ts): плагины пишут
// вызовы в window.__calls, события запускаются через window.__fire.
// Вызовы переживают полную перезагрузку страницы (sessionStorage), чтобы
// проверять порядок «до и после перехода».
export type StubConfig = {
  platform: "android" | "ios";
  /** Ответ FirebaseMessaging.checkPermissions до запроса. */
  permission: "granted" | "denied" | "prompt";
  /** Ответ requestPermissions. */
  grant: "granted" | "denied";
  token: string;
  launchUrl: string | null;
  /** Вырез сверху, как SystemBars Android: --safe-area-inset-top. */
  topInset: number;
};

export const DEFAULT_STUB: StubConfig = {
  platform: "android",
  permission: "prompt",
  grant: "granted",
  token: "fcm-e2e-token-0000000000000000000001",
  launchUrl: null,
  topInset: 0,
};

/** Выполняется в браузере до скриптов страницы. */
export function installCapacitorStub(cfg: StubConfig) {
  type Cb = (payload: unknown) => void;
  const w = window as unknown as Record<string, unknown>;
  const KEY = "__e2e_calls";
  let persisted: unknown[] = [];
  try {
    persisted = JSON.parse(sessionStorage.getItem(KEY) || "[]");
  } catch {
    persisted = [];
  }
  const calls: unknown[] = persisted;
  w.__calls = calls;
  const listeners: Record<string, Cb[]> = {};
  w.__listeners = listeners;
  let permission: string = cfg.permission;
  try {
    permission = sessionStorage.getItem("__e2e_perm") || cfg.permission;
  } catch {
    /* */
  }
  const record = (p: string, m: string, a?: unknown) => {
    calls.push({ p, m, a: a === undefined ? null : a, at: location.pathname });
    try {
      sessionStorage.setItem(KEY, JSON.stringify(calls));
    } catch {
      /* */
    }
  };
  const plugin = (name: string, methods: Record<string, (a?: unknown) => unknown>) => {
    const obj: Record<string, unknown> = {};
    for (const [m, fn] of Object.entries(methods)) {
      obj[m] = (a?: unknown) => {
        // У writeFile в записи — не весь base64, а начало и длина.
        const shown =
          name === "Filesystem" && a && typeof a === "object"
            ? { ...(a as Record<string, unknown>), data: String((a as { data?: string }).data).slice(0, 40), len: String((a as { data?: string }).data).length }
            : a;
        record(name, m, shown);
        try {
          return Promise.resolve(fn(a));
        } catch (e) {
          return Promise.reject(e);
        }
      };
    }
    obj.addListener = (event: string, cb: Cb) => {
      const k = `${name}:${event}`;
      (listeners[k] ||= []).push(cb);
      record(name, "addListener", event);
      return Promise.resolve({
        remove: () => {
          listeners[k] = (listeners[k] || []).filter((x) => x !== cb);
        },
      });
    };
    return obj;
  };
  w.__fire = (name: string, event: string, payload: unknown) => {
    for (const cb of listeners[`${name}:${event}`] || []) cb(payload);
    return (listeners[`${name}:${event}`] || []).length;
  };
  w.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => cfg.platform,
    Plugins: {
      WebPrint: plugin("WebPrint", { print: () => undefined, openSettings: () => undefined }),
      App: plugin("App", {
        getLaunchUrl: () => (cfg.launchUrl ? { url: cfg.launchUrl } : undefined),
        minimizeApp: () => undefined,
        exitApp: () => undefined,
        getInfo: () => ({ version: "1.0.0" }),
      }),
      AppLauncher: plugin("AppLauncher", { openUrl: () => ({ completed: true }), canOpenUrl: () => ({ value: true }) }),
      Filesystem: plugin("Filesystem", {
        writeFile: (a) => ({ uri: `file:///cache/${(a as { path: string }).path}` }),
      }),
      Share: plugin("Share", { share: () => ({}) }),
      FirebaseMessaging: plugin("FirebaseMessaging", {
        checkPermissions: () => ({ receive: permission }),
        requestPermissions: () => {
          permission = cfg.grant;
          try {
            sessionStorage.setItem("__e2e_perm", permission);
          } catch {
            /* */
          }
          return { receive: permission };
        },
        getToken: () => ({ token: cfg.token }),
        deleteToken: () => undefined,
      }),
      SpeechRecognition: plugin("SpeechRecognition", {
        available: () => ({ available: true }),
        requestPermissions: () => ({ speechRecognition: "granted" }),
        start: () => ({ matches: ["проверка голоса"] }),
        stop: () => undefined,
      }),
      StatusBar: plugin("StatusBar", { setStyle: () => undefined, setBackgroundColor: () => undefined }),
    },
  };
  if (cfg.topInset) {
    const set = () => {
      document.documentElement.style.setProperty("--safe-area-inset-top", `${cfg.topInset}px`);
      document.documentElement.style.setProperty("--safe-area-inset-bottom", "24px");
    };
    if (document.documentElement) set();
    document.addEventListener("DOMContentLoaded", set);
  }
}
