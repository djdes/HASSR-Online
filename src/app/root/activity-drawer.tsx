"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useEffect, useState } from "react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { formatNumber } from "@/i18n/locales";
import { metricsDate, metricsJournalName, type JournalSourceNames } from "./metrics-presentation";
import Link from "next/link";
import { ArrowUpRight, FileText, Loader2, Table2, X } from "lucide-react";
import type { OrgActivity } from "@/lib/org-activity";

/**
 * Панель «что делает организация» — открывается кликом по числу записей
 * в метриках платформы.
 *
 * Панель, а не отдельная страница: ROOT сравнивает организации, пробегая
 * таблицу сверху вниз, и уход со страницы на каждую сбивал бы и порядок
 * сортировки, и позицию скролла. Закрыл — и продолжил с того же места.
 *
 * Данные грузятся при открытии: в метриках сотня организаций, тянуть
 * ленту каждой ради одной открытой — впустую.
 */
export function ActivityDrawer({
  organizationId,
  organizationName,
  onClose,
  sourceJournalNames,
}: {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  sourceJournalNames: JournalSourceNames;
}) {
  const t = useTranslations("rootMetrics");
  const locale = useLocale();
  const messages = useMessages();
  const [data, setData] = useState<OrgActivity | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/root/organizations/${organizationId}/activity`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((json: OrgActivity) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const maxCount = data?.byJournal[0]?.count ?? 0;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <BodyScrollLock />
      <button
        type="button"
        aria-label={t("activity.close")}
        onClick={onClose}
        className="absolute inset-0 bg-[#0b1024]/40 backdrop-blur-sm"
      />

      <aside
        role="dialog"
        aria-label={t("activity.dialogLabel", { name: organizationName })}
        className="relative flex h-full w-full max-w-[600px] flex-col bg-white shadow-[0_40px_100px_-40px_rgba(11,16,36,0.6)]"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-[#eef0f6] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
              {t("activity.title")}</div>
            <h2 className="mt-1 truncate text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              {organizationName}
            </h2>
            <Link
              href={`/root/organizations/${organizationId}`}
              className="mt-1 inline-flex items-center gap-1 text-[13px] text-[#3848c7] hover:underline"
            >
              {t("activity.organizationCard")}<ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("activity.close")}
            className="shrink-0 rounded-lg p-1 text-[#9b9fb3] transition-colors hover:text-[#0b1024]"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
              {t("activity.loadError")}
            </p>
          ) : !data ? (
            <div className="flex items-center gap-2 py-8 text-[13px] text-[#9b9fb3]">
              <Loader2 className="size-4 animate-spin" />
              {t("activity.loading")}</div>
          ) : data.timeline.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
              <div className="text-[15px] font-medium text-[#0b1024]">
                {t("activity.emptyTitle", { days: data.breakdownDays })}
              </div>
              <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
                {t("activity.emptyBody")}</p>
            </div>
          ) : (
            <>
              <section>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
                  {t("activity.journalsHeading", { days: data.breakdownDays })}
                </div>
                <div className="mt-3 space-y-2">
                  {data.byJournal.map((j) => (
                    <div key={j.journalCode}>
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="min-w-0 truncate text-[#0b1024]">
                          {metricsJournalName(locale, j.journalCode, j.journalName, messages.journals.names, sourceJournalNames)}
                        </span>
                        <span className="shrink-0 tabular-nums text-[#6f7282]">
                          {formatNumber(locale, j.count)}
                        </span>
                      </div>
                      {/* Полоса длиной от самого активного журнала: ROOT'у
                          важна не абсолютная цифра, а перекос — один журнал
                          из восьми или все восемь поровну. */}
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f2f3f9]">
                        <div
                          className="h-full rounded-full bg-[#5566f6]"
                          style={{
                            width: `${maxCount > 0 ? Math.max(4, (j.count / maxCount) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
                  {t("activity.latest")}</div>
                <div className="mt-3 space-y-1">
                  {data.timeline.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-[#fafbff]"
                    >
                      <span
                        title={
                          e.kind === "form"
                            ? t("activity.formKind")
                            : t("activity.cellKind")
                        }
                        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]"
                      >
                        {e.kind === "form" ? (
                          <FileText className="size-3.5" />
                        ) : (
                          <Table2 className="size-3.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-[#0b1024]">
                          {metricsJournalName(locale, e.journalCode, e.journalName, messages.journals.names, sourceJournalNames)}
                        </div>
                        <div className="truncate text-[12px] text-[#6f7282]">
                          {e.who}
                          {e.documentTitle ? ` · ${e.documentTitle}` : ""}
                        </div>
                      </div>
                      <span className="shrink-0 text-[12px] tabular-nums text-[#9b9fb3]">
                        {metricsDate(e.at, locale, {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
