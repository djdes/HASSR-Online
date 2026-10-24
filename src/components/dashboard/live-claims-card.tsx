"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { customJournalName } from "@/lib/custom-names";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
} from "lucide-react";

type ActiveClaim = {
  id: string;
  journalCode: string;
  scopeKey: string;
  scopeLabel: string;
  userName: string | null;
  userId: string;
  claimedAt: string;
};

type CompletedClaim = {
  id: string;
  journalCode: string;
  scopeLabel: string;
  userName: string | null;
  completedAt: string;
};

type Response = {
  activeNow: ActiveClaim[];
  completedToday: CompletedClaim[];
  byJournal: { code: string; active: number; completed: number }[];
};

type Translate = ReturnType<typeof useTranslations<"dashboardUi.liveClaimsCard">>;

function timeAgo(iso: string, t: Translate): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t("hoursMinutesAgo", { hours, minutes: minutes % 60 });
}

/**
 * Live-виджет «Кто что делает» на дашборде. Опрашивает
 * /api/dashboard/live-claims каждые 15 сек, показывает текущие
 * active claim'ы и сегодняшние completions. Для демо менеджер
 * открывает дашборд на ноутбуке, сотрудник на телефоне берёт
 * задачу — менеджер видит изменение почти в реальном времени.
 */
export function LiveClaimsCard() {
  const t = useTranslations("dashboardUi.liveClaimsCard");
  const [data, setData] = useState<Response | null>(null);
  // Своё название журнала организации — первым, затем короткая подпись.
  const customNames = useCustomNames();
  const journalLabels: Record<string, string> = {
    hygiene: t("journalHygiene"),
    health_check: t("journalHealthCheck"),
    cold_equipment_control: t("journalColdEquipment"),
    climate_control: t("journalClimate"),
    cleaning: t("journalCleaning"),
    incoming_control: t("journalIncoming"),
    finished_product: t("journalFinishedProduct"),
    disinfectant_usage: t("journalDisinfectant"),
    fryer_oil: t("journalFryerOil"),
    accident_journal: t("journalAccident"),
    complaint_register: t("journalComplaints"),
  };
  const journalLabel = (code: string) =>
    customJournalName(customNames, code) ?? journalLabels[code] ?? code;
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/dashboard/live-claims", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as Response;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading && !data) {
    return (
      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 text-[#6f7282]">
        <Loader2 className="size-4 animate-spin inline" /> {t("loading")}
      </div>
    );
  }
  if (!data) return null;

  const totalActive = data.activeNow.length;
  const totalCompleted = data.completedToday.length;

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Activity className="size-5" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[#0b1024]">
              {t("title")}
            </div>
            <div className="mt-0.5 text-[12px] text-[#6f7282]">
              {t("summary", { active: totalActive, completed: totalCompleted })}
            </div>
          </div>
        </div>
      </div>

      {totalActive === 0 && totalCompleted === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-6 text-center text-[13px] text-[#6f7282]">
          {t("empty")}
        </div>
      ) : null}

      {totalActive > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            {t("inProgress", { count: totalActive })}
          </div>
          <div className="space-y-2">
            {data.activeNow.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded-2xl border border-[#5566f6]/30 bg-[#eef1ff] px-3 py-2.5"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-white">
                  <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#0b1024]">
                    {c.scopeLabel}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6f7282]">
                    <span className="text-[#3848c7]">
                      {c.userName || t("employee")}
                    </span>
                    <span>·</span>
                    <span>{journalLabel(c.journalCode)}</span>
                    <span>·</span>
                    <Clock className="size-3" />
                    {timeAgo(c.claimedAt, t)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {totalCompleted > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            {t("doneToday", { count: totalCompleted })}
          </div>
          <div className="space-y-2">
            {data.completedToday.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded-2xl border border-[#c8f0d5] bg-[#ecfdf5] px-3 py-2"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#d9f4e1] text-[#136b2a]">
                  <CheckCircle2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#0b1024]">
                    {c.scopeLabel}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6f7282]">
                    <span className="text-[#136b2a]">
                      {c.userName || t("employee")}
                    </span>
                    <span>·</span>
                    <span>{journalLabel(c.journalCode)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
