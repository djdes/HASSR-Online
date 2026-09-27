import { redirect } from "next/navigation";
import { Network } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { sessionHasPermission } from "@/lib/permissions-server";
import { StaffHierarchyClient } from "@/components/settings/staff-hierarchy-client";
import { PageGuide } from "@/components/ui/page-guide";
import { sortJournalsByName } from "@/lib/journal-sort";

export const dynamic = "force-dynamic";

export default async function StaffHierarchyPage() {
  const session = await requireAuth();
  const hasAccess = await sessionHasPermission(session, "settings.permissions");
  if (!hasAccess) {
    redirect("/settings");
  }

  const orgId = getActiveOrgId(session);

  const [positions, employees, scopes, templates] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId: orgId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, categoryKey: true },
    }),
    db.user.findMany({
      where: { organizationId: orgId, archivedAt: null, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        jobPositionId: true,
        positionTitle: true,
        role: true,
      },
    }),
    db.managerScope.findMany({
      where: { organizationId: orgId },
      include: {
        manager: {
          select: { id: true, name: true, jobPositionId: true, positionTitle: true },
        },
      },
    }),
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#fff8eb]">
            <Network className="size-5 text-[#f59e0b]" />
          </div>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold text-[#0b1024]">
              Иерархия управления
            </h1>
            <p className="text-[13px] text-[#6f7282]">
              Кто каких сотрудников видит и какие журналы может назначать
            </p>
          </div>
        </div>
      </div>

      <PageGuide
        storageKey="staff-hierarchy"
        title="Что такое иерархия и зачем"
        bullets={[
          {
            title: "Кого вижу — тому выдаю",
            body: "Каждый менеджер с настройкой scope видит только своих подчинённых в TasksFlow и при создании задач.",
          },
          {
            title: "Режимы scope",
            body: "«Все» — видит всех (но не админов и менеджеров — фильтр от 2026-04-30). «По должностям» — выбираешь должности (повар, уборщица). «Конкретные» — поштучно.",
          },
          {
            title: "После сохранения",
            body: "Изменения сразу пушатся в TasksFlow — у менеджера обновляется список подчинённых через несколько секунд.",
          },
        ]}
        qa={[
          {
            q: "Заведующий производством видит admin'a — почему?",
            a: "Если у его scope режим «Все» и admin тоже стоит как management, он его НЕ должна видеть. Если видит — проверь свежий ли deploy WeSetup или попробуй сменить scope на «По должностям» с явным выбором.",
          },
          {
            q: "Можно ли отключить иерархию",
            a: "Да: ставишь menager'у scope=«Все» — он видит всех cooks/waiters своей орги. У admin'a по дефолту так уже — он всегда видит всё.",
          },
        ]}
      />

      <StaffHierarchyClient
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          categoryKey: p.categoryKey as "management" | "staff",
        }))}
        employees={employees.map((u) => ({
          id: u.id,
          name: u.name,
          jobPositionId: u.jobPositionId,
          positionTitle: u.positionTitle,
        }))}
        scopes={scopes.map((s) => ({
          id: s.id,
          managerId: s.managerId,
          managerName: s.manager.name,
          managerPosition: s.manager.positionTitle,
          viewMode: s.viewMode as "all" | "job_positions" | "specific_users" | "none",
          viewJobPositionIds: s.viewJobPositionIds,
          viewUserIds: s.viewUserIds,
          assignableJournalCodes: s.assignableJournalCodes,
        }))}
        journals={sortJournalsByName(templates, (t) => t.name).map((t) => ({
          code: t.code,
          name: t.name,
        }))}
      />
    </div>
  );
}
