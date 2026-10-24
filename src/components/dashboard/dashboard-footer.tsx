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
  return (
    <footer className="mt-auto border-t border-[#ececf4] px-4 pb-24 pt-5 text-[12.5px] text-[#9b9fb3] sm:pb-5 md:px-6 print:hidden">
      <div className="mx-auto flex max-w-[1760px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

        {/* sm:pr-[104px] — коридор под плавающие кнопки (support + AI-чат
            занимают правые ~123px: `fixed bottom-5 right-5` и `right-[68px]`,
            размер size-11). Без него «support@wesetup.ru» и «Telegram»
            перекрывались виджетами, когда футер попадал в нижнюю часть окна. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:pr-[104px]">
          <Link href="/oferta" className={linkClass}>
            {t("offer")}
          </Link>
          <Link href="/privacy" className={linkClass}>
            {t("privacy")}
          </Link>
          <Link href="/blog" className={linkClass}>
            {t("knowledgeBase")}
          </Link>
          <a href="mailto:support@wesetup.ru" className={linkClass}>
            support@wesetup.ru
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
