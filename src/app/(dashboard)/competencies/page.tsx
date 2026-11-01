import { GraduationCap } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { visibleStaffWhere } from "@/lib/people-scope.server";
import { CompetencyCell } from "@/components/competencies/competency-cell";
import { getTranslations } from "next-intl/server";
import { COMPETENCY_SKILLS, COMPETENCY_LEVELS, competencyPositionLabel } from "@/components/competencies/competency-presentation";

const LEVEL_COLORS = [
  "bg-[#ececf4]",
  "bg-[#fff4c7]",
  "bg-[#9fb3ff]",
  "bg-[#7cf5c0]",
];

export default async function CompetenciesPage() {
  const session = await requireAuth();
  const t = await getTranslations("competenciesManagement");
  const roleLabels = { manager: t("roles.manager"), head_chef: t("roles.head_chef"), cook: t("roles.cook"), waiter: t("roles.waiter") };
  const orgId = getActiveOrgId(session);

  // Руководитель точки (и люди точки) видят матрицу только своих точек,
  // точка в шапке — только её людей (2026-11-01).
  const staffWhere = await visibleStaffWhere(session);
  const [users, allCompetencies] = await Promise.all([
    db.user.findMany({
      where: { organizationId: orgId, isActive: true, ...staffWhere },
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        jobPosition: { select: { name: true, categoryKey: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.staffCompetency.findMany({
      where: { organizationId: orgId },
    }),
  ]);
  const visibleUserIds = new Set(users.map((user) => user.id));
  const competencies = allCompetencies.filter((c) => visibleUserIds.has(c.userId));

  const matrix: Record<string, Record<string, { level: number; id: string }>> = {};
  for (const c of competencies) {
    if (!matrix[c.userId]) matrix[c.userId] = {};
    matrix[c.userId][c.skill] = { level: c.level, id: c.id };
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-[#5566f6]">
          <GraduationCap className="size-5" />
          <span className="text-[12px] font-medium uppercase tracking-[0.16em]">
            {t("matrixTitle")}
          </span>
        </div>
        <h1 className="mt-2 text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
          {t("title")}
        </h1>
        <p className="mt-1.5 text-[14px] text-[#6f7282]">
          {/* Раньше в шапке стояла одна шкала («Безопасно → Стабильно →
              Быстро»), а в легенде ниже — совсем другая. В данных
              хранится та, что в легенде, её и оставляем. */}
          {t("levelsSummary", { untrained: t("levels.0"), basic: t("levels.1"), intermediate: t("levels.2"), advanced: t("levels.3") })}
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {COMPETENCY_LEVELS.map((level) => (
          <div key={level} className="flex items-center gap-2 text-[12px] text-[#3c4053]">
            <span className={`size-3.5 rounded-md ${LEVEL_COLORS[level]}`} />
            <span>{t(`levels.${level}`)}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 md:overflow-visible">
        <div className="min-w-[720px] overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-[#ececf4] bg-[#fafbff] text-[12px] uppercase tracking-wider text-[#6f7282]">
                <th className="px-4 py-3 text-left font-medium">{t("employee")}</th>
                {COMPETENCY_SKILLS.map((skill) => (
                  <th
                    key={skill}
                    className="px-3 py-3 text-center font-medium"
                  >
                    {t(`skills.${skill}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-[#ececf4] last:border-b-0 hover:bg-[#fafbff]"
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-[#0b1024]">{user.name}</p>
                      {/* Под именем стоял код роли («cook»). Человеку
                          нужна должность, как она заведена в «Сотрудниках». */}
                      <p className="text-[12px] text-[#9b9fb3]">
                        {competencyPositionLabel(user, roleLabels)}
                      </p>
                    </div>
                  </td>
                  {COMPETENCY_SKILLS.map((skill) => {
                    const comp = matrix[user.id]?.[skill];
                    const level = comp?.level ?? 0;
                    return (
                      <td key={skill} className="px-3 py-3 text-center">
                        <CompetencyCell
                          userId={user.id}
                          userName={user.name}
                          skill={skill}
                          level={level}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
