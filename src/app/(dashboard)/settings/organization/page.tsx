import { OrganizationSpecialModeCard } from "@/components/settings/organization-special-mode-card";
import { notFound, redirect } from "next/navigation";
import { requireAuth, getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { OrganizationInfoForm } from "@/components/settings/organization-info-form";
import { PartnerConversionCard } from "@/components/settings/partner-conversion-card";
import { PublicBadgeCard } from "@/components/settings/public-badge-card";
import { DeleteOrganizationCard } from "@/components/settings/delete-organization-card";
import { describeBadge } from "@/lib/badge/describe";
import { prepareBadgeCode } from "@/lib/badge/prepare";
import { getBadgeStatusForOrganization } from "@/lib/badge/status";
import { loadConversionPreview } from "@/lib/partners/org-conversion";
import { readLegalProfile } from "@/lib/org-legal-profile";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";
import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { EmailVerifyCard } from "@/components/settings/email-verify-card";
import { isEmailVerified } from "@/lib/email-verification";
import { QuickStartCard } from "@/components/dashboard/quick-start-card";
import { OrgHealthWidget } from "@/components/dashboard/org-health-widget";
import { runOrgHealthCheck } from "@/lib/org-health-check";
import { ConsultantCard } from "@/components/dashboard/consultant-card";
import { getVisibleOrgBranding } from "@/lib/partners/branding";
import { toConsultantContact } from "@/lib/partners/consultant-contact";

export const dynamic = "force-dynamic";

export default async function OrganizationInfoPage() {
  const t = await getTranslations("settingsManagement.organizationProfile");
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      journalShortName: true,
      type: true,
      ownershipKind: true,
      locationsCount: true,
      inn: true,
      address: true,
      phone: true,
      accountantEmail: true,
      legalProfileJson: true,
      legalProfileUpdatedAt: true,
      legalFullName: true,
      kpp: true,
      ogrn: true,
      legalAddress: true,
      directorName: true,
      directorPost: true,
      locale: true,
      timezone: true,
      brandColor: true,
      logoUrl: true,
      shiftEndHour: true,
      lockPastDayEdits: true,
      requireAdminForJournalEdit: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      createdAt: true,
      badgeEnabled: true,
      badgeCode: true,
      deletionRequestedAt: true,
    },
  });
  if (!org) notFound();
  // Бейдж: код заводится заранее (ничего не публикует — страница открывается
  // только у включённого), процент считается и для живого примера.
  const [badgeCode, badgeStatus, conversion, me, healthCheck, branding] = await Promise.all([
    prepareBadgeCode(organizationId, org.badgeCode),
    getBadgeStatusForOrganization(organizationId).catch(() => null),
    // «Перевести в партнёрский кабинет» — только владельцу с партнёрским
    // кабинетом; null — блок не показывается.
    loadConversionPreview({
      userId: session.user.id,
      organizationId,
      inForeignMode: Boolean(session.user.partnerAccess) || isImpersonating(session),
    }).catch((error) => {
      console.error(`[partners] conversion preview failed org=${organizationId}`, error);
      return null;
    }),
    // Ниже — бывшие блоки главной (меню 2026-10-16): почта, быстрый
    // старт, самопроверка настройки и консультант — всё про компанию.
    db.user.findUnique({ where: { id: session.user.id }, select: { email: true, emailVerifiedAt: true } }),
    runOrgHealthCheck(organizationId),
    getVisibleOrgBranding(organizationId),
  ]);
  const consultant = toConsultantContact(branding);
  const badge = describeBadge({ badgeEnabled: org.badgeEnabled, badgeCode }, badgeStatus?.percent ?? null);

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
    <div className="space-y-5">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
      />

      {me && !isEmailVerified(me) ? <EmailVerifyCard email={me.email} /> : null}
      <QuickStartCard organizationId={organizationId} />
      {healthCheck.scorePercent < 100 ? (
        <OrgHealthWidget
          checks={healthCheck.checks}
          scorePercent={healthCheck.scorePercent}
          warnCount={healthCheck.warnCount}
          okCount={healthCheck.okCount}
          totalCount={healthCheck.totalCount}
        />
      ) : null}
      {consultant ? <ConsultantCard consultant={consultant} /> : null}

      {conversion ? (
        <PartnerConversionCard
          view={{
            organizationId: conversion.organizationId,
            organizationName: conversion.organizationName,
            partnerBrandName: conversion.partnerBrandName,
            blockers: conversion.plan.ok ? [] : conversion.plan.blockers,
            consequences: conversion.plan.ok ? conversion.plan.consequences : null,
          }}
        />
      ) : null}

      <PageGuide
        title={t("guide.title")}
        storageKey="settings-organization-v1"
        bullets={[
          { title: t("guide.nameTitle"), body: t("guide.nameBody") },
          { title: t("guide.addressTitle"), body: t("guide.addressBody") },
          { title: t("guide.sphereTitle"), body: t("guide.sphereBody") },
        ]}
        qa={[
          { q: t("guide.innQuestion"), a: t("guide.innAnswer") },
          { q: t("guide.brandQuestion"), a: t("guide.brandAnswer") },
        ]}
      />

      <OrganizationSpecialModeCard />

      <OrganizationInfoForm
        initial={{
          name: org.name,
          journalShortName: org.journalShortName,
          type: org.type,
          ownershipKind: org.ownershipKind,
          inn: org.inn,
          address: org.address,
          phone: org.phone,
          accountantEmail: org.accountantEmail,
          locale: org.locale,
          timezone: org.timezone,
          brandColor: org.brandColor,
          logoUrl: org.logoUrl,
          shiftEndHour: org.shiftEndHour,
          lockPastDayEdits: org.lockPastDayEdits,
          requireAdminForJournalEdit: org.requireAdminForJournalEdit,
          legalFullName: org.legalFullName,
          kpp: org.kpp,
          ogrn: org.ogrn,
          legalAddress: org.legalAddress,
          directorName: org.directorName,
          directorPost: org.directorPost,
        }}
        legal={{
          profile: readLegalProfile(org.legalProfileJson),
          updatedAt: org.legalProfileUpdatedAt?.toISOString() ?? null,
        }}
        meta={{
          locationsCount: org.locationsCount,
          subscriptionPlan: org.subscriptionPlan,
          subscriptionEnd: org.subscriptionEnd?.toISOString() ?? null,
          createdAt: org.createdAt.toISOString(),
        }}
      />

      <PublicBadgeCard initial={badge} organizationName={org.name} />

      <DeleteOrganizationCard organizationName={org.name} deletionRequestedAt={org.deletionRequestedAt?.toISOString() ?? null} />
    </div>
    </DomainMessagesBoundary>
  );
}
