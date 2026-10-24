"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { LinkPendingSpinner } from "@/components/ui/link-pending";

type Row = {
  userId: string;
  name: string;
  status: "expired" | "warning" | "ok" | "missing" | "no_expiry";
  expiresAt?: string;
  daysLeft?: number;
};

type Resp = {
  summary: {
    expired: number;
    warning: number;
    missing: number;
    no_expiry: number;
    ok: number;
  };
  rows: Row[];
};

/**
 * Дашборд-виджет медкнижек: показывает количество expired / истекающих
 * в течение 30 дней. Под капотом — StaffCompetency со skill='med_book'.
 *
 * Реальная компоненая ценность: РПН требует наличие действующей
 * медкнижки у каждого работника, контактирующего с пищевыми
 * продуктами. Просрочка на одного — штраф 30-50 тысяч.
 */
export function MedBooksExpiryCard() {
  const t = useTranslations("dashboardUi.medBooksExpiryCard");
  const [data, setData] = useState<Resp | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/med-books-expiry", {
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

  const critical = data.summary.expired + data.summary.warning + data.summary.missing;
  const isClean = critical === 0 && data.summary.no_expiry === 0;

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${
              critical > 0 ? "bg-[#fff4f2] text-[#d2453d]" : "bg-[#ecfdf5] text-[#136b2a]"
            }`}
          >
            <BookOpen className="size-5" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[#0b1024]">
              {t("title")}
            </div>
            <div className="mt-0.5 text-[12px] text-[#6f7282]">
              {isClean ? (
                t("allCurrent")
              ) : (
                <>
                  {t("summary", {
                    expired: data.summary.expired,
                    warning: data.summary.warning,
                    missing: data.summary.missing,
                  })}
                </>
              )}
            </div>
          </div>
        </div>
        <Link
          href="/competencies"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3848c7] hover:underline"
        >
          {t("openCompetencies")}
          <LinkPendingSpinner />
        </Link>
      </div>

      {isClean ? (
        <div className="mt-4 inline-flex items-center gap-2 text-[13px] text-[#136b2a]">
          <CheckCircle2 className="size-4" />
          {t("allOk")}
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-1.5">
            {(expanded
              ? data.rows.filter((r) => r.status !== "ok")
              : data.rows.filter((r) => r.status !== "ok").slice(0, 5)
            ).map((r) => (
              <RowItem key={r.userId} row={r} />
            ))}
          </div>
          {data.rows.filter((r) => r.status !== "ok").length > 5 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[12px] font-medium text-[#3848c7] hover:underline"
            >
              {expanded
                ? t("collapse")
                : t("more", { count: data.rows.filter((r) => r.status !== "ok").length - 5 })}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function RowItem({ row }: { row: Row }) {
  const t = useTranslations("dashboardUi.medBooksExpiryCard");
  const map: Record<
    Row["status"],
    { bg: string; border: string; chip: string; iconClr: string; label: string }
  > = {
    expired: {
      bg: "bg-[#fff4f2]",
      border: "border-[#ffd2cd]",
      chip: "bg-[#ffe1dc] text-[#a13a32]",
      iconClr: "text-[#d2453d]",
      label: t("statusExpired"),
    },
    warning: {
      bg: "bg-[#fff8eb]",
      border: "border-[#ffe9b0]",
      chip: "bg-[#ffe9b0] text-[#a13a32]",
      iconClr: "text-[#a13a32]",
      label: t("statusWarning"),
    },
    missing: {
      bg: "bg-[#fafbff]",
      border: "border-[#ececf4]",
      chip: "bg-[#ececf4] text-[#6f7282]",
      iconClr: "text-[#9b9fb3]",
      label: t("statusMissing"),
    },
    no_expiry: {
      bg: "bg-[#fafbff]",
      border: "border-[#ececf4]",
      chip: "bg-[#ececf4] text-[#6f7282]",
      iconClr: "text-[#9b9fb3]",
      label: t("statusNoExpiry"),
    },
    ok: {
      bg: "bg-white",
      border: "border-[#ececf4]",
      chip: "bg-[#d9f4e1] text-[#136b2a]",
      iconClr: "text-[#136b2a]",
      label: "OK",
    },
  };
  const m = map[row.status];
  return (
    <Link
      href={`/competencies?user=${row.userId}`}
      className={`flex items-center gap-3 rounded-2xl border ${m.border} ${m.bg} px-3 py-2 transition-colors hover:bg-white`}
    >
      <span className={`flex size-8 shrink-0 items-center justify-center ${m.iconClr}`}>
        <AlertTriangle className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[#0b1024]">{row.name}</div>
        <div className="mt-0.5 text-[11px] text-[#6f7282]">
          {row.expiresAt ? t("until", { date: row.expiresAt }) : "—"}
          {row.daysLeft !== undefined ? ` · ${t("daysShort", { count: row.daysLeft })}` : ""}
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${m.chip}`}
      >
        {m.label}
      </span>
      <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
      <LinkPendingSpinner />
    </Link>
  );
}
