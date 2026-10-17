import { notFound, redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadTeamMeetings } from "@/lib/ppk/review.server";
import { meetingNumber } from "@/lib/ppk/review";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkPrintSheet, loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { PpkDocSection, PpkDocTable, ruDate } from "@/components/production-control/ppk-doc-ui";

export const dynamic = "force-dynamic";

/** Строка подписи: должность, линия, расшифровка. */
function SignatureLine({ post, name }: { post: string; name: string }) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
      <span className="min-w-[200px] flex-1">{post}</span>
      <span className="w-[130px] border-b border-[#0b1024]" />
      <span className="min-w-[140px]">/ {name} /</span>
    </div>
  );
}

/** Протокол заседания группы ХАССП для печати. */
export default async function TeamMeetingProtocolPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const { id } = await params;

  const [org, meetings, staff, teamRows] = await Promise.all([
    loadPpkPrintOrg(organizationId),
    loadTeamMeetings(organizationId),
    loadPpkStaff(organizationId),
    db.ppkRecord.findMany({
      where: { organizationId, block: "team" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const current = meetings.find((row) => row.id === id);
  if (!current) notFound();
  const meeting = current.data;
  const number = meetingNumber(
    meetings.map((row) => row.data),
    meeting,
  );

  const staffById = new Map(staff.map((person) => [person.id, person]));
  const team = parsePpkRecords("team", teamRows).map((row) => row.data);
  const roleHolder = (role: "leader" | "secretary") => {
    const member = team.find((item) => item.role === role);
    return member ? (staffById.get(member.userId) ?? null) : null;
  };
  const leader = roleHolder("leader");
  const secretary = roleHolder("secretary");

  const attendees = meeting.attendeeIds.flatMap((userId) => {
    const person = staffById.get(userId);
    return person ? [person] : [];
  });
  const decisions = meeting.decisions
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <PpkPrintSheet
      org={org}
      title={`Протокол заседания рабочей группы ХАССП № ${number} от ${ruDate(meeting.date)}`}
    >
      <PpkDocSection title="Присутствовали">
        {attendees.length === 0 ? (
          <p className="text-[#6f7282]">Не заполнено</p>
        ) : (
          <PpkDocTable
            heads={["№", "Ф. И. О.", "Должность"]}
            rows={attendees.map((person, index) => [String(index + 1), person.name, person.title || "—"])}
          />
        )}
      </PpkDocSection>

      <PpkDocSection title="Повестка">
        <p>{meeting.topic}</p>
      </PpkDocSection>

      <PpkDocSection title="Решили">
        {decisions.length === 0 ? (
          <p className="text-[#6f7282]">Не заполнено</p>
        ) : (
          decisions.map((line, index) => (
            <p key={index} className="mb-1.5 text-justify">
              {line}
            </p>
          ))
        )}
      </PpkDocSection>

      <section className="mt-10 space-y-6 break-inside-avoid">
        <SignatureLine post="Руководитель группы ХАССП" name={leader?.name ?? "______________"} />
        <SignatureLine post="Секретарь группы ХАССП" name={secretary?.name ?? "______________"} />
      </section>
    </PpkPrintSheet>
  );
}
