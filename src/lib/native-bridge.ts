/**
 * Мост сайта к нативным функциям приложения WeSetup (Android и iOS).
 *
 * Приложение — Capacitor-оболочка: оно грузит сайт с сервера, а плагины
 * Capacitor видны странице как `window.Capacitor.Plugins`. Поэтому
 * npm-зависимостей Capacitor на сайте нет — только тонкие обёртки ниже.
 * Вне приложения `getNativeBridge()` возвращает null, и каждая функция
 * здесь ведёт себя ровно как сайт раньше.
 *
 * Сверху — чистые функции (их проверяет `native-bridge.test.ts`), ниже —
 * обёртки, которые трогают `window`.
 */

import { toast } from "sonner";

import { isMobileAppUserAgent } from "@/lib/mobile-app";

// ─── Чистые функции ────────────────────────────────────────────────────

export type LinkKind = "internal" | "download" | "external" | "system";

/** Расширения, которые на сайте бывают только файлами. */
const FILE_EXT_RE = /\.(pdf|xlsx|xls|csv|zip|docx|doc|txt)$/i;

/**
 * Что делать с нажатой ссылкой внутри приложения.
 *
 *   • `internal` — обычный экран сайта: не трогаем;
 *   • `download` — файл: скачать и открыть лист «Поделиться» (в WebView
 *     скачивание иначе молча ничего не делает);
 *   • `external` — чужой сайт: в браузер телефона;
 *   • `system` — почта, звонок, Telegram: в системное приложение.
 *
 * Все обработчики `/api/*`, на которые сайт ставит ссылки, отдают файлы
 * (отчёты, PDF, CSV, счета) — кроме входа и выхода NextAuth.
 */
export function classifyLink(
  href: string,
  currentOrigin: string,
  hasDownloadAttr: boolean
): LinkKind {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return "internal";
  if (/^(mailto|tel|sms):/i.test(raw)) return "system";
  if (/^(blob|data):/i.test(raw)) return "download";
  let url: URL;
  try {
    url = new URL(raw, currentOrigin);
  } catch {
    return "internal";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "system";
  if (url.origin !== currentOrigin) return "external";
  if (hasDownloadAttr) return "download";
  const path = url.pathname;
  if (path.startsWith("/api/") && !path.startsWith("/api/auth/")) return "download";
  if (FILE_EXT_RE.test(path)) return "download";
  return "internal";
}

/** Имя файла из `Content-Disposition`: `filename*` (UTF-8) важнее `filename`. */
export function fileNameFromContentDisposition(value: string | null | undefined): string | null {
  if (!value) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value);
  if (star) {
    try {
      const decoded = decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
      if (decoded) return decoded;
    } catch {
      /* битая кодировка — пробуем обычный filename */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(value);
  const name = (plain?.[2] ?? plain?.[1] ?? "").trim();
  return name || null;
}

const EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/zip": "zip",
  "text/csv": "csv",
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
};

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
}

/**
 * Имя файла для листа «Поделиться»: заголовок ответа, затем атрибут
 * `download`, затем последний сегмент адреса. Без расширения — добавляем
 * его по типу ответа: иначе телефон не знает, чем открыть файл.
 */
export function downloadFileName(input: {
  contentDisposition: string | null | undefined;
  downloadAttr: string | null | undefined;
  url: string;
  contentType: string | null | undefined;
}): string {
  let name = fileNameFromContentDisposition(input.contentDisposition) ?? "";
  if (!name && input.downloadAttr) name = input.downloadAttr;
  if (!name && !/^(blob|data):/i.test(input.url)) {
    try {
      const path = new URL(input.url, "https://wesetup.ru").pathname;
      name = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    } catch {
      name = "";
    }
  }
  name = sanitizeFileName(name) || "WeSetup";
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    const type = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (ext) name = `${name}.${ext}`;
  }
  return name;
}

/**
 * Ссылка из системы или уведомления → путь внутри сайта.
 *
 * Те же правила, что у `normalizePushUrl` (`mobile-push.ts`) — тест
 * сверяет их на одном наборе адресов. Копия, а не импорт: `mobile-push.ts`
 * серверный (node:crypto) и в браузер не попадает.
 */
export function normalizeAppUrl(href: string | null | undefined, extraHosts: string[] = []): string {
  const HOME = "/mini";
  if (!href) return HOME;
  let path = href.trim();
  if (!path) return HOME;
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      return HOME;
    }
    const own = new Set(["wesetup.ru", "www.wesetup.ru", ...extraHosts.map((h) => h.toLowerCase())]);
    if (!own.has(url.host.toLowerCase())) return HOME;
    path = `${url.pathname}${url.search}${url.hash}`;
  }
  if (/[\u0000-\u001f\\]/.test(path)) return HOME;
  if (!path.startsWith("/") || path.startsWith("//")) return HOME;
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/api" || pathname.startsWith("/api/")) return HOME;
  return path;
}

/**
 * Куда перейти по ссылке, которой открыли приложение. null — никуда:
 * ссылка чужая, это стартовый адрес приложения или человек уже там.
 */
export function deepLinkPath(
  url: string | null | undefined,
  current: string,
  ownHosts: string[] = []
): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const path = normalizeAppUrl(url, ownHosts);
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/mini") return null;
  return path === current ? null : path;
}

export type PushAskState = {
  choice: "later" | "enabled";
  at: number;
  laterCount: number;
};

export function parsePushAskState(raw: string | null | undefined): PushAskState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PushAskState>;
    if ((v.choice !== "later" && v.choice !== "enabled") || typeof v.at !== "number") return null;
    return {
      choice: v.choice,
      at: v.at,
      laterCount: typeof v.laterCount === "number" ? v.laterCount : 0,
    };
  } catch {
    return null;
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Что делать с уведомлениями при запуске.
 *
 *   • `register` — разрешение есть: (пере)регистрировать телефон;
 *   • `ask` — система ещё не спрашивала: показать лист-объяснение;
 *   • `none` — запрещено, либо человек нажал «Не сейчас» меньше недели
 *     назад, либо уже дважды отказался.
 */
export function pushExplainerAction(
  permission: string | null | undefined,
  state: PushAskState | null,
  now: number
): "register" | "ask" | "none" {
  if (permission === "granted") return "register";
  if (permission !== "prompt" && permission !== "prompt-with-rationale") return "none";
  if (!state) return "ask";
  if (state.choice === "later" && state.laterCount < 2 && now - state.at >= WEEK_MS) return "ask";
  return "none";
}

/**
 * Стиль строки состояния. У Capacitor `DARK` — светлые значки (для
 * тёмного фона), `LIGHT` — тёмные. Шапка оболочки тёмно-синяя в обеих
 * темах, поэтому под ней значки всегда светлые.
 */
export function statusBarStyle(input: { darkHeader: boolean; theme: "light" | "dark" }): "DARK" | "LIGHT" {
  if (input.darkHeader) return "DARK";
  return input.theme === "dark" ? "DARK" : "LIGHT";
}

/** Кнопка «назад» Android: назад по истории, с домашнего экрана — свернуть. */
export function backButtonAction(input: { isRoot: boolean; canGoBack: boolean }): "back" | "minimize" | "home" {
  if (input.isRoot) return "minimize";
  return input.canGoBack ? "back" : "home";
}

// ─── Обёртки над window.Capacitor ──────────────────────────────────────

type ListenerHandle = { remove: () => void | Promise<void> };

export type NativePlugin = {
  [method: string]: ((...args: never[]) => Promise<unknown>) | undefined;
} & {
  addListener?: (event: string, cb: (payload: never) => void) => Promise<ListenerHandle>;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, NativePlugin | undefined>;
};

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export type NativeBridge = {
  platform: "ios" | "android";
  /** Плагин по имени, если он есть в этой сборке приложения. */
  plugin(name: string): NativePlugin | null;
  /** Вызвать метод плагина; нет плагина или метода — `undefined`. */
  call<T = unknown>(pluginName: string, method: string, arg?: unknown): Promise<T | undefined>;
  /** Подписка на событие плагина; null — плагина нет. */
  on(pluginName: string, event: string, cb: (payload: unknown) => void): Promise<ListenerHandle | null>;
};

export function getNativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const cap = window.Capacitor;
  // Оба признака: плагины Capacitor и приписка приложения к User-Agent
  // (по ней сервер включает оболочку). Одного `window.Capacitor` мало —
  // его может подложить любая страница.
  if (!isMobileAppUserAgent(navigator.userAgent)) return null;
  try {
    if (!cap?.isNativePlatform?.()) return null;
  } catch {
    return null;
  }
  const platform = cap.getPlatform?.() === "ios" ? "ios" : "android";
  const plugin = (name: string): NativePlugin | null => window.Capacitor?.Plugins?.[name] ?? null;
  return {
    platform,
    plugin,
    async call<T>(pluginName: string, method: string, arg?: unknown) {
      const fn = plugin(pluginName)?.[method] as ((a?: unknown) => Promise<unknown>) | undefined;
      if (typeof fn !== "function") return undefined;
      return (await fn.call(plugin(pluginName), arg)) as T;
    },
    async on(pluginName, event, cb) {
      const p = plugin(pluginName);
      if (typeof p?.addListener !== "function") return null;
      return p.addListener(event, cb as (payload: never) => void);
    },
  };
}

/** Открыть адрес в браузере или системном приложении (почта, звонок). */
export async function openExternal(url: string): Promise<boolean> {
  const bridge = getNativeBridge();
  if (!bridge?.plugin("AppLauncher")) return false;
  try {
    await bridge.call("AppLauncher", "openUrl", { url });
    return true;
  } catch {
    return false;
  }
}

/** Экран приложения в настройках телефона (разрешения). */
export async function openAppSettings(): Promise<void> {
  await getNativeBridge()?.call("WebPrint", "openSettings");
}

// ─── Печать ────────────────────────────────────────────────────────────

const PRINT_ROOT_ID = "native-print-root";
const PRINT_STYLE_ID = "native-print-style";

function removePrintOverlay() {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

async function nativePrint(bridge: NativeBridge): Promise<void> {
  try {
    await bridge.call("WebPrint", "print", { jobName: document.title || "WeSetup" });
  } catch {
    toast.error("Не удалось открыть печать. Попробуйте ещё раз");
  }
}

/**
 * Печать страницы. В приложении `window.print()` ничего не делает —
 * зовём системное окно печати (принтер или «Сохранить как PDF»).
 */
export async function printPage(): Promise<void> {
  const bridge = getNativeBridge();
  if (!bridge) {
    window.print();
    return;
  }
  // Лист от прошлой `printHtml` не должен попасть в печать страницы.
  removePrintOverlay();
  await nativePrint(bridge);
}

/**
 * Напечатать отдельный HTML-документ (карточка QR, листовка).
 *
 * Вне приложения — как раньше: новое окно, туда документ, печать. В
 * приложении новых окон нет, поэтому документ кладём в скрытый блок
 * этой же страницы, на время печати прячем всё остальное и печатаем
 * страницу. Скрипты документа не выполняются.
 */
export async function printHtml(html: string): Promise<void> {
  const bridge = getNativeBridge();
  if (!bridge) {
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) {
      toast.error("Разрешите всплывающие окна для печати");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    window.setTimeout(() => w.print(), 250);
    return;
  }
  removePrintOverlay();
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  const css = Array.from(doc.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n")
    // Стили документа для `body` относятся к нашему блоку.
    .replace(/(^|[\s,}])body(?=[\s,{.:#[])/g, `$1#${PRINT_ROOT_ID}`);
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent =
    `#${PRINT_ROOT_ID}{display:none}` +
    `@media print{html,body{background:#fff!important}` +
    `body>*:not(#${PRINT_ROOT_ID}){display:none!important}` +
    `#${PRINT_ROOT_ID}{display:block}${css}}`;
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  root.innerHTML = doc.body.innerHTML;
  document.head.appendChild(style);
  document.body.appendChild(root);
  await nativePrint(bridge);
  // iOS отвечает, когда окно печати закрыто. Android — сразу, а страницы
  // рисует позже, пока открыто окно печати: блок убираем, когда человек
  // вернулся в приложение (или при следующей печати).
  if (bridge.platform === "ios") {
    removePrintOverlay();
    return;
  }
  const cleanup = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", cleanup);
    window.setTimeout(removePrintOverlay, 1500);
  };
  document.addEventListener("visibilitychange", cleanup);
}

// ─── Файлы ─────────────────────────────────────────────────────────────

/**
 * Blob'ы по их `blob:`-адресам. Сайт обычно делает `createObjectURL` →
 * `a.click()` → сразу `revokeObjectURL`, а скачать файл в приложении мы
 * успеваем только асинхронно — к тому моменту адрес уже отозван.
 * Поэтому в приложении держим blob сами минуту (ставит `native-app-bridge`).
 */
const blobRegistry = new Map<string, Blob>();

export function rememberObjectUrl(url: string, obj: unknown) {
  if (typeof Blob !== "undefined" && obj instanceof Blob) {
    blobRegistry.set(url, obj);
    window.setTimeout(() => blobRegistry.delete(url), 60_000);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

const FILE_ERROR = "Не удалось открыть файл. Проверьте интернет и попробуйте ещё раз";

async function shareBlob(bridge: NativeBridge, blob: Blob, name: string): Promise<void> {
  const data = await blobToBase64(blob);
  const written = await bridge.call<{ uri: string }>("Filesystem", "writeFile", {
    path: name,
    data,
    directory: "CACHE",
  });
  if (!written?.uri) throw new Error("no file");
  try {
    await bridge.call("Share", "share", {
      title: name,
      files: [written.uri],
      dialogTitle: "Открыть или отправить",
    });
  } catch (err) {
    // Человек закрыл лист «Поделиться» — это не ошибка.
    if (/cancel/i.test(err instanceof Error ? err.message : String(err))) return;
    throw err;
  }
}

async function withFileToast(job: () => Promise<void>): Promise<void> {
  const id = toast.loading("Готовим файл…");
  try {
    await job();
    toast.dismiss(id);
  } catch {
    toast.dismiss(id);
    toast.error(FILE_ERROR);
  }
}

/**
 * Сохранить готовый файл. Вне приложения — как раньше: ссылка с
 * `download`. В приложении — во временную папку и лист «Поделиться»
 * (открыть, отправить, сохранить в «Файлы»).
 */
export async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const bridge = getNativeBridge();
  if (!bridge) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  await withFileToast(() =>
    shareBlob(
      bridge,
      blob,
      downloadFileName({ contentDisposition: null, downloadAttr: fileName, url: "blob:", contentType: blob.type })
    )
  );
}

/**
 * Скачать файл по адресу сайта (или `blob:`).
 *
 * `fallback` — что делать вне приложения (по умолчанию — перейти по
 * адресу: ответ с `attachment` браузер скачает, не уходя со страницы).
 * Если в приложении вместо файла пришла страница сайта (например,
 * «войдите»), просто открываем её.
 */
export async function downloadFile(
  url: string,
  options: { fileName?: string | null; fallback?: () => void } = {}
): Promise<void> {
  const bridge = getNativeBridge();
  if (!bridge) {
    if (options.fallback) options.fallback();
    else window.location.assign(url);
    return;
  }
  await withFileToast(async () => {
    const remembered = blobRegistry.get(url);
    if (remembered) {
      await shareBlob(
        bridge,
        remembered,
        downloadFileName({ contentDisposition: null, downloadAttr: options.fileName, url, contentType: remembered.type })
      );
      return;
    }
    const isBlob = /^(blob|data):/i.test(url);
    const response = await fetch(url, isBlob ? undefined : { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const disposition = response.headers.get("content-disposition");
    const type = response.headers.get("content-type");
    if (!isBlob && !/attachment/i.test(disposition ?? "") && /text\/html/i.test(type ?? "")) {
      window.location.assign(url);
      return;
    }
    const blob = await response.blob();
    await shareBlob(
      bridge,
      blob,
      downloadFileName({ contentDisposition: disposition, downloadAttr: options.fileName, url, contentType: type || blob.type })
    );
  });
}

// ─── Push: токен этого телефона ────────────────────────────────────────

export const PUSH_TOKEN_KEY = "wesetup.push.token";
export const PUSH_ASK_KEY = "wesetup.push.asked";
/** sessionStorage: за кого телефон уже зарегистрирован в этом запуске приложения. */
export const PUSH_REGISTERED_KEY = "wesetup.push.registered-for";

export function readStoredPushToken(): string | null {
  try {
    return window.localStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storePushToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(PUSH_TOKEN_KEY, token);
    else window.localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    /* хранилище недоступно — токен узнаем заново при следующем запуске */
  }
}

/**
 * Отвязать телефон от аккаунта — ДО выхода: без сессии сервер ответит
 * 401. Ошибки не мешают выйти: при следующем входе токен перейдёт к
 * новому человеку.
 */
export async function unregisterPushDevice(): Promise<void> {
  try {
    // Войдёт снова (тот же человек или другой) — зарегистрируем заново.
    window.sessionStorage.removeItem(PUSH_REGISTERED_KEY);
  } catch {
    /* */
  }
  const token = readStoredPushToken();
  if (!token) return;
  try {
    await fetch("/api/mobile/devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    /* нет связи — не повод не выпускать человека */
  }
}

/** Разрешение ОС на уведомления: `granted` / `denied` / `prompt` / …; null — плагина нет. */
export async function pushPermission(bridge: NativeBridge | null = getNativeBridge()): Promise<string | null> {
  if (!bridge?.plugin("FirebaseMessaging")) return null;
  try {
    const res = await bridge.call<{ receive?: string }>("FirebaseMessaging", "checkPermissions");
    return res?.receive ?? null;
  } catch {
    return null;
  }
}

/** Спросить разрешение у системы. Возвращает итог. */
export async function requestPushPermission(bridge: NativeBridge | null = getNativeBridge()): Promise<string | null> {
  if (!bridge?.plugin("FirebaseMessaging")) return null;
  try {
    const res = await bridge.call<{ receive?: string }>("FirebaseMessaging", "requestPermissions");
    return res?.receive ?? null;
  } catch {
    return null;
  }
}

/**
 * Зарегистрировать телефон для push на вошедшего человека.
 *
 * `getToken` падает, когда в сборке нет файлов Firebase, — тогда молча
 * ничего не делаем: это не ошибка человека. `token` — уже известный
 * токен (событие `tokenReceived`). Возвращает токен или null.
 */
export async function registerPushDevice(
  bridge: NativeBridge | null = getNativeBridge(),
  token?: string | null
): Promise<string | null> {
  if (!bridge) return null;
  let value = token ?? null;
  if (!value) {
    try {
      value = (await bridge.call<{ token?: string }>("FirebaseMessaging", "getToken"))?.token ?? null;
    } catch {
      return null;
    }
  }
  if (!value) return null;
  try {
    const res = await fetch("/api/mobile/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: value, platform: bridge.platform }),
    });
    if (!res.ok) return null;
  } catch {
    return null;
  }
  storePushToken(value);
  return value;
}
