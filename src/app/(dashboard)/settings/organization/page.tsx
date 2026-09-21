import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { OrganizationInfoForm } from "@/components/settings/organization-info-form";
import { PublicBadgeCard } from "@/components/settings/public-badge-card";
import { DeleteOrganizationCard } from "@/components/settings/delete-organization-card";
import { describeBadge } from "@/lib/badge/describe";
import { getBadgeStatusForOrganization } from "@/lib/badge/status";
import { readLegalProfile } from "@/lib/org-legal-profile";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function OrganizationInfoPage() {
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
  if (!org) redirect("/settings");
  const badgeStatus = org.badgeEnabled ? await getBadgeStatusForOrganization(getActiveOrgId(session)).catch(() => null) : null;
  const badge = describeBadge(org, badgeStatus?.percent ?? null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Информация об организации"
        description="Юридические реквизиты, контакты, брендинг и общие настройки. Используются в договорах, печатных журналах, портале инспектора и в Telegram-уведомлениях."
      />

      <PageGuide
        title="Что заполнить в реквизитах"
        storageKey="settings-organization-v1"
        bullets={[
          { title: "Название и ИНН — обязательно", body: "Они идут в шапку каждого печатного журнала и в договоры с поставщиками. Без ИНН Роспотребнадзор не примет PDF." },
          { title: "Адрес и телефон", body: "Место регистрации компании (для печатных форм) + контакт для инспекторов." },
          { title: "Тип организации", body: "Влияет на пресеты журналов: ресторану предлагается одно, пекарне — другое. Можно поменять позже." },
        ]}
        qa={[
          { q: "Можно без ИНН?", a: "Технически да — кнопка «Сохранить» сработает. Но печатные журналы и договоры будут без ИНН в шапке. Не рекомендуется." },
          { q: "Что такое brandColor?", a: "Цвет акцента вашего бренда (логотип, кнопки в Mini App). Хочется сделать white-label — задайте hex-код вашего корпоративного цвета." },
        ]}
      />

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

      <PublicBadgeCard initial={badge} />

      <DeleteOrganizationCard organizationName={org.name} deletionRequestedAt={org.deletionRequestedAt?.toISOString() ?? null} />
    </div>
  );
}
