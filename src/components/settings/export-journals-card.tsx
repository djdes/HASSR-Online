"use client";

import { Archive, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isLocale, LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";

const INPUT = "h-11 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Карточка «Выгрузить все журналы»: период → ZIP с PDF и XLSX. */
export function ExportJournalsCard() {
  const locale = useLocale();
  const t = useTranslations("archiveExport");
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(today));
  const [exportLocale, setExportLocale] = useState<Locale | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"forbidden" | "rateLimited" | "reversedDates" | "periodTooLong" | "invalidLocale" | "failed" | "network" | null>(null);
  async function download() {
    const selectedLocale = exportLocale ?? locale;
    const selectedFrom = from;
    const selectedTo = to;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/settings/export-journals?from=${selectedFrom}&to=${selectedTo}&locale=${selectedLocale}`);
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const code = payload && typeof payload === "object" ? (payload as { code?: unknown }).code : null;
        switch (code) {
          case "forbidden": case "rateLimited": case "reversedDates": case "periodTooLong": case "invalidLocale": setError(code); break;
          default: setError("failed");
        }
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `wesetup-journals-${selectedFrom}-${selectedTo}.zip`;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7" id="export">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
        <Archive className="size-4 text-[#5566f6]" />
        {t("card.title")}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
        {t("card.description", { max: 200 })}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[#6f7282]">
          {t("card.from")}
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={INPUT} data-testid="export-from" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[#6f7282]">
          {t("card.to")}
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={INPUT} data-testid="export-to" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[#6f7282]">
          {t("card.language")}
          <select value={exportLocale ?? locale} onChange={event => { if (isLocale(event.target.value)) setExportLocale(event.target.value); }} className={INPUT} data-testid="export-language">
            {LOCALES.map(value => <option key={value} value={value} lang={value}>{LOCALE_NAMES[value]}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || !from || !to} onClick={download} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60" data-testid="export-download">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {busy ? t("card.pending") : t("card.download")}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-[13px] text-red-700">{error === "periodTooLong" ? t("errors.periodTooLong", { max: 400 }) : t(`errors.${error}`)}</p> : null}
      <p className="mt-3 text-[12px] text-[#9b9fb3]">{t("card.hint")}</p>
    </section>
  );
}
