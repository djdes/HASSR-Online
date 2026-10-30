import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { runComplianceAudit } from "@/lib/compliance-audit";

export const dynamic = "force-dynamic";

const GRADE_TONE: Record<string, string> = {
  excellent: "from-emerald-50 to-white border-emerald-300",
  good: "from-emerald-50/60 to-white border-emerald-200",
  "needs-work": "from-amber-50 to-white border-amber-300",
  critical: "from-rose-50 to-white border-rose-300",
};

export default async function ComplianceAuditPage() {
  const t = await getTranslations("dashboardUi.complianceAuditPage");
  const gradeLabels: Record<string, string> = {
    excellent: t("gradeExcellent"),
    good: t("gradeGood"),
    "needs-work": t("gradeNeedsWork"),
    critical: t("gradeCritical"),
  };
  const categoryLabels: Record<string, string> = {
    structure: t("categoryStructure"),
    team: t("categoryTeam"),
    responsibles: t("categoryResponsibles"),
    records: t("categoryRecords"),
    capa: t("categoryCapa"),
    tasksflow: t("categoryTasksflow"),
    productionControl: t("categoryProductionControl"),
  };
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);
  const report = await runComplianceAudit(organizationId);

  // Группируем checks по category для удобного рендера.
  const grouped = new Map<string, typeof report.checks>();
  for (const c of report.checks) {
    const list = grouped.get(c.category) ?? [];
    list.push(c);
    grouped.set(c.category, list);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-1">
      {/* Hero with score */}
      <section
        className={`relative overflow-hidden rounded-3xl border-2 bg-gradient-to-br p-6 sm:p-8 ${GRADE_TONE[report.grade]}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#6f7282]">
              <ShieldCheck className="size-3.5" />
              {t("readiness")}
            </div>
            <h1 className="mt-3 text-[clamp(1.75rem,2vw+1rem,2rem)] font-bold leading-tight tracking-[-0.02em] text-[#0b1024] sm:text-[clamp(1.75rem,2vw+1rem,2rem)]">
              {gradeLabels[report.grade]}
            </h1>
            <p className="mt-2 text-[14px] text-[#3c4053]">
              {t("summary", {
                total: report.checks.length,
                ok: report.summary.ok,
                warn: report.summary.warn,
                fail: report.summary.fail,
              })}
            </p>
            <div className="mt-3 text-[13px] text-[#6f7282]">
              {t("journalsLine", {
                configured: report.summary.journalsConfigured,
                total: report.summary.journalsTotal,
                active: report.summary.journalsWithRecords30d,
              })}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div
              className={`text-[64px] font-semibold leading-none tracking-[-0.04em] ${
                report.totalScore >= 90
                  ? "text-emerald-700"
                  : report.totalScore >= 70
                    ? "text-emerald-600"
                    : report.totalScore >= 50
                      ? "text-amber-700"
                      : "text-rose-700"
              }`}
            >
              {report.totalScore}
            </div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#9b9fb3]">
              {t("outOf100")}
            </div>
          </div>
        </div>
      </section>

      {/* Checks grouped by category */}
      <div className="space-y-5">
        {Array.from(grouped.entries()).map(([cat, checks]) => (
          <section
            key={cat}
            className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white"
          >
            <div className="border-b border-[#ececf4] bg-[#fafbff] px-5 py-3">
              <h2 className="text-[14px] font-semibold uppercase tracking-[0.12em] text-[#0b1024]">
                {categoryLabels[cat] ?? cat}
              </h2>
            </div>
            <div className="divide-y divide-[#ececf4]">
              {checks.map((c) => {
                const Icon =
                  c.status === "ok"
                    ? CheckCircle2
                    : c.status === "warn"
                      ? AlertTriangle
                      : XCircle;
                const iconCls =
                  c.status === "ok"
                    ? "text-emerald-600"
                    : c.status === "warn"
                      ? "text-amber-600"
                      : "text-rose-600";
                return (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-start gap-3 px-5 py-4"
                  >
                    <Icon className={`mt-0.5 size-5 shrink-0 ${iconCls}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-[#0b1024]">
                          {c.title}
                        </span>
                        <span className="rounded-full bg-[#fafbff] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#9b9fb3]">
                          {t("weight", { weight: c.weight })}
                        </span>
                      </div>
                      {c.detail ? (
                        <div className="mt-0.5 text-[13px] leading-snug text-[#6f7282]">
                          {c.detail}
                        </div>
                      ) : null}
                    </div>
                    {c.fixUrl && c.status !== "ok" ? (
                      <Link
                        href={c.fixUrl}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[12px] font-medium text-[#5566f6] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      >
                        {t("fix")} <ArrowRight className="size-3" />
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="rounded-2xl border border-[#5566f6]/15 bg-[#f5f6ff]/50 p-4 text-[13px] leading-relaxed text-[#3848c7]">
        <strong>{t("scoringTitle")}</strong>{" "}
        {t("scoringBody", { total: report.checks.length })}
      </div>
    </div>
  );
}
