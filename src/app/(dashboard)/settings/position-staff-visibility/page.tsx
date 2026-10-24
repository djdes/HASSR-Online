import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { PositionStaffVisibilityClient } from "@/components/settings/position-staff-visibility-client";

export const dynamic = "force-dynamic";

/**
 * «Видимость сотрудников по должностям» — единая точка управления:
 *   • кто кого видит в Telegram-боте
 *   • чьи задачи видит руководитель в TasksFlow (на главной + во
 *     вкладке «Сотрудники»)
 *
 * Модель: для каждой должности (Шеф-повар, Технолог, Уборщик…)
 * выбираешь список сотрудников, которых эта должность видит. Все
 * сотрудники с этой должностью получают одинаковый scope. Если
 * для должности задан непустой список — он перебивает ManagerScope
 * per-user, который остаётся для тонкой настройки конкретного
 * человека (legacy fallback).
 */
export default async function PositionStaffVisibilityPage() {
  const t = await getTranslations("settingsUi.positionStaffVisibilityPage");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const orgId = getActiveOrgId(session);

  const [positions, employees] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId: orgId },
      orderBy: [
        { categoryKey: "asc" },
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      select: {
        id: true,
        name: true,
        categoryKey: true,
        visibleUserIds: true,
        _count: {
          select: {
            users: { where: { isActive: true, archivedAt: null } },
          },
        },
      },
    }),
    db.user.findMany({
      where: { organizationId: orgId, isActive: true, archivedAt: null },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        positionTitle: true,
        jobPositionId: true,
        jobPosition: {
          select: { name: true, categoryKey: true },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Users className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024] dark:text-white">
              {t("title")}
            </h1>
            <p className="mt-1.5 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282] dark:text-white/70">
              {t("description")}
            </p>
          </div>
        </div>
      </div>

      <PositionStaffVisibilityClient
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          categoryKey: p.categoryKey,
          activeUsers: p._count.users,
          visibleUserIds: p.visibleUserIds,
        }))}
        employees={employees.map((e) => ({
          id: e.id,
          name: e.name,
          jobPositionId: e.jobPositionId,
          positionName: e.jobPosition?.name ?? e.positionTitle ?? null,
          positionCategory: e.jobPosition?.categoryKey ?? null,
        }))}
      />
    </div>
  );
}
