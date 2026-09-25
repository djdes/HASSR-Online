import Script from "next/script";
import type { ReactNode } from "react";

import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { DeletionBanner } from "@/components/layout/deletion-banner";
import { NpsBanner } from "@/components/layout/nps-banner";
import { LiveConnectionIndicator } from "@/components/live/live-connection-indicator";
import { SanpinChatWidget } from "@/components/ai/sanpin-chat-widget";
import { FabDockProvider } from "@/components/layout/fab-dock";
import { JournalUndoProvider } from "@/components/journals/journal-undo-slot";
import { Toaster } from "@/components/ui/sonner";
import type { PartnerHintRates } from "@/lib/partners/partner-hint";

import type { MiniNavItem } from "@/app/mini/_lib/nav-items";

import { EdgeBack } from "./edge-back";
import { MiniNav } from "./mini-nav";
import { MiniServiceWorkerRegister } from "./mini-sw-register";
import { MiniTelegramRuntime, MiniTopBar } from "./mini-shell";
import { MiniThemeBootstrap, MiniThemeProvider } from "./mini-theme";
import { OfflineIndicator } from "./offline-indicator";
import { RefreshProvider } from "./refresh-provider";

type AnnouncementProp = React.ComponentProps<
  typeof AnnouncementBanner
>["announcement"];

/**
 * Оболочка мини-приложения.
 *
 * Один и тот же хром для двух layout'ов:
 *   • `/mini/*` — собственные экраны приложения;
 *   • `(dashboard)/*` в режиме оболочки (кука `ws-shell=mini`) — страницы
 *     сайта, показанные в телефоне «как приложение».
 *
 * Вынесено в общий компонент намеренно: две копии шапки, меню, тостов и
 * безопасных зон разъехались бы в первый же месяц, и мини-приложение
 * перестало бы быть зеркалом сайта (П-3).
 */
export function MiniAppShell({
  children,
  initialTheme,
  profileTheme,
  homeHref,
  navItems,
  partnerHint = null,
  locationName = null,
  announcement = null,
  deletionDue = null,
  canCancelDeletion = false,
  askNps = false,
  authed = false,
}: {
  children: ReactNode;
  /** Тема, в которой отрисован сервер. */
  initialTheme: "light" | "dark";
  /** `User.themePreference`; null — сессии на сервере не было. */
  profileTheme: "light" | "dark" | null;
  /** «Корень» приложения: домашний адрес кабинета (`role-access.ts`). */
  homeHref: string;
  /** Вкладки нижнего меню, посчитанные на сервере (`nav-items.ts`). */
  navItems: MiniNavItem[];
  partnerHint?: PartnerHintRates | null;
  locationName?: string | null;
  announcement?: AnnouncementProp;
  deletionDue?: string | null;
  canCancelDeletion?: boolean;
  askNps?: boolean;
  /** Есть серверная сессия: живые индикаторы и помощник имеют смысл. */
  authed?: boolean;
}) {
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      {/* Шрифт — системный, как у QR-страниц: внешний Geist Mono (часы и
          моноширинные подписи прежней темы) больше не нужен и не грузится. */}
      <MiniThemeProvider initialTheme={initialTheme} profileTheme={profileTheme}>
        <MiniTelegramRuntime homeHref={homeHref} />
        <MiniServiceWorkerRegister />
        {/* `id="mini-root"` ищут pre-hydration скрипт темы и
            `applyThemeToDOM`. `class="app-shell"` + `data-app-theme`
            мирорят тему на уровень сайта — встроенные компоненты
            кабинета подхватывают правильную палитру. */}
        <div
          id="mini-root"
          className="mini-root app-shell min-h-dvh"
          data-theme={initialTheme}
          data-app-theme={initialTheme}
          suppressHydrationWarning
        >
          <MiniThemeBootstrap hasProfileTheme={profileTheme !== null} />
          {/* Провайдер обнимает и шапку, и содержимое: кнопки отмены
              рисуются наверху, а их состояние живёт в клиенте открытого
              документа — иначе они друг друга не видят. Тот же приём,
              что в шапке сайта. */}
          {/* Док подсказок: AI-помощник и «Как заполнять» — одной кнопкой в
              шапке, а не круглыми кнопками поверх правого края содержимого. */}
          <FabDockProvider slotId="mini-fab-slot">
          <JournalUndoProvider>
            <MiniTopBar
              homeHref={homeHref}
              partnerHint={partnerHint}
              locationName={locationName}
              showNotifications={authed}
            />
            {/* Безопасные зоны iPhone: сверху notch, снизу
                home-indicator плюс высота нижнего меню. */}
            <main
              className="mx-auto flex w-full max-w-lg flex-col px-4"
              style={{
                minHeight: "calc(100dvh - var(--mini-topbar-h, 56px))",
                // Безопасное поле сверху уже в шапке — здесь только
                // отступ от неё, как у `main` QR-страниц.
                paddingTop: "16px",
                paddingBottom: "max(7rem, calc(var(--mini-safe-b) + 6rem))",
              }}
            >
              <AnnouncementBanner announcement={announcement} variant="mini" />
              {deletionDue ? (
                <DeletionBanner
                  dueAt={deletionDue}
                  canCancel={canCancelDeletion}
                  variant="mini"
                />
              ) : null}
              {/* Всегда в дереве: начатый ответ переживает «потянуть,
                  чтобы обновить», когда после оценки askNps становится false. */}
              <NpsBanner variant="mini" ask={askNps} />
              {/* «Потянуть, чтобы обновить» — на всех экранах сразу. */}
              <RefreshProvider>{children}</RefreshProvider>
            </main>
          </JournalUndoProvider>
          {/* Сообщения — ниже шапки приложения. По умолчанию sonner
              кладёт их в самый верх экрана, и они закрывали логотип,
              название экрана и колокольчик. */}
          <Toaster
            offset={{
              top: "calc(env(safe-area-inset-top, 0px) + var(--mini-topbar-h, 56px) + 8px)",
            }}
          />
          <OfflineIndicator />
          {authed ? <LiveConnectionIndicator variant="mini" /> : null}
          <MiniNav items={navItems} />
          {/* Жест «назад» от левого края — только внутри Telegram. */}
          <EdgeBack homeHref={homeHref} />
          {authed ? <SanpinChatWidget bottomOffset={96} /> : null}
          </FabDockProvider>
        </div>
      </MiniThemeProvider>
    </>
  );
}
