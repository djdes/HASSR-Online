import Link from "next/link";
import { ArrowRight, PauseCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { LinkPendingSpinner } from "@/components/ui/link-pending";

/**
 * Баннер «аккаунт на паузе» над дашбордом. Пока организация в `paused`,
 * автоматика журналов (автосоздание, автозаполнение, задачи) не
 * работает — человек должен это видеть сразу, а не искать причину, почему
 * журнал утром пустой. Кнопка ведёт к «Возобновить работу».
 */
export function PausedBanner() {
  const t = useTranslations("dashboardUi.pausedBanner");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] px-4 py-3 text-[13.5px] leading-[1.5] text-[#a13a32]">
      <PauseCircle className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>{t("title")}</strong> {t("body")}
      </span>
      <Link
        href="/settings/subscription"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
      >
        {t("resume")}
        <ArrowRight className="size-4" />
        <LinkPendingSpinner />
      </Link>
    </div>
  );
}
