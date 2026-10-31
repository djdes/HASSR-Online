"use client";

import Link from "next/link";
import { CalendarClock, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";

/**
 * Продление оплаченного тарифа, пока автосписаний нет
 * (`RECURRING_CHARGES_LIVE` в lib/recurring-consent). Вместо обещания
 * «тариф продлевается сам» — честная дата, напоминания за 7, 3 и 1 день
 * (их шлёт ежедневная задача биллинга) и оплата следующего периода заранее:
 * новый период прибавляется к текущему сроку.
 */
export function RenewalCard({ paidUntil, renewHref }: {
  /** Конец оплаченного периода (ISO). */
  paidUntil: string;
  /** Оплата того же тарифа на следующий период. */
  renewHref: string;
}) {
  const t = useTranslations("settingsUi.renewalCard");
  const locale = useLocale() as Locale;
  const date = new Date(paidUntil).toLocaleDateString(FORMAT_LOCALES[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <RefreshCw className="size-5" />
          </span>
          <div className="min-w-0">
            <span className="text-[16px] font-semibold text-[#0b1024]">{t("title")}</span>
            <p className="mt-1.5 max-w-[560px] text-[13.5px] leading-[1.55] text-[#6f7282]">
              {t.rich("body", {
                date,
                strong: (chunks) => <span className="font-medium text-[#0b1024]">{chunks}</span>,
              })}
            </p>
          </div>
        </div>
        <Link
          href={renewHref}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
        >
          <CalendarClock className="size-4" />
          {t("renew")}
        </Link>
      </div>
    </section>
  );
}
