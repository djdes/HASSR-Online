"use client";

import Link from "next/link";
import { PartnerHint } from "@/components/partner/partner-hint";
import type { PartnerHintRates } from "@/lib/partners/partner-hint";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, MapPin } from "lucide-react";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { UndoRedoButtons } from "@/components/journals/undo-redo-buttons";
import { useHeaderUndo } from "@/components/journals/journal-undo-slot";
import { getDynamicRouteTitle, getRouteTitle } from "@/lib/route-titles";
import { customSectionTitleForPath } from "@/lib/custom-names";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import {
  buildMiniShellClearCookie,
  buildMiniShellCookie,
  hasMiniShellCookie,
  isMiniPath,
  shouldDropMiniShell,
  shouldSetMiniShell,
} from "@/lib/mini-shell-cookie";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { getTelegramWebApp, isInsideTelegram } from "./telegram-web-app";
import { haptic } from "./use-haptic";
import { MINI_HERO_COLOR, miniBackgroundColor, useMiniTheme } from "./mini-theme";

// Собственных экранов у приложения осталось немного: остальные адреса
// `/mini/*` только перекидывают на страницы кабинета, и их подписи
// берутся из хлебных крошек сайта (`titleForSitePath`).
const SECTION_TITLES: Array<[string, string]> = [
  ["/mini/me", "Профиль"],
  ["/mini/bonus", "Премия"],
  ["/mini/today", "Сегодня"],
  ["/mini/outbox", "Не отправлено"],
  ["/mini/claim", "Задача"],
  ["/mini/sections", "Все разделы"],
];

/**
 * Экраны, с которых «назад» вести некуда.
 *
 * Корень приложения — домашний адрес кабинета (`/dashboard` или
 * `/journals`), а `/mini` — экран входа, который сам уводит домой.
 */
// `/control-board` и `/mini/today` — тоже «дом»: сайт сам приводит туда
// заведующую и сотрудника без списка журналов, и возвращаться им некуда.
const ROOT_PATHS = [
  "/mini",
  // Вход — первый экран приложения: возвращаться с него некуда, стрелка
  // «назад» там лишняя, а кнопка «назад» Android сворачивает приложение.
  "/mini/login",
  "/dashboard",
  "/journals",
  "/control-board",
  "/mini/today",
] as const;

export function isMiniRootPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return ROOT_PATHS.some((path) => path === normalized);
}

/**
 * Подпись страницы сайта, открытой в оболочке мини-приложения.
 *
 * Источник тот же, что у хлебных крошек сайта (`route-titles.ts`).
 * Динамических сегментов там нет, поэтому для `/journals/xxx/documents/1`
 * поднимаемся по пути вверх до ближайшего известного раздела.
 */
export function titleForSitePath(pathname: string): string {
  const dynamicTitle = getDynamicRouteTitle(pathname);
  if (dynamicTitle) return dynamicTitle;
  let path = pathname.replace(/\/+$/, "") || "/";
  while (path.length > 1) {
    const title = getRouteTitle(path);
    if (title) return title;
    path = path.slice(0, path.lastIndexOf("/")) || "/";
  }
  return "Кабинет";
}

export function titleForPath(pathname: string): string {
  if (pathname === "/mini") return "Вход";
  if (pathname === "/mini/login") return "Вход";
  if (pathname.startsWith("/mini/o/")) return "Задача";
  if (!isMiniPath(pathname)) return titleForSitePath(pathname);
  return SECTION_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "WeSetup";
}

/** Приложение установлено на домашний экран (без адресной строки). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (iosStandalone) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function MiniTelegramRuntime({ homeHref }: { homeHref: string }) {
  const { theme } = useMiniTheme();
  const pathname = usePathname();
  const router = useRouter();

  // Режим оболочки (кука `ws-shell=mini`). Ставим, когда человек явно
  // в приложении: внутри Telegram, в приложении WeSetup для телефона, в
  // установленном на домашний экран приложении или просто на экране
  // `/mini/*`. Снимаем, когда он на широком экране открыл страницу
  // сайта — там оболочка с нижним меню не нужна. Правила и формат куки — в `lib/mini-shell-cookie.ts`.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const env = {
      pathname,
      insideTelegram: isInsideTelegram(),
      standalone: isStandaloneDisplay(),
      insideApp: isInsideMobileApp(),
      viewportWidth: window.innerWidth,
    };
    const secure = window.location.protocol === "https:";
    const present = hasMiniShellCookie(document.cookie);

    if (shouldDropMiniShell(env)) {
      if (!present) return;
      document.cookie = buildMiniShellClearCookie(secure);
      // Хром страницы рисует сервер — без перезагрузки человек остался
      // бы в мобильной оболочке до следующего полного захода.
      window.location.reload();
      return;
    }
    if (shouldSetMiniShell(env) && !present) {
      document.cookie = buildMiniShellCookie(secure);
    }
  }, [pathname]);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;

    try {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation?.();
      // Свайп вниз по полотну Telegram сворачивает Mini App — и делает
      // это раньше, чем до жеста доберётся наш «потянуть, чтобы
      // обновить» (`pull-to-refresh.tsx`). То есть главный мобильный
      // жест сейчас закрывает приложение вместо обновления списка.
      tg.disableVerticalSwipes?.();
    } catch {
      /* Older Telegram clients expose only part of the WebApp API. */
    }

    return () => {
      // Состояние живёт на уровне WebApp, а не страницы: не вернув его,
      // мы бы оставили свайп выключенным и для следующего открытия.
      try {
        tg.enableVerticalSwipes?.();
      } catch {
        /* old client — silent */
      }
    };
  }, []);

  // Синхронизируем Telegram chrome с оформлением Mini App. Шапка Telegram
  // того же тёмно-синего, что и наша шапка (как `theme-color` QR-страниц),
  // — они сливаются в одну полосу; фон под экраном — по теме. Без этого
  // при переключении dark↔light у пользователя оставался старый цвет до
  // следующего открытия бота — выглядит как баг.
  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;
    try {
      tg.setHeaderColor?.(MINI_HERO_COLOR);
      tg.setBackgroundColor?.(miniBackgroundColor(theme));
    } catch {
      /* old client — silent */
    }
  }, [theme]);

  // Telegram-native «<» кнопка в шапке. Показываем на всех вложенных
  // экранах, кроме корневых: корень — это домашний адрес кабинета
  // (`/dashboard` или `/journals`) и экран входа `/mini`. На iOS
  // Telegram WebApp нет системной back-кнопки внутри iframe — без
  // BackButton человек застревает на форме, когда клавиатура закрывает
  // наш собственный <ArrowLeft>.
  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg?.BackButton) return;
    const isRoot = isMiniRootPath(pathname);
    const handler = () => {
      try {
        tg.HapticFeedback?.impactOccurred("light");
      } catch {
        /* old client */
      }
      // Если history-stack пустой (пришли по deep-link), router.back()
      // ничего не сделает — уводим домой. window.history.length
      // включает initial entry, так что 1 == «нет куда возвращаться».
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push(homeHref);
      }
    };
    if (isRoot) {
      try {
        tg.BackButton.hide();
      } catch {
        /* */
      }
      return;
    }
    try {
      tg.BackButton.onClick(handler);
      tg.BackButton.show();
    } catch {
      /* */
    }
    return () => {
      try {
        tg.BackButton?.offClick(handler);
        tg.BackButton?.hide();
      } catch {
        /* */
      }
    };
  }, [homeHref, pathname, router]);

  return null;
}

/**
 * Нужна ли собственная кнопка «назад».
 *
 * В Telegram её рисует сам клиент (`tg.BackButton` выше), в обычной
 * вкладке есть кнопка браузера. А вот в установленном на домашний экран
 * приложении нет ни того, ни другого: адресной строки нет, системного
 * жеста на iOS в standalone тоже нет — и человек застревает на экране
 * заполнения без единого выхода. То же в приложении WeSetup: адресной
 * строки нет, а на iOS нет и системной кнопки «назад».
 */
function useNeedsOwnBackButton(pathname: string): boolean {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Именно «внутри Telegram», а не «скрипт Telegram загрузился»: в
    // установленном на домашний экран приложении объект тоже есть, и
    // раньше из-за этого своя кнопка «назад» не появлялась никогда.
    if (isInsideTelegram()) return;

    const query = window.matchMedia("(display-mode: standalone)");
    // `navigator.standalone` — способ iOS: там media-query до сих пор
    // срабатывает не во всех версиях.
    const iosStandalone =
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    const inApp = isInsideMobileApp();
    const sync = () => setStandalone(query.matches || iosStandalone || inApp);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return standalone && !isMiniRootPath(pathname);
}

export function MiniTopBar({
  homeHref,
  partnerHint = null,
  locationName = null,
  showNotifications = false,
}: {
  /** «Корень» приложения: домашний адрес кабинета. */
  homeHref: string;
  /** Ставки для иконки «партнёрская программа» в шапке; null — скрыть. */
  partnerHint?: PartnerHintRates | null;
  /** Активная точка (режим точек включён); null — не показывать. */
  locationName?: string | null;
  /** Колокольчик уведомлений — зеркало шапки сайта; только вошедшим. */
  showNotifications?: boolean;
}) {
  const pathname = usePathname();
  // Своё название раздела организации (провайдер — в оболочке кабинета).
  const title = customSectionTitleForPath(useCustomNames(), pathname) ?? titleForPath(pathname);
  const router = useRouter();
  const showBack = useNeedsOwnBackButton(pathname);
  // Кнопки «отменить / повторить» открытого журнала — тот же слот, что
  // в шапке сайта. Пока документ не открыт, слот пуст и места не занимает.
  const headerUndo = useHeaderUndo();

  // Шапка как у QR-страниц (`QR_FILL_CSS` → `.hero`): тёмно-синий
  // градиент, плитка слева, «WESETUP» капсом и название раздела. Одна в
  // обеих темах, высотой 56px — ниже, чем прежняя 69px. Цвета и размеры —
  // `.mini-topbar*` в mini-theme.css.
  return (
    <header
      className="mini-topbar sticky top-0"
      style={{ zIndex: "var(--mini-z-topbar)" }}
    >
      <div className="mini-topbar-row mx-auto flex w-full max-w-lg items-center gap-1 px-3">
        {showBack ? (
          <button
            type="button"
            onClick={() => {
              haptic("light");
              // history.length === 1 означает «пришли сразу сюда»
              // (ярлык, ссылка) — возвращать некуда, ведём домой.
              if (window.history.length > 1) router.back();
              else router.push(homeHref);
            }}
            aria-label="Назад"
            className="mini-topbar-btn mini-press -ml-1"
          >
            <ArrowLeft />
          </button>
        ) : null}
        <Link
          href={homeHref}
          className="mini-topbar-home flex min-h-12 min-w-0 flex-1 items-center gap-2.5 pr-1"
          aria-label="На главный экран"
        >
          {/* Плитку прячем, когда в шапке кнопки отмены правок: на 360 px
              иначе от названия экрана оставалось «Жу…». */}
          {/* Рядом с «назад» уже есть кнопка слева: на экранах уже 400 px
              плитку прячем (mini-theme.css), иначе «Все разделы» → «Все …». */}
          {headerUndo ? null : (
            <span
              className={showBack ? "mini-topbar-ico mini-topbar-ico--beside-back" : "mini-topbar-ico"}
              aria-hidden
            >
              W
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="mini-topbar-eyebrow">
              WeSetup
              {locationName ? (
                <>
                  {" · "}
                  <MapPin className="-mt-0.5 inline size-3 align-middle" aria-hidden />{" "}
                  {locationName}
                </>
              ) : null}
            </span>
            <span className="mini-topbar-title">{title}</span>
          </span>
        </Link>

        {/* Между кнопками 8px — чтобы не промахнуться пальцем. Иконку
            партнёрки прячем на бланке с кнопками отмены: иначе от названия
            экрана на 360 px ничего не оставалось. */}
        <div className="mini-topbar-actions flex shrink-0 items-center gap-2">
          {/* На экранах уже 400 px иконку партнёрки тоже прячем (mini-theme.css):
              название экрана важнее. */}
          {partnerHint && !headerUndo ? (
            <span className="mini-topbar-partner contents">
              <PartnerHint rates={partnerHint} variant="mini" />
            </span>
          ) : null}
          {/* Отмена/повтор правок журнала — там же, где на сайте. */}
          {headerUndo ? (
            <UndoRedoButtons undo={headerUndo} className="mini-topbar-undo flex items-center gap-2" />
          ) : null}
          {/* Сюда док встраивает кнопку подсказок (см. `FabDockProvider`). */}
          <span id="mini-fab-slot" className="contents" />
          {showNotifications ? <NotificationsBell /> : null}
          {/* Кнопки профиля здесь нет: «Профиль» всегда есть в нижнем меню, а в
              шапке она отнимала место у названия экрана. */}
        </div>
      </div>
    </header>
  );
}
