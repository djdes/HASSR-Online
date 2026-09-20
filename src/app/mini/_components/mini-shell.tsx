"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { PartnerHint } from "@/components/partner/partner-hint";
import type { PartnerHintRates } from "@/lib/partners/partner-hint";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, UserRound, MapPin } from "lucide-react";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { UndoRedoButtons } from "@/components/journals/undo-redo-buttons";
import { useHeaderUndo } from "@/components/journals/journal-undo-slot";
import { getRouteTitle } from "@/lib/route-titles";
import {
  buildMiniShellClearCookie,
  buildMiniShellCookie,
  hasMiniShellCookie,
  isMiniPath,
  shouldDropMiniShell,
  shouldSetMiniShell,
} from "@/lib/mini-shell-cookie";
import { getTelegramWebApp, isInsideTelegram } from "./telegram-web-app";
import { haptic } from "./use-haptic";
import { useMiniTheme } from "./mini-theme";

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
  // в приложении: внутри Telegram, в установленном на домашний экран
  // приложении или просто на экране `/mini/*`. Снимаем, когда он на
  // широком экране открыл страницу сайта — там оболочка с нижним меню
  // не нужна. Правила и формат куки — в `lib/mini-shell-cookie.ts`.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const env = {
      pathname,
      insideTelegram: isInsideTelegram(),
      standalone: isStandaloneDisplay(),
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

  // Синхронизируем Telegram chrome с текущей темой Mini App. Без этого
  // при переключении dark↔light у пользователя остаётся старый header
  // до следующего открытия бота — выглядит как баг.
  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;
    const bg = theme === "dark" ? "#0a0b0f" : "#fafbff";
    try {
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
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
 * Живые часы в шапке. Mono-цифры, обновляется раз в секунду. Даёт
 * ощущение «command deck» — оператор видит текущее время, не теряется.
 */
function LiveClock() {
  const [now, setNow] = useState<string>(() => formatClock(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="mini-mono tabular-nums"
      // Время на сервере и в браузере разное — React ругался на
      // гидрацию (#418) при каждом открытии. Часы по определению
      // расходятся, предупреждение здесь бессмысленно.
      suppressHydrationWarning
      style={{
        fontSize: 11,
        color: "var(--mini-text-muted)",
        letterSpacing: "0.08em",
      }}
    >
      {now}
    </span>
  );
}

function formatClock(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Нужна ли собственная кнопка «назад».
 *
 * В Telegram её рисует сам клиент (`tg.BackButton` выше), в обычной
 * вкладке есть кнопка браузера. А вот в установленном на домашний экран
 * приложении нет ни того, ни другого: адресной строки нет, системного
 * жеста на iOS в standalone тоже нет — и человек застревает на экране
 * заполнения без единого выхода.
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

    const sync = () => setStandalone(query.matches || iosStandalone);
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
  /** Ставки для иконки «партнёрская программа» у логотипа; null — скрыть. */
  partnerHint?: PartnerHintRates | null;
  /** Активная точка (режим точек включён); null — не показывать. */
  locationName?: string | null;
  /** Колокольчик уведомлений — зеркало шапки сайта; только вошедшим. */
  showNotifications?: boolean;
}) {
  const pathname = usePathname();
  const title = titleForPath(pathname);
  const router = useRouter();
  const showBack = useNeedsOwnBackButton(pathname);
  // Кнопки «отменить / повторить» открытого журнала — тот же слот, что
  // в шапке сайта. Пока документ не открыт, слот пуст и места не занимает.
  const headerUndo = useHeaderUndo();

  return (
    <header
      className="mini-topbar sticky top-0 z-40"
      style={{
        borderBottom: "1px solid var(--mini-divider)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        padding: "14px 16px 12px",
      }}
    >
      <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3">
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
            className="mini-press -ml-1 flex size-10 shrink-0 items-center justify-center rounded-2xl"
            style={{ border: "1px solid var(--mini-divider-strong)" }}
          >
            <ArrowLeft className="size-5" />
          </button>
        ) : null}
        <Link
          href={homeHref}
          className="flex min-w-0 items-center gap-3"
          aria-label="На главный экран"
        >
          {/* WS monogram — tactile brand glyph */}
          <span
            className="mini-monogram relative flex size-10 shrink-0 items-center justify-center rounded-2xl"
            style={{
              border: "1px solid var(--mini-divider-strong)",
            }}
          >
            <span
              className="mini-display-bold"
              style={{ fontSize: 18, color: "var(--mini-lime)" }}
            >
              W
            </span>
            {/* Breathing indicator — «live» dot */}
            <span
              className="mini-pulse-dot absolute right-1 top-1 size-1.5 rounded-full"
              style={{ background: "var(--mini-lime)" }}
            />
          </span>
          <div className="min-w-0">
            <div className="mini-eyebrow flex items-center gap-1" style={{ opacity: 0.75 }}>
              <BrandLogo height={14} title="WeSetup" />
              {partnerHint ? (
                // Внутри <Link> на главную: клик по иконке не должен
                // уводить на /mini — гасим переход здесь.
                <span
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  className="inline-flex"
                >
                  <PartnerHint rates={partnerHint} variant="mini" className="size-6" />
                </span>
              ) : null}
            </div>
            <div
              className="mini-display-bold truncate"
              style={{ fontSize: 16, marginTop: 2 }}
            >
              {title}
            </div>
            {locationName ? (
              <div
                className="flex items-center gap-1 truncate text-[12px]"
                style={{ color: "var(--mini-text-muted)", marginTop: 1 }}
              >
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{locationName}</span>
              </div>
            ) : null}
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {/* Отмена/повтор правок журнала — там же, где на сайте.
              Часы прячем, когда кнопки заняли место: на 360 px иначе
              всё три элемента налезают друг на друга. */}
          {headerUndo ? (
            <UndoRedoButtons undo={headerUndo} />
          ) : (
            // На узком телефоне часы съедали место у названия экрана:
            // «Оборудован…», «Баланс и бо…». Время и так есть в шапке Telegram.
            <span className="max-[430px]:hidden">
              <LiveClock />
            </span>
          )}
          {/* Сюда док встраивает кнопку подсказок (см. `FabDockProvider`). */}
          <span id="mini-fab-slot" className="contents" />
          {showNotifications ? <NotificationsBell /> : null}
          <Link
            href="/mini/me"
            aria-label="Профиль"
            className="mini-press inline-flex size-10 items-center justify-center rounded-2xl"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px solid var(--mini-divider)",
              color: "var(--mini-text)",
            }}
          >
            <UserRound className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
