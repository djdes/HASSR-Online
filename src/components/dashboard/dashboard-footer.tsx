import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand/logo";
import { PLATFORM_BADGE_TEXT } from "@/lib/partners/branding";

/**
 * Компактный футер дашборда — одна строка вместо трёхколоночного
 * `PublicFooter`. Виден на КАЖДОЙ странице `(dashboard)`: подключён
 * в `(dashboard)/layout.tsx` сразу после `<main>`.
 *
 * Фон прозрачный — чтобы тёмная тема (`app-theme.css`) не требовала
 * отдельного override'а: подложка приходит от `.app-shell`.
 * Mini App (`/mini/*`) живёт в своём layout'е и этот футер не получает.
 *
 * `partnerBrandName` — кабинет под брендом партнёра: логотип WeSetup
 * остаётся, к нему добавляется неубираемая подпись «Работает на
 * платформе WeSetup» (условие white-label).
 */
export function DashboardFooter({ partnerBrandName = null }: { partnerBrandName?: string | null }) {
  const t = useTranslations("dashboardUi.dashboardFooter");
  const linkClass = "transition-colors hover:text-[#5566f6]";

  // pb-24 на телефоне — коридор под плавающую кнопку дока (48px + 20px
  // от низа): без него последняя строка футера пряталась под ней.
  //
  // Компьютер (владелец, 2026-11-19: «подвал той же высоты, что меню
  // слева»): полоса 72px + линия — ровно как блок «Пришла проверка» внизу
  // меню (`ClassicNavAccordion`), линии стоят на одной высоте. Поля — как у
  // страницы (`px-4 md:px-8`, коробка 1800px): текст подвала начинается там
  // же, где контент.
  return (
    <footer
      data-dashboard-footer
      className="mt-auto border-t border-[#ececf4] pb-24 pt-5 text-[12.5px] text-[#9b9fb3] sm:pb-5 lg:flex lg:min-h-[73px] lg:items-center lg:py-2 print:hidden"
    >
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex items-center gap-3">
          <span className="text-[#6f7282]">
            <BrandLogo height={18} title="WeSetup" />
          </span>
          {partnerBrandName ? (
            <span className="text-[#6f7282]" data-platform-badge>
              {PLATFORM_BADGE_TEXT}
              <span className="text-[#9b9fb3]"> · {t("supportedBy", { name: partnerBrandName })}</span>
            </span>
          ) : null}
          <span>© 2026</span>
        </div>

        {/* sm:pr-16 — коридор под кнопку дока справа внизу (одна кнопка 48px
            у правого поля). Без него «Telegram» перекрывался кнопкой, когда
            футер попадал в нижнюю часть окна. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:pr-16">
          <Link href="/oferta" className={linkClass}>
            {t("offer")}
          </Link>
          <Link href="/privacy" className={linkClass}>
            {t("privacy")}
          </Link>
          <Link href="/baza-znaniy" className={linkClass}>
            {t("knowledgeBase")}
          </Link>
          <a href="mailto:admin@wesetup.ru" className={linkClass}>
            admin@wesetup.ru
          </a>
          <a
            href="https://t.me/wesetupbot"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Telegram
          </a>
        </div>
      </div>
    </footer>
  );
}
