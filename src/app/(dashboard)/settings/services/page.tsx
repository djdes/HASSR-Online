import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { contactTelegramUrl } from "@/lib/contact-us";
import { groupServices, readActiveServices } from "@/lib/services/catalog";
import { ServicesCatalog } from "./services-catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("settingsUi.servicesPage");
  return { title: t("title") };
}

/**
 * Каталог платных услуг в кабинете.
 *
 * Отдельно от «Подписки»: подписка — за сам сервис, а здесь работа
 * живого специалиста, которую нельзя автоматизировать. Цен на странице нет
 * (владелец, 2026-10-29): вместо них «Свяжитесь с нами» с крупными
 * контактами, заказ уходит владельцу заявкой без оплаты.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const t = await getTranslations("settingsUi.servicesPage");
  const session = await requireAuth();
  const { order } = await searchParams;
  const organizationId = getActiveOrgId(session);
  const canOrder = hasFullWorkspaceAccess(session.user);

  const [services, org, user] = await Promise.all([
    readActiveServices(),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, phone: true },
    }),
    session.user?.id
      ? db.user.findUnique({
          where: { id: session.user.id },
          select: { name: true, email: true, phone: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <ServicesCatalog
        groups={groupServices(services)}
        canOrder={canOrder}
        telegramUrl={contactTelegramUrl(process.env)}
        initialServiceKey={typeof order === "string" ? order : null}
        contact={{
          name: user?.name ?? "",
          phone: user?.phone ?? org?.phone ?? "",
          email: user?.email ?? "",
        }}
      />
    </div>
  );
}
