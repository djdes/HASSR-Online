import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadCabinetInspectorData } from "@/lib/inspector-qr-service";
import { runComplianceAudit } from "@/lib/compliance-audit";
import { orgDisplayName } from "@/lib/org-display-name";
import { InspectionQr } from "@/components/inspection/inspection-qr";
import { ComplianceBundleCard } from "@/components/reports/compliance-bundle-card";

export const dynamic = "force-dynamic";

/**
 * «Пришла проверка» — один экран на случай, когда проверяющий уже в
 * дверях (решение владельца 2026-10-16): ① показать QR, ② отдать журналы
 * архивом, ③ посмотреть, что исправить. Открыт и заведующей: проверка
 * часто приходит, когда она одна на месте. Выпускать QR и смотреть
 * готовность — руководству (как на их собственных страницах).
 */
export default async function InspectionPage() {
  const session = await requireAuth();
  const fullAccess = hasFullWorkspaceAccess(session.user);
  if (!fullAccess && !hasCapability(session.user, "tasks.verify")) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const showReadiness = hasCapability(session.user, "admin.full");

  const [inspector, report, org, t, tRoutes, locale] = await Promise.all([
    loadCabinetInspectorData(organizationId),
    // Сбой аудита готовности не должен ронять экран — шаг ③ просто не рисуется.
    showReadiness ? runComplianceAudit(organizationId).catch(() => null) : Promise.resolve(null),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, timezone: true },
    }),
    getTranslations("inspectionDay"),
    getTranslations("navigation.routes"),
    getLocale(),
  ]);

  // Действующий QR — самый долгий: его и показываем, и печатаем.
  const activeQr = inspector.tokens
    .filter((token) => token.isQr && token.qrSvg)
    .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
  const problems = report
    ? report.checks
        .filter((check) => check.status !== "ok")
        .sort((a, b) => (a.status === b.status ? b.weight - a.weight : a.status === "fail" ? -1 : 1))
        .slice(0, 3)
    : [];
  const visits = inspector.activity.slice(0, 5);
  const dateTime = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: org?.timezone || "Europe/Moscow",
  });

  return (
    <div className="space-y-4">
      <h1 className="sr-only">{tRoutes("inspection")}</h1>

      <Step number={1} title={t("qrTitle")}>
        <InspectionQr
          qr={activeQr ? { id: activeQr.id, svg: activeQr.qrSvg ?? "" } : null}
          organizationName={orgDisplayName(org?.name ?? "", "")}
          canIssue={fullAccess}
        />
      </Step>

      <Step number={2} title={t("archiveTitle")}>
        <ComplianceBundleCard bare />
      </Step>

      {report ? (
        <Step
          number={3}
          title={t("readinessTitle")}
          aside={
            <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] font-medium tabular-nums text-[#3848c7]">
              {t("readinessScore", {
                ok: String(report.summary.ok),
                total: String(report.checks.length),
              })}
            </span>
          }
        >
          {problems.length === 0 ? (
            <div className="flex items-center gap-2 text-[14px] text-[#116b2a]">
              <CheckCircle2 className="size-4" />
              {t("allGood")}
            </div>
          ) : (
            <ul className="divide-y divide-[#ececf4]" data-readiness-problems>
              {problems.map((check) => (
                <li key={check.id} className="flex items-center gap-3 py-2.5 text-[14px]">
                  {check.status === "fail" ? (
                    <XCircle className="size-4 shrink-0 text-[#a13a32]" />
                  ) : (
                    <AlertTriangle className="size-4 shrink-0 text-[#b45309]" />
                  )}
                  <span className="min-w-0 flex-1 text-[#0b1024]">{check.title}</span>
                  {check.fixUrl ? (
                    <Link
                      href={check.fixUrl}
                      className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
                    >
                      {t("fix")}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/dashboard/compliance-audit"
            className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
          >
            {t("allChecks")}
            <ArrowRight className="size-3.5" />
          </Link>
        </Step>
      ) : null}

      <section
        className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
        data-inspection-visits
      >
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("visitsTitle")}
        </h2>
        {visits.length === 0 ? (
          <p className="mt-2 text-[14px] text-[#9b9fb3]">{t("noVisits")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[#ececf4]">
            {visits.map((visit) => (
              <li key={visit.id} className="grid gap-0.5 py-2 text-[13.5px] sm:grid-cols-[140px_1fr] sm:gap-4">
                <span className="tabular-nums text-[#6f7282]">{dateTime.format(new Date(visit.at))}</span>
                <span className="min-w-0 text-[#0b1024] [overflow-wrap:anywhere]">
                  {visit.what}
                  {visit.viewer ? <span className="text-[#3848c7]"> — {visit.viewer}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Шаг: крупная цифра, короткий заголовок — человек видит порядок действий. */
function Step({
  number,
  title,
  aside,
  children,
}: {
  number: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-step={number}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[15px] font-semibold text-white tabular-nums">
          {number}
        </span>
        <h2 className="min-w-0 flex-1 text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
