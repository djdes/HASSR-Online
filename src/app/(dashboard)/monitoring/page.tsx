import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { hasCapability } from "@/lib/permission-presets";
import { PPK_OVERVIEW_HREF } from "@/lib/ppk/registry";
import { loadMonitoring } from "@/lib/monitoring.server";
import { metricPercent, type MonitoringMetric } from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

const LINK =
  "inline-flex items-center gap-1.5 rounded-xl text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Кольцо с процентом: индиго по серой дорожке; нечего считать — «—». */
function MetricRing({ percent, label }: { percent: number | null; label: string }) {
  const radius = 52;
  const length = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : (percent / 100) * length;
  return (
    <div className="relative mx-auto size-[148px]" role="img" aria-label={label}>
      <svg viewBox="0 0 128 128" className="size-full -rotate-90" aria-hidden>
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#eef1ff" strokeWidth="12" />
        {filled > 0 ? (
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke={percent === 100 ? "#22a06b" : "#5566f6"}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${length}`}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[30px] font-semibold tabular-nums tracking-[-0.02em] text-[#0b1024]">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </div>
    </div>
  );
}

function MetricCard({
  testId,
  title,
  metric,
  countText,
  emptyText,
  hint,
  href,
  linkText,
}: {
  testId: string;
  title: string;
  metric: MonitoringMetric;
  countText: string;
  emptyText: string;
  hint: string | null;
  href: string;
  linkText: string;
}) {
  const percent = metricPercent(metric);
  return (
    <section
      className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-monitoring-card={testId}
      data-percent={percent ?? ""}
    >
      <h2 className="min-h-[44px] text-[16px] leading-snug font-semibold text-[#0b1024]">{title}</h2>
      <div className="py-4">
        <MetricRing percent={percent} label={percent === null ? emptyText : `${title}: ${percent}%`} />
      </div>
      <p className="text-center text-[14px] font-medium text-[#3c4053] tabular-nums">
        {percent === null ? emptyText : countText}
      </p>
      {hint ? <p className="mt-1 text-center text-[12.5px] text-[#6f7282]">{hint}</p> : null}
      <div className="mt-auto flex justify-center pt-4">
        <Link href={href} className={LINK}>
          {linkText}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/**
 * «Мониторинг» (эскиз 2026-10-28, лист 5): точка из шапки
 * и три кольца — журналы за сегодня, чек-листы текущего периода и готовность
 * программы производственного контроля. Каждая карточка ведёт к подробностям.
 */
export default async function MonitoringPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  // Точка — только из шапки (владелец, 2026-11-18: «смену точек — только
  // сверху»); «Вся организация» в шапке — сумма по всем точкам.
  const [data, t] = await Promise.all([loadMonitoring(session, null), getTranslations("monitoringPage")]);

  const canAssign = hasCapability(session.user, "admin.full");
  const counts = (metric: MonitoringMetric) => ({ done: String(metric.done), total: String(metric.total) });

  return (
    <div className="space-y-5" data-monitoring>
      <SectionPageHeader title={t("title")} description={t("lead")} />
      <PageGuide
        storageKey="monitoring"
        title={t("guide.title")}
        bullets={[t("guide.journals"), t("guide.checklists"), t("guide.ppk")]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          testId="journals"
          title={t("journals.title")}
          metric={data.journals}
          countText={t("journals.count", counts(data.journals))}
          emptyText={t("journals.empty")}
          hint={!data.perPointJournals && data.points.length >= 2 ? t("journals.shared") : null}
          href={data.journals.total > 0 ? "/dashboard" : "/journals/points"}
          linkText={data.journals.total > 0 ? t("open") : t("setUp")}
        />
        <MetricCard
          testId="checklists"
          title={t("checklists.title")}
          metric={data.checklists}
          countText={t("checklists.count", counts(data.checklists))}
          emptyText={t("checklists.empty")}
          hint={t("checklists.hint")}
          // Назначать чек-листы может только `admin.full`; остальным — результаты.
          href={data.checklists.total === 0 && canAssign ? "/checklists/assignments" : "/checklists/results"}
          linkText={data.checklists.total === 0 && canAssign ? t("setUp") : t("open")}
        />
        <MetricCard
          testId="ppk"
          title={t("ppk.title")}
          metric={data.ppk}
          countText={t("ppk.count", counts(data.ppk))}
          emptyText={t("ppk.count", counts(data.ppk))}
          hint={t("ppk.hint")}
          href={PPK_OVERVIEW_HREF}
          linkText={t("open")}
        />
      </div>
    </div>
  );
}
