/**
 * Предзаполнение приказа о создании группы ХАССП из записей блока «Группа ХАССП».
 * Чистая функция: без БД и React.
 */
import type { TeamMember } from "./records";

type StaffRef = { id: string; name: string; title: string };

/**
 * Руководитель (Ф. И. О. и должность) и состав: остальные члены группы по
 * строке «Должность — Ф. И. О.». Сотрудники, которых нет в штате, пропускаются.
 */
export function buildHaccpTeamOrderValues(
  members: TeamMember[],
  staff: StaffRef[],
): { leaderName: string; leaderPost: string; members: string } {
  const byId = new Map(staff.map((person) => [person.id, person]));
  const leader = members.find((member) => member.role === "leader");
  const leaderPerson = leader ? byId.get(leader.userId) : undefined;

  const lines: string[] = [];
  for (const member of members) {
    if (member.role === "leader") continue;
    const person = byId.get(member.userId);
    if (!person) continue;
    lines.push(person.title ? `${person.title} — ${person.name}` : person.name);
  }

  return {
    leaderName: leaderPerson?.name ?? "",
    leaderPost: leaderPerson?.title ?? "",
    members: lines.join("\n"),
  };
}
