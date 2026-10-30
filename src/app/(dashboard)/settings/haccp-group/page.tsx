import Link from "next/link";
import { forbidden } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Pencil, ScrollText } from "lucide-react";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import type { TeamRole } from "@/lib/ppk/haccp";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import {
  PersonAvatar,
  STAFF_BUTTON_OUTLINE,
  STAFF_BUTTON_PRIMARY,
  STAFF_PILL,
  StaffCard,
  StaffEmptyState,
} from "@/components/staff/staff-page-ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TEAM_HREF = "/production-control/haccp/team";

/** Порядок в списке: руководитель, заместитель, члены, секретарь — как в ППК. */
const ROLE_ORDER: Record<TeamRole, number> = { leader: 0, deputy: 1, member: 2, secretary: 3 };

/**
 * «Группа ХАССП» в разделе «Сотрудники» — только чтение: состав и роли из
 * программы производственного контроля (`PpkRecord`, block="team", та же
 * выборка, что `/production-control/haccp/team`). Меняют группу там.
 */
export default async function HaccpGroupPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [rows, staff, order, t, tTeam, locale] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "team" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(organizationId),
    db.companyOrder.findFirst({
      where: { organizationId, templateCode: "haccp-team" },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      select: { number: true, issuedAt: true },
    }),
    getTranslations("staffPages.haccpGroup"),
    getTranslations("productionControl.team"),
    getLocale(),
  ]);

  const staffById = new Map(staff.map((person) => [person.id, person]));
  const members = parsePpkRecords("team", rows).sort((a, b) => ROLE_ORDER[a.data.role] - ROLE_ORDER[b.data.role]);
  const hasLeader = members.some((member) => member.data.role === "leader");

  const editLink = (
    <Link href={TEAM_HREF} className={STAFF_BUTTON_PRIMARY} data-testid="haccp-group-edit">
      <Pencil className="size-4" />
      {t("edit")}
    </Link>
  );

  return (
    <div className="space-y-4" data-haccp-group-page>
      <SectionPageHeader description={t("description")} actions={members.length > 0 ? editLink : null} />

      <StaffCard
        id="members"
        number={1}
        title={t("membersTitle")}
        description={t("membersHint")}
        aside={
          members.length > 0 ? (
            <span className={cn(STAFF_PILL, "bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]")}>
              {t("count", { count: members.length })}
            </span>
          ) : null
        }
      >
        {members.length === 0 ? (
          <StaffEmptyState title={t("emptyTitle")} hint={t("emptyHint")}>
            {editLink}
          </StaffEmptyState>
        ) : (
          <>
            {!hasLeader ? (
              <p className="mb-3 rounded-2xl bg-[#fff8eb] px-4 py-3 text-[13.5px] text-[#8a5a00]">{tTeam("noLeader")}</p>
            ) : null}
            <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]" data-haccp-members>
              {members.map((member) => {
                const person = staffById.get(member.data.userId);
                const isLeader = member.data.role === "leader";
                return (
                  <li key={member.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 bg-white px-3 py-3 sm:px-4">
                    <PersonAvatar name={person?.name ?? "?"} muted={!person} />
                    <div className="min-w-0 flex-1 basis-[200px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn("text-[14px] font-medium", person ? "text-[#0b1024]" : "text-[#9b9fb3]")}>
                          {person?.name ?? tTeam("formerEmployee")}
                        </span>
                        <span
                          className={cn(STAFF_PILL, isLeader ? "bg-[#5566f6] text-white" : "bg-[#f5f6ff] text-[#3848c7]")}
                        >
                          {tTeam(`roles.${member.data.role}`)}
                        </span>
                      </div>
                      {person?.title ? <div className="text-[12.5px] text-[#6f7282]">{person.title}</div> : null}
                      {member.data.duties ? (
                        <p className="mt-1 line-clamp-2 text-[13px] leading-[1.5] text-[#3c4053]">{member.data.duties}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </StaffCard>

      <StaffCard id="documents" number={2} title={t("documentsTitle")} description={t("documentsHint")}>
        <p className="flex items-center gap-2 text-[14px] text-[#0b1024]">
          <ScrollText className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
          {order
            ? t("order", {
                number: order.number,
                date: order.issuedAt.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }),
              })
            : t("noOrder")}
        </p>
        <Link href={TEAM_HREF} className={cn(STAFF_BUTTON_OUTLINE, "mt-3")}>
          {t("openPpk")}
          <ArrowRight className="size-4 text-[#5566f6]" />
        </Link>
      </StaffCard>
    </div>
  );
}
