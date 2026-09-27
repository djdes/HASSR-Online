import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import { JournalAccessMatrix } from "@/components/settings/journal-access-matrix";

export const dynamic = "force-dynamic";

export default async function JournalAccessMatrixPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const [users, access] = await Promise.all([
    db.user.findMany({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
        journalAccessMigrated: true,
        jobPosition: {
          select: { name: true, categoryKey: true },
        },
      },
    }),
    db.userJournalAccess.findMany({
      where: { user: { organizationId } },
      select: {
        userId: true,
        templateCode: true,
        canRead: true,
        canWrite: true,
        canFinalize: true,
      },
    }),
  ]);

  const accessByUser = new Map<
    string,
    Array<{
      templateCode: string;
      canRead: boolean;
      canWrite: boolean;
      canFinalize: boolean;
    }>
  >();
  for (const row of access) {
    const list = accessByUser.get(row.userId) ?? [];
    list.push({
      templateCode: row.templateCode,
      canRead: row.canRead,
      canWrite: row.canWrite,
      canFinalize: row.canFinalize,
    });
    accessByUser.set(row.userId, list);
  }

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              Журналы для сотрудников
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              Кто из сотрудников какие журналы видит и заполняет. Клик по
              ячейке — назначить или снять. Можно быстро дать «всю уборку
              уборщикам» или «все температуры поварам» через пресеты сверху.
              Пока у сотрудника нет ни одной галочки, он видит все журналы
              (совместимость со старой логикой).
            </p>
          </div>
        </div>
      </div>

      <JournalAccessMatrix
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          positionName: u.jobPosition?.name ?? null,
          positionCategory: u.jobPosition?.categoryKey ?? null,
          journalAccessMigrated: u.journalAccessMigrated,
          initialAccess: accessByUser.get(u.id) ?? [],
        }))}
        catalog={sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (j) => j.name).map((j) => ({
          code: j.code,
          name: j.name,
        }))}
      />
    </div>
  );
}
