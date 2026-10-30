import { forbidden, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { isEmailVerified } from "@/lib/email-verification";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { OrganizationContactsForm } from "@/components/settings/organization-contacts-form";

export const dynamic = "force-dynamic";

/**
 * «Моя компания → Контакты и уведомления»: телефон, почта бухгалтера,
 * часовой пояс и язык (раньше — секции «Контакты» и «Регион и язык» формы
 * реквизитов) и куда приходят уведомления — со ссылкой на их настройку.
 */
export default async function OrganizationContactsPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);
  const activeStaff = { organizationId, isActive: true, archivedAt: null };

  const [org, me, staffTotal, staffTelegram, t] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { phone: true, accountantEmail: true, timezone: true, locale: true },
    }),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, emailVerifiedAt: true, telegramChatId: true },
    }),
    db.user.count({ where: activeStaff }),
    db.user.count({ where: { ...activeStaff, telegramChatId: { not: null } } }),
    getTranslations("settingsManagement.organizationProfile.contactsPage"),
  ]);
  if (!org) notFound();

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
      <div className="space-y-5">
        <SectionPageHeader description={t("description")} />
        <PageGuide
          title={t("guide.title")}
          storageKey="settings-organization-contacts-v1"
          bullets={[
            { title: t("guide.phoneTitle"), body: t("guide.phoneBody") },
            { title: t("guide.timezoneTitle"), body: t("guide.timezoneBody") },
            { title: t("guide.notifyTitle"), body: t("guide.notifyBody") },
          ]}
        />
        <OrganizationContactsForm
          initial={org}
          notifications={{
            telegramLinked: Boolean(me?.telegramChatId),
            email: me?.email ?? "",
            emailVerified: me ? isEmailVerified(me) : false,
            staffTotal,
            staffTelegram,
          }}
        />
      </div>
    </DomainMessagesBoundary>
  );
}
