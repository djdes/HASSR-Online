import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { NETWORK_HREF } from "@/lib/network-summary";
import { NETWORK_PERIODS, type NetworkPeriod } from "@/lib/network-period";
import { cn } from "@/lib/utils";

const TAB =
  "inline-flex h-10 items-center rounded-2xl px-4 text-[13.5px] font-medium whitespace-nowrap transition-colors";
const TAB_ON = "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]";
const TAB_OFF = "border border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

/**
 * «Сеть» (серия E, Р6): переключатель «Сегодня / 7 дней / 30 дней»
 * (`?period=`) и выгрузка таблицы выбранного периода в Excel и PDF.
 */
export async function NetworkPeriodBar({ period }: { period: NetworkPeriod }) {
  const t = await getTranslations("settingsManagement.network");
  const exportHref = (format: "xlsx" | "pdf") => `/api/settings/network/export?period=${period}&format=${format}`;
  return (
    <div className="flex flex-wrap items-center gap-2" data-network-period-bar>
      <nav aria-label={t("period.label")} className="flex flex-wrap items-center gap-2">
        {NETWORK_PERIODS.map((item) => (
          <Link
            key={item}
            href={item === "today" ? NETWORK_HREF : `${NETWORK_HREF}?period=${item}`}
            aria-current={item === period ? "page" : undefined}
            className={cn(TAB, item === period ? TAB_ON : TAB_OFF)}
            data-network-period={item}
          >
            {t(`period.options.${item}`)}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <span className="text-[13px] text-[#6f7282]">{t("export.label")}</span>
        <a href={exportHref("xlsx")} download className={cn(TAB, TAB_OFF, "gap-2")} data-network-export="xlsx">
          <FileSpreadsheet className="size-4" aria-hidden />
          {t("export.excel")}
        </a>
        <a href={exportHref("pdf")} download className={cn(TAB, TAB_OFF, "gap-2")} data-network-export="pdf">
          <FileText className="size-4" aria-hidden />
          {t("export.pdf")}
        </a>
      </div>
    </div>
  );
}
