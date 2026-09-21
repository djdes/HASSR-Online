import Link from "next/link";
import { redirect } from "next/navigation";
import { Network } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { JournalsByPositionMatrix } from "@/components/settings/journals-by-position-matrix";
import { OnboardingApplyButton } from "@/components/settings/onboarding-apply-button";

export const dynamic = "force-dynamic";

/**
 * Per-position journal hierarchy. Каждая ячейка — одна строка в
 * `JobPositionJournalAccess`. Задача страницы: дать понятный
 * обратный угол на ту же таблицу, что редактируется per-template
 * через /settings/journals.
 *
 * Подгружаем в template-коды (`code`) — каталог `ACTIVE_JOURNAL_CATALOG`
 * хранит коды, а БД-связь хранится через `templateId`. Для UI-матрицы
 * это безразлично: оперируем кодами, конвертация в id делается на
 * сервере при PUT.
 */
export default async function JournalsByPositionPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const [positions, templates, accessRows, org] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        categoryKey: true,
        _count: { select: { users: { where: { isActive: true, archivedAt: null } } } },
      },
    }),
    db.journalTemplate.findMany({
      where: {
        code: { in: ACTIVE_JOURNAL_CATALOG.map((j) => j.code) },
      },
      select: { id: true, code: true },
    }),
    db.jobPositionJournalAccess.findMany({
      where: { organizationId },
      select: { jobPositionId: true, templateId: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    }),
  ]);

  // Чтобы клиент работал в кодах — дешевле один раз построить map
  // id→code на сервере, чем дёргать каталог в матрице.
  const templateIdToCode = new Map(templates.map((t) => [t.id, t.code]));

  const grantsByPosition = new Map<string, string[]>();
  for (const row of accessRows) {
    const code = templateIdToCode.get(row.templateId);
    if (!code) continue;
    const list = grantsByPosition.get(row.jobPositionId) ?? [];
    list.push(code);
    grantsByPosition.set(row.jobPositionId, list);
  }

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Network className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              Иерархия журналов по должностям
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              Какие журналы получают сотрудники каждой должности при
              рассылке «отправить всем». Если у должности нет ни одной
              отметки — пока ничего не выбрано, сотрудники этой должности
              могут вести все журналы. Чтобы запретить
              что-то конкретное конкретному человеку — используйте
              {" "}
              <Link
                href="/settings/journal-access"
                className="text-[#3848c7] underline-offset-2 hover:underline"
              >
                Журналы для сотрудников
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      <OnboardingApplyButton
        orgType={org?.type ?? null}
        showSeedStaff={positions.length === 0}
      />

      <JournalsByPositionMatrix
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          categoryKey: p.categoryKey,
          activeUsers: p._count.users,
          initialCodes: grantsByPosition.get(p.id) ?? [],
        }))}
        catalog={ACTIVE_JOURNAL_CATALOG.map((j) => ({
          code: j.code,
          name: j.name,
        }))}
      />
    </div>
  );
}
