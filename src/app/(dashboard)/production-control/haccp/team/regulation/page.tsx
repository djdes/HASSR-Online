import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import type { TeamMember } from "@/lib/ppk/records";
import { teamRegulationSections } from "@/lib/ppk/team-regulation-document";
import { PpkPrintSheet, loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";

export const dynamic = "force-dynamic";

const ROLE_RU: Record<TeamMember["role"], string> = {
  leader: "Руководитель группы",
  deputy: "Заместитель руководителя",
  member: "Член группы",
  secretary: "Секретарь",
};
const ROLE_ORDER: Record<TeamMember["role"], number> = { leader: 0, deputy: 1, member: 2, secretary: 3 };

/** Положение о группе ХАССП для печати: разделы, лист «Утверждаю» и состав группы из записей блока. */
export default async function TeamRegulationPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [org, rows, staff, t] = await Promise.all([
    loadPpkPrintOrg(organizationId),
    db.ppkRecord.findMany({
      where: { organizationId, block: "team" },
      select: { data: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(organizationId),
    getTranslations("productionControl.print"),
  ]);

  const staffById = new Map(staff.map((person) => [person.id, person]));
  const members = rows
    .map((row) => row.data as unknown as TeamMember)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const sections = teamRegulationSections(org.snapshot?.orgShortName || org.orgName);
  const director = org.snapshot;

  return (
    <div className="space-y-4">
      {members.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff7e6] px-4 py-3 text-[14px] text-[#8a5a00] print:hidden">
          <span>{t("emptyTeam")}</span>
          <Link
            href="/production-control/haccp/team"
            className="font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
          >
            {t("toBlock")}
          </Link>
        </div>
      ) : null}

      <PpkPrintSheet org={org} title="Положение о группе ХАССП">
        <div className="mb-6 ml-auto w-[260px] text-[13.5px]">
          <div className="font-semibold">УТВЕРЖДАЮ</div>
          <div>{director?.directorPost || "Руководитель"}</div>
          <div>{director?.directorName || "—"}</div>
          <div className="mt-4 flex items-end gap-2">
            <span className="w-[110px] border-b border-[#0b1024]" />
            <span>/</span>
            <span className="w-[80px] border-b border-[#0b1024]" />
          </div>
          <div className="mt-3">«____» ______________ 20___ г.</div>
        </div>

        {sections.map((section) => (
          <section key={section.title} className="mt-5 break-inside-avoid-page">
            <h2 className="mb-2 text-[15px] font-semibold">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mb-1.5 text-justify">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <section className="mt-5">
          <h2 className="mb-2 text-[15px] font-semibold">6. Состав группы</h2>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Ф. И. О.", "Должность", "Роль в группе", "Обязанности"].map((head) => (
                  <th key={head} className="border border-[#0b1024] px-2 py-1.5 text-left font-semibold">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const person = staffById.get(member.userId);
                return (
                  <tr key={member.userId} className="align-top">
                    <td className="border border-[#0b1024] px-2 py-1.5">{person?.name ?? "—"}</td>
                    <td className="border border-[#0b1024] px-2 py-1.5">{person?.title ?? "—"}</td>
                    <td className="border border-[#0b1024] px-2 py-1.5">{ROLE_RU[member.role]}</td>
                    <td className="border border-[#0b1024] px-2 py-1.5">{member.duties}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </PpkPrintSheet>
    </div>
  );
}
