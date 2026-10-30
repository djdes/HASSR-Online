import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadTeamMeetings } from "@/lib/ppk/review.server";
import { moscowToday } from "@/lib/ppk/plan-done";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { MeetingsClient } from "./meetings-client";

export const dynamic = "force-dynamic";

/** ХАССП, шаг 1 — заседания группы: список протоколов и срок следующего заседания. */
export default async function TeamMeetingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [meetings, staff, teamRows, t] = await Promise.all([
    loadTeamMeetings(organizationId),
    loadPpkStaff(organizationId),
    db.ppkRecord.findMany({
      where: { organizationId, block: "team" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.meetings"),
  ]);

  // Члены группы — по умолчанию все отмечены присутствующими; уволенные не попадают.
  const staffIds = new Set(staff.map((person) => person.id));
  const memberIds = parsePpkRecords("team", teamRows)
    .map((row) => row.data.userId)
    .filter((userId) => staffIds.has(userId));

  const header = (
    <PpkBlockHeader blockKey="team" lead={t("lead")} actions={<PpkCreateButton label={t("add")} />} />
  );

  return (
    <MeetingsClient
      initial={meetings.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))}
      staff={staff}
      memberIds={memberIds}
      today={moscowToday()}
      header={header}
    />
  );
}
