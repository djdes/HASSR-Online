"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Bell } from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  PUSH_ASK_KEY,
  PUSH_REGISTERED_KEY,
  backButtonAction,
  classifyLink,
  deepLinkPath,
  downloadFile,
  getNativeBridge,
  normalizeAppUrl,
  openExternal,
  parsePushAskState,
  printHtml,
  printPage,
  pushExplainerAction,
  pushPermission,
  registerPushDevice,
  rememberObjectUrl,
  requestPushPermission,
  statusBarStyle,
  type NativeBridge,
  type PushAskState,
} from "@/lib/native-bridge";

import { isMiniRootPath } from "./mini-shell";
import { useMiniTheme } from "./mini-theme";

/**
 * Мост сайта к приложению WeSetup для Android и iOS.
 *
 * Смонтирован один раз в оболочке (`MiniAppShell`). Вне приложения не
 * делает ничего: `getNativeBridge()` там null. В приложении:
 *
 *   • печать — `window.print` зовёт системное окно печати;
 *   • файлы — ссылки на файлы, `blob:`-ссылки с `download` и
 *     `window.open` на файл скачиваются и открываются листом «Поделиться»;
 *   • ссылки — `target=_blank` и `window.open` на свой сайт открываются
 *     здесь же (iOS иначе увёл бы в Safari), чужие сайты, почта и звонки —
 *     в системные приложения на обеих платформах одинаково;
 *   • «назад» Android — по истории, с домашнего экрана — свернуть;
 *   • ссылки, которыми открыли приложение, и нажатия на уведомления;
 *   • push — лист-объяснение после входа и регистрация телефона;
 *   • цвет значков строки состояния.
 *
 * Слушатели плагинов сбрасываются при каждой полной загрузке страницы,
 * поэтому всё вешается заново при монтировании.
 */

const LAUNCH_URL_DONE_KEY = "wesetup.app.launch-url-done";

function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно — в худшем случае сделаем то же ещё раз */
  }
}

function readAskState(): PushAskState | null {
  try {
    return parsePushAskState(window.localStorage.getItem(PUSH_ASK_KEY));
  } catch {
    return null;
  }
}

function writeAskState(state: PushAskState) {
  try {
    window.localStorage.setItem(PUSH_ASK_KEY, JSON.stringify(state));
  } catch {
    /* не запомнили — спросим в следующий раз */
  }
}

const noopSubscribe = () => () => {};

function currentPath(): string {
  return window.location.pathname + window.location.search;
}

function goToAppLink(url: string | null | undefined) {
  const target = deepLinkPath(url, currentPath(), [window.location.host]);
  if (target) window.location.assign(target);
}

/**
 * Окно-заглушка вместо `window.open`: в приложении новых окон нет.
 * Документ, который сайт пишет в пустое окно для печати, печатается
 * через `printHtml`.
 */
function stubWindow(): Window {
  let html = "";
  let printed = false;
  const print = () => {
    if (printed || !html) return;
    printed = true;
    void printHtml(html);
  };
  const stub = {
    closed: false,
    close() {},
    focus() {},
    blur() {},
    print,
    document: {
      open() {
        html = "";
      },
      write(...chunks: string[]) {
        html += chunks.join("");
      },
      writeln(...chunks: string[]) {
        html += chunks.join("") + "\n";
      },
      close() {
        // Документ сам зовёт печать при загрузке — печатаем сразу.
        if (/\bprint\s*\(/.test(html)) print();
      },
    },
  };
  return stub as unknown as Window;
}

/** Нажатая ссылка: вернуть true, если приложение взяло её на себя. */
function handleAnchor(bridge: NativeBridge, a: HTMLAnchorElement): boolean {
  const raw = a.getAttribute("href") ?? "";
  const href = /^javascript:/i.test(raw.trim()) ? raw : a.href || raw;
  const kind = classifyLink(href, window.location.origin, a.hasAttribute("download"));
  if (kind === "download") {
    void downloadFile(href, { fileName: a.getAttribute("download") || null });
    return true;
  }
  if (kind === "external" || kind === "system") {
    if (!bridge.plugin("AppLauncher")) return false;
    void openExternal(href);
    return true;
  }
  // Свой экран в новой вкладке: на iOS это Safari без входа — открываем здесь.
  const target = (a.getAttribute("target") ?? "").toLowerCase();
  if (target && target !== "_self" && target !== "_top" && target !== "_parent") {
    window.location.assign(href);
    return true;
  }
  return false;
}

function closeOpenDialog(): boolean {
  const open = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
  );
  if (!open) return false;
  // Radix закрывает слои по Escape — «назад» ведёт себя как на телефоне.
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })
  );
  return true;
}

/**
 * Подменить печать, `window.open`, `a.click()` и слушать нажатия на
 * ссылки. Возвращает функцию, которая всё возвращает как было.
 */
function installInterceptors(bridge: NativeBridge): () => void {
  const originalPrint = window.print;
  const originalOpen = window.open;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  const originalCreateObjectURL = URL.createObjectURL;

  window.print = () => {
    void printPage();
  };

  URL.createObjectURL = function (obj: Blob | MediaSource) {
    const url = originalCreateObjectURL.call(URL, obj);
    rememberObjectUrl(url, obj);
    return url;
  };

  window.open = function (url?: string | URL, target?: string, features?: string) {
    const href = url == null ? "" : String(url);
    if (!href || href === "about:blank") return stubWindow();
    let abs = href;
    try {
      abs = /^(blob|data|mailto|tel|sms):/i.test(href) ? href : new URL(href, window.location.href).href;
    } catch {
      return originalOpen.call(window, url, target, features);
    }
    const kind = classifyLink(abs, window.location.origin, false);
    if (kind === "download") {
      void downloadFile(abs);
      return stubWindow();
    }
    if (kind === "external" || kind === "system") {
      if (!bridge.plugin("AppLauncher")) return originalOpen.call(window, url, target, features);
      void openExternal(abs);
      return stubWindow();
    }
    window.location.assign(abs);
    return stubWindow();
  };

  // Ссылку, созданную в коде и не вставленную в страницу, `a.click()`
  // до документа не доносит — ловим сам вызов.
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!this.isConnected && handleAnchor(bridge, this)) return;
    return originalAnchorClick.call(this);
  };

  // Всплытие, а не перехват: сначала отрабатывают обработчики самой
  // страницы (React, next/link). Если ссылка уже обработана ими —
  // `defaultPrevented`, не трогаем. Иначе, например, ссылка «скачать
  // бланк», которая сначала спрашивает почту, скачала бы файл сразу.
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const el = event.target instanceof Element ? event.target : null;
    const a = el?.closest("a[href]");
    if (!(a instanceof HTMLAnchorElement)) return;
    if (handleAnchor(bridge, a)) event.preventDefault();
  };
  document.addEventListener("click", onClick);

  return () => {
    window.print = originalPrint;
    window.open = originalOpen;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    URL.createObjectURL = originalCreateObjectURL;
    document.removeEventListener("click", onClick);
  };
}

export function NativeAppBridge({ homeHref }: { homeHref: string }) {
  // Приложение ли это, знает только браузер: на сервере — «нет».
  const inApp = useSyncExternalStore(
    noopSubscribe,
    () => getNativeBridge() !== null,
    () => false
  );
  const bridge = useMemo(() => (inApp ? getNativeBridge() : null), [inApp]);
  const { data: session, status } = useSession();
  const { theme } = useMiniTheme();
  const pathname = usePathname();
  const [askOpen, setAskOpen] = useState(false);
  const homeRef = useRef(homeHref);
  // Ответ уже дан кнопкой: закрытие листа после этого — не «Не сейчас».
  const decidedRef = useRef(false);

  useEffect(() => {
    homeRef.current = homeHref;
  }, [homeHref]);

  // Печать, ссылки, файлы.
  useEffect(() => {
    if (!bridge) return;
    return installInterceptors(bridge);
  }, [bridge]);

  // «Назад» Android, ссылки из системы, нажатие на уведомление.
  useEffect(() => {
    if (!bridge) return;
    const handles: Array<Promise<{ remove: () => void | Promise<void> } | null>> = [];

    if (bridge.platform === "android") {
      handles.push(
        bridge.on("App", "backButton", (payload) => {
          if (closeOpenDialog()) return;
          const canGoBack = Boolean((payload as { canGoBack?: boolean } | null)?.canGoBack);
          const action = backButtonAction({ isRoot: isMiniRootPath(window.location.pathname), canGoBack });
          if (action === "back") window.history.back();
          else if (action === "home") window.location.assign(homeRef.current);
          else void bridge.call("App", "minimizeApp").catch(() => undefined);
        })
      );
    }

    handles.push(
      bridge.on("App", "appUrlOpen", (payload) => {
        goToAppLink((payload as { url?: string } | null)?.url);
      })
    );

    handles.push(
      bridge.on("FirebaseMessaging", "notificationActionPerformed", (payload) => {
        const data = (payload as { notification?: { data?: { url?: unknown } } } | null)?.notification?.data;
        const url = typeof data?.url === "string" ? data.url : null;
        const target = normalizeAppUrl(url, [window.location.host]);
        if (target !== currentPath()) window.location.assign(target);
      })
    );

    // Холодный запуск Android по ссылке: WebView всё равно открывает
    // стартовый адрес, а ссылку отдаёт только getLaunchUrl. Один раз за
    // запуск приложения — sessionStorage живёт, пока живёт WebView.
    if (!sessionGet(LAUNCH_URL_DONE_KEY)) {
      sessionSet(LAUNCH_URL_DONE_KEY, "1");
      void bridge
        .call<{ url?: string } | undefined>("App", "getLaunchUrl")
        .then((res) => goToAppLink(res?.url))
        .catch(() => undefined);
    }

    return () => {
      for (const h of handles) void h.then((x) => x?.remove()).catch(() => undefined);
    };
  }, [bridge]);

  // Строка состояния: над тёмной шапкой — светлые значки.
  useEffect(() => {
    if (!bridge) return;
    const style = statusBarStyle({
      darkHeader: document.querySelector(".mini-topbar") !== null,
      theme,
    });
    void bridge.call("StatusBar", "setStyle", { style }).catch(() => undefined);
  }, [bridge, theme, pathname]);

  // Push: регистрация телефона и лист-объяснение после входа.
  const userId = status === "authenticated" ? session?.user?.id ?? null : null;
  const kiosk = Boolean(session?.user?.kioskDeviceId);
  useEffect(() => {
    if (!bridge || !userId || kiosk) return;
    let cancelled = false;
    let timer: number | undefined;

    const tokenHandle = bridge.on("FirebaseMessaging", "tokenReceived", (payload) => {
      const token = (payload as { token?: string } | null)?.token;
      if (token) void registerPushDevice(bridge, token);
    });

    void (async () => {
      const permission = await pushPermission(bridge);
      if (cancelled) return;
      const action = pushExplainerAction(permission, readAskState(), Date.now());
      if (action === "register") {
        // Каждый запуск приложения (и смена человека) — заново:
        // обновляет «был в сети» и переносит телефон на вошедшего.
        if (sessionGet(PUSH_REGISTERED_KEY) === userId) return;
        const token = await registerPushDevice(bridge);
        if (token) sessionSet(PUSH_REGISTERED_KEY, userId);
      } else if (action === "ask") {
        // Не сразу: сначала человек видит, куда попал.
        timer = window.setTimeout(() => {
          if (!cancelled) setAskOpen(true);
        }, 1200);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      void tokenHandle.then((h) => h?.remove()).catch(() => undefined);
    };
  }, [bridge, userId, kiosk]);

  const later = useCallback(() => {
    if (decidedRef.current) {
      setAskOpen(false);
      return;
    }
    decidedRef.current = true;
    const prev = readAskState();
    writeAskState({ choice: "later", at: Date.now(), laterCount: (prev?.laterCount ?? 0) + 1 });
    setAskOpen(false);
  }, []);

  const enable = useCallback(async () => {
    decidedRef.current = true;
    writeAskState({ choice: "enabled", at: Date.now(), laterCount: readAskState()?.laterCount ?? 0 });
    setAskOpen(false);
    if (!bridge) return;
    const permission = await requestPushPermission(bridge);
    if (permission !== "granted") return;
    const token = await registerPushDevice(bridge);
    if (token && userId) sessionSet(PUSH_REGISTERED_KEY, userId);
  }, [bridge, userId]);

  if (!bridge) return null;

  return (
    <BottomSheet
      open={askOpen}
      onClose={later}
      title="Уведомления о задачах"
      footer={
        <div className="grid gap-2 py-1">
          <button
            type="button"
            onClick={() => void enable()}
            data-testid="push-explainer-enable"
            className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            Включить
          </button>
          <button
            type="button"
            onClick={later}
            data-testid="push-explainer-later"
            className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            Не сейчас
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3 px-1 py-3" data-testid="push-explainer">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Bell className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[16px] leading-[1.5] text-[#0b1024]">
            Сюда придут задачи смены, напоминания и ответы руководителя
          </p>
          <p className="mt-1.5 text-[14px] leading-[1.5] text-[#6f7282]">
            Нажмите «Включить», затем «Разрешить» в окне телефона. Выключить можно в профиле.
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}
