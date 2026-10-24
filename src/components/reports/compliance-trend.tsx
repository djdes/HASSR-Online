"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { TrendPoint } from "@/lib/compliance-trend";

/**
 * Полотно грузится по требованию: `recharts` весит 359 КБ (107 КБ gzip)
 * и при статическом импорте попадал в общий чанк страницы отчётов.
 * Высота заглушки совпадает с высотой графика, чтобы блок не прыгал.
 */
const ComplianceTrendGraph = dynamic(
  () => import("./compliance-trend-graph").then((m) => m.ComplianceTrendGraph),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-[#f5f6ff]" />,
  },
);

type Props = {
  points: TrendPoint[];
};

/**
 * E1 — линейный график «записей в журналах за 12 месяцев». Помогает
 * увидеть сезонность («у нас провалы в августе»), общий тренд («росли
 * 6 месяцев, теперь падает»).
 */
export function ComplianceTrend({ points }: Props) {
  const t = useTranslations("reportsUi.complianceTrend");
  if (points.length === 0) return null;

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
        {t("title")}
      </h2>
      <p className="mt-0.5 text-[13px] text-[#6f7282]">
        {t("description")}
      </p>

      <div className="mt-4 h-[240px] w-full">
        <ComplianceTrendGraph points={points} />
      </div>

      <div className="mt-3 flex items-center gap-4 text-[12px] text-[#6f7282]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full bg-[#5566f6]" />
          {t("entries")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full bg-[#7a5cff] opacity-60" />
          {t("uniqueTemplates")}
        </span>
      </div>
    </section>
  );
}
