import { notFound } from "next/navigation";
import { PageCrumbs } from "@/components/layout/page-nav";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { isManagementRole } from "@/lib/user-roles";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { OrganizationAccessCard } from "@/components/settings/organization-access-card";
import { formatPhone } from "@/lib/phone";
import { isTechnicalEmail } from "@/lib/technical-email";
import { UserAccessEditor } from "./user-access-editor";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function UserJournalAccessPage({ params }: PageProps) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    notFound();
  }
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      organizationId: true,
      journalAccessMigrated: true,
    },
  });
  if (!user) notFound();

  const activeOrg = getActiveOrgId(session);
  if (!session.user.isRoot && user.organizationId !== activeOrg) {
    notFound();
  }

  // Организации аккаунта — только владельцу и только для руководителей:
  // линейный сотрудник работает в одной точке, переключаться ему некуда.
  const ownerAccount = await db.account.findUnique({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  const canManageOrganizations =
    Boolean(ownerAccount) && isManagementRole(user.role);
  const accountOrganizations = canManageOrganizations
    ? await db.organization.findMany({
        where: { accountId: ownerAccount!.id },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          members: {
            where: { userId: user.id },
            select: { role: true },
          },
        },
      })
    : [];

  // Телефон — да, служебная почта — нет.
  const contactLabel = user.phone
    ? formatPhone(user.phone)
    : isTechnicalEmail(user.email)
      ? ""
      : user.email;

  const accessRows = await db.userJournalAccess.findMany({
    where: { userId: id },
    select: {
      templateCode: true,
      canRead: true,
      canWrite: true,
      canFinalize: true,
    },
  });

  return (
    <div className="space-y-5">
      <PageCrumbs
        items={[
          { label: "Настройки", href: "/settings" },
          { label: "Сотрудники", href: "/settings/users" },
          { label: user.name || contactLabel || "Сотрудник" },
        ]}
      />

      {accountOrganizations.length > 1 ? (
        <OrganizationAccessCard
          userId={user.id}
          userName={user.name || contactLabel || "Сотрудник"}
          organizations={accountOrganizations.map((organization) => ({
            id: organization.id,
            name: organization.name,
            isHome: organization.id === user.organizationId,
            enabled: organization.members.length > 0,
          }))}
        />
      ) : null}

      <div>
        <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.03em] text-black">
          Доступ к журналам
        </h1>
        {/* Служебная почта (…@….staff.local, staff-…@….local.haccp)
            сотруднику ничего не говорит и в интерфейс не выносится:
            показываем телефон, а если его нет — только имя. */}
        <p className="mt-2 text-[15px] text-[#6f7282]">
          {[user.name, contactLabel].filter(Boolean).join(" · ")}
        </p>
        {!user.journalAccessMigrated && (
          <p className="mt-3 text-[14px] text-[#b87a00]">
            Этому сотруднику пока открыт доступ ко всем журналам. После
            сохранения он увидит только отмеченные журналы.
          </p>
        )}
      </div>

      <UserAccessEditor
        userId={user.id}
        catalog={ACTIVE_JOURNAL_CATALOG.map((item) => ({ ...item }))}
        initialAccess={accessRows}
      />
    </div>
  );
}
