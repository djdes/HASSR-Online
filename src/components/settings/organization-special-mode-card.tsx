"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { useJournalControls } from "@/components/journals/journal-controls-provider";

/**
 * «Специальный режим» переехал в «Пришла проверка» (скан 83, решение
 * 2026-10-17): переключатель с галочками — там, рядом с QR проверяющего.
 * С 2026-10-28 режим наоборот: включён — автоматика журналов видна.
 * В реквизитах остаётся ссылка и текущее состояние.
 */
export function OrganizationSpecialModeCard() {
  const t = useTranslations("settingsManagement.organizationProfile");
  const { controls, loaded } = useJournalControls();
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-[#ececf4] bg-white p-6 sm:flex-row sm:items-center" data-special-mode-moved>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-semibold text-[#0b1024]">{t("specialMode.movedTitle")}</h2>
          {loaded ? (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${
                controls.automation.enabled ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#f5f6ff] text-[#3848c7]"
              }`}
            >
              {controls.automation.enabled ? t("specialMode.statusOn") : t("specialMode.statusOff")}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[14px] text-[#6f7282]">{t("specialMode.movedBody")}</p>
      </div>
      <Link
        href="/inspection#special-mode"
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        {t("specialMode.movedLink")}
        <ArrowRight className="size-4 text-[#5566f6]" aria-hidden />
      </Link>
    </section>
  );
}
