import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, BookOpen, Gauge, Handshake, type LucideIcon } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadCabinetInspectorData } from "@/lib/inspector-qr-service";
import { runComplianceAudit } from "@/lib/compliance-audit";
import { orgDisplayName } from "@/lib/org-display-name";
import { InspectionQr } from "@/components/inspection/inspection-qr";
import { InspectionGuide } from "@/components/inspection/inspection-guide";
import { InspectionSpecialModeStatus } from "@/components/inspection/inspection-special-mode-card";
import { ComplianceBundleCard } from "@/components/reports/compliance-bundle-card";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

const OPEN_LINK =
  "inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:self-center";

/**
 * «Что делать сейчас» — первый пункт раздела «К вам пришла проверка (или
 * придёт)» (решение владельца 2026-10-16, скан 83, S4 2026-10-18): шаги по
 * порядку и то, что нужно прямо в дверях, — ② QR на экране и ④ архив
 * документов. Журнал посещений (③) и спецрежим (⑤) стали своими пунктами
 * меню: здесь от них — коротко, со ссылкой «Открыть». Якорь `#special-mode`
 * остаётся: на него ведёт ссылка из «Реквизитов».
 *
 * Открыт и заведующей: проверка часто приходит, когда она одна на месте.
 * Выпускать QR, смотреть готовность и заказывать услуги — руководству (как на
 * их собственных страницах).
 */
export default async function InspectionPage() {
  const session = await requireAuth();
  const fullAccess = hasFullWorkspaceAccess(session.user);
  if (!fullAccess && !hasCapability(session.user, "tasks.verify")) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const showReadiness = hasCapability(session.user, "admin.full");

  const [inspector, report, org, visitCount, t, tItems, locale] = await Promise.all([
    loadCabinetInspectorData(organizationId),
    // Сбой аудита готовности не должен ронять экран — без балла, только ссылка.
    showReadiness ? runComplianceAudit(organizationId).catch(() => null) : Promise.resolve(null),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, timezone: true },
    }),
    // Как в журнале посещений: скрытые как ошибочные не считаем.
    db.inspectionVisit.count({ where: { organizationId, hiddenAt: null } }),
    getTranslations("inspectionDay"),
    getTranslations("navigation.shell.menus.inspection.items"),
    getLocale(),
  ]);
  const timeZone = org?.timezone || "Europe/Moscow";

  // Действующий QR — самый долгий: его и показываем, и печатаем.
  const activeQr = inspector.tokens
    .filter((token) => token.isQr && token.qrSvg)
    .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
  const recentViews = inspector.activity.slice(0, 5);
  const dateTime = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  // Остальные пункты раздела — коротко; каждый со своим правом, как в меню.
  const more: { id: string; href: string; icon: LucideIcon; title: string; hint: string; aside?: string }[] = [
    { id: "norms", href: "/inspection/norms", icon: BookOpen, title: tItems("norms"), hint: t("now.normsHint") },
    ...(showReadiness
      ? [
          {
            id: "readiness",
            href: "/dashboard/compliance-audit",
            icon: Gauge,
            title: tItems("readiness"),
            hint: t("now.readinessHint"),
            aside: report
              ? t("readinessScore", { ok: String(report.summary.ok), total: String(report.checks.length) })
              : undefined,
          },
        ]
      : []),
    ...(fullAccess
      ? [{ id: "experts", href: "/inspection/experts", icon: Handshake, title: tItems("experts"), hint: t("now.expertsHint") }]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Заголовок раздела по эскизу руководителя (скан 83). */}
      <SectionPageHeader title={t("pageTitle")} description={t("pageLead")} />

      <PageGuide
        storageKey="inspection-now"
        title={t("now.guideTitle")}
        bullets={[t("now.guide1"), t("now.guide2"), t("now.guide3")]}
        qa={[
          { q: t("now.q1"), a: t("now.a1") },
          { q: t("now.q2"), a: t("now.a2") },
        ]}
      />

      <InspectionGuide />

      <Step id="qr" number={2} title={t("qrTitle")}>
        <InspectionQr
          qr={activeQr ? { id: activeQr.id, svg: activeQr.qrSvg ?? "" } : null}
          organizationName={orgDisplayName(org?.name ?? "", "")}
          canIssue={fullAccess}
        />
      </Step>

      <Step
        id="visits"
        number={3}
        title={t("visits.title")}
        aside={
          visitCount > 0 ? (
            <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] font-medium tabular-nums text-[#3848c7]" data-visit-count={visitCount}>
              {t("visits.count", { count: visitCount })}
            </span>
          ) : null
        }
      >
        <OpenRow lead={t("now.visitsLead")} href="/inspection/visits" label={t("guide.open")} />
      </Step>

      <Step id="archive" number={4} title={t("archiveTitle")}>
        <ComplianceBundleCard bare />
      </Step>

      {/* `#special-mode` — адрес из «Реквизитов» (organization-special-mode-card). */}
      <Step id="special-mode" number={5} title={t("special.title")} aside={<InspectionSpecialModeStatus />}>
        <OpenRow lead={t("now.specialLead")} href="/inspection/special-mode" label={t("guide.open")} />
      </Step>

      <section
        className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
        data-inspection-more
      >
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("now.moreTitle")}</h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {more.map(({ id, href, icon: Icon, title, hint, aside }) => (
            <li key={id}>
              <Link
                href={href}
                className="group flex h-full items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 transition-[border-color,box-shadow,background-color] duration-200 hover:border-[#5566f6]/40 hover:bg-white hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                data-inspection-more-link={id}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-[#0b1024]">{title}</span>
                  <span className="mt-1 block text-[13.5px] leading-[1.55] text-[#3c4053]">{hint}</span>
                  {aside ? (
                    <span className="mt-2 inline-flex rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12.5px] font-medium tabular-nums text-[#3848c7]">
                      {aside}
                    </span>
                  ) : null}
                </span>
                <ArrowRight className="mt-2.5 size-4 shrink-0 text-[#9b9fb3] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#5566f6]" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
        data-inspection-visits
      >
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("visitsTitle")}
        </h2>
        {recentViews.length === 0 ? (
          <p className="mt-2 text-[14px] text-[#9b9fb3]">{t("noVisits")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[#ececf4]">
            {recentViews.map((visit) => (
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
  id,
  number,
  title,
  aside,
  children,
}: {
  id: string;
  /** Номер шага инструкции «Что делать сейчас». */
  number: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
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

/** Шаг, ставший пунктом меню: одна строка пояснения и «Открыть →». */
function OpenRow({ lead, href, label }: { lead: string; href: string; label: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-[640px] text-[14px] leading-[1.55] text-[#6f7282]">{lead}</p>
      <Link href={href} className={OPEN_LINK} data-step-open={href}>
        {label}
        <ArrowRight className="size-4 text-[#5566f6]" aria-hidden />
      </Link>
    </div>
  );
}
