import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

/** ХАССП, шаг 1 — группа ХАССП: состав, приказ, положение и подписанные документы. */
export default async function TeamPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [rows, staff, order, t, locale] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "team" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(organizationId),
    db.companyOrder.findFirst({
      where: { organizationId, templateCode: "haccp-team" },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, number: true, issuedAt: true },
    }),
    getTranslations("productionControl.team"),
    getLocale(),
  ]);

  const initial = parsePpkRecords("team", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  const header = (
    <PpkBlockHeader blockKey="team" lead={t("lead")} actions={<PpkCreateButton label={t("add")} />} />
  );

  return (
    <TeamClient
      initial={initial}
      staff={staff}
      header={header}
      order={
        order
          ? {
              id: order.id,
              number: order.number,
              date: order.issuedAt.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }),
            }
          : null
      }
    />
  );
}
