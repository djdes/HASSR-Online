"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  Loader2,
} from "lucide-react";
import { LinkPendingSpinner } from "@/components/ui/link-pending";

type Row = {
  userId: string;
  name: string;
  status: "overdue" | "warning" | "missing" | "ok";
  lastTrainedAt?: string;
  daysSince?: number;
};

type Resp = {
  summary: {
    overdue: number;
    warning: number;
    missing: number;
    ok: number;
  };
  rows: Row[];
};

/**
 * Дашборд-виджет: кто из сотрудников нуждается в плановом
 * гигиеническом обучении (>365 дней с прошлого, или нет совсем).
 * Источник: JournalDocumentEntry журнала staff_training.
 */
export function StaffTrainingCard() {
  const t = useTranslations("dashboardUi.staffTrainingCard");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/staff-training-overdue", {
          cache: "no-store",
        });
        if (res.ok) setData((await res.json()) as Resp);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 text-[#6f7282]">
        <Loader2 className="size-4 animate-spin inline" /> {t("loading")}
      </div>
    );
  }
  if (!data) return null;

  const need = data.summary.overdue + data.summary.missing + data.summary.warning;

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${
              need > 0 ? "bg-[#fff8eb] text-[#a13a32]" : "bg-[#ecfdf5] text-[#136b2a]"
            }`}
          >
            <GraduationCap className="size-5" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[#0b1024]">
              {t("title")}
            </div>
            <div className="mt-0.5 text-[12px] text-[#6f7282]">
              {need > 0 ? (
                <>
                  {t("summary", {
                    overdue: data.summary.overdue,
                    warning: data.summary.warning,
                    missing: data.summary.missing,
                  })}
                </>
              ) : (
                t("allCurrent")
              )}
            </div>
          </div>
        </div>
        <Link
          href="/journals/staff_training"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3848c7] hover:underline"
        >
          {t("journalLink")}
          <LinkPendingSpinner />
        </Link>
      </div>

      {need === 0 ? (
        <div className="mt-4 inline-flex items-center gap-2 text-[13px] text-[#136b2a]">
          <CheckCircle2 className="size-4" />
          {t("allTrained")}
        </div>
      ) : (
        <div className="mt-4 space-y-1.5">
          {data.rows
            .filter((r) => r.status !== "ok")
            .slice(0, 6)
            .map((r) => (
              <div
                key={r.userId}
                className={[
                  "flex items-center gap-3 rounded-2xl border px-3 py-2",
                  r.status === "overdue"
                    ? "border-[#ffd2cd] bg-[#fff4f2]"
                    : r.status === "warning"
                      ? "border-[#ffe9b0] bg-[#fff8eb]"
                      : "border-[#ececf4] bg-[#fafbff]",
                ].join(" ")}
              >
                <span className="flex size-8 shrink-0 items-center justify-center text-[#a13a32]">
                  <AlertTriangle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#0b1024]">
                    {r.name}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6f7282]">
                    {r.lastTrainedAt
                      ? t("lastTrained", { date: r.lastTrainedAt, days: r.daysSince ?? 0 })
                      : t("noRecord")}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    r.status === "overdue"
                      ? "bg-[#ffe1dc] text-[#a13a32]"
                      : r.status === "warning"
                        ? "bg-[#ffe9b0] text-[#a13a32]"
                        : "bg-[#ececf4] text-[#6f7282]"
                  }`}
                >
                  {r.status === "overdue"
                    ? t("badgeOverdue")
                    : r.status === "warning"
                      ? t("badgeWarning")
                      : t("badgeNone")}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
