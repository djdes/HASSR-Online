import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { getBalance } from "@/lib/balance/ledger";
import { PageHeader } from "@/components/ui/page-header";
import { groupServices, readActiveServices } from "@/lib/services/catalog";
import { ServicesCatalog } from "./services-catalog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Услуги",
};

/**
 * Каталог платных услуг в кабинете.
 *
 * Отдельно от «Подписки»: подписка — за сам сервис, а здесь работа
 * живого специалиста, которую нельзя автоматизировать. Заказ уходит
 * заявкой владельцу; фиксированную цену можно закрыть баллами, которые
 * организация уже накопила за приглашения и отзывы.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const session = await requireAuth();
  const { order } = await searchParams;
  const organizationId = getActiveOrgId(session);
  const canOrder = hasFullWorkspaceAccess(session.user);

  const [services, balanceRub, org, user] = await Promise.all([
    readActiveServices(),
    getBalance(organizationId),
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
      <PageHeader
        title="Услуги"
        description="Работа специалиста по пищевой безопасности: настройка журналов, аудит перед проверкой, разработка документации."
        actions={
          canOrder ? (
            <span className="inline-flex h-10 items-center rounded-2xl bg-[#f5f6ff] px-3.5 text-[13px] font-medium tabular-nums text-[#3848c7]">
              Баллов на балансе: {balanceRub.toLocaleString("ru-RU")} ₽
            </span>
          ) : null
        }
      />

      <ServicesCatalog
        groups={groupServices(services)}
        balanceRub={balanceRub}
        canOrder={canOrder}
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
