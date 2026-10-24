import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import { JournalResponsiblesClient } from "@/components/settings/journal-responsibles-client";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";
import {
  getDefaultTaskMode,
  parseTaskModesJson,
} from "@/lib/journal-task-modes";

export const dynamic = "force-dynamic";

export default async function JournalResponsiblesPage() {
  const t = await getTranslations("settingsUi.journalResponsiblesPage");
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const [positions, users, templates, accessRows, org] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        categoryKey: true,
        _count: {
          select: { users: { where: { isActive: true, archivedAt: null } } },
        },
      },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null, isRoot: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        jobPositionId: true,
        role: true,
        isRoot: true,
      },
    }),
    db.journalTemplate.findMany({
      where: { code: { in: ACTIVE_JOURNAL_CATALOG.map((j) => j.code) } },
      select: { id: true, code: true, name: true, description: true },
    }),
    db.jobPositionJournalAccess.findMany({
      where: { organizationId },
      select: { jobPositionId: true, templateId: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        journalResponsibleUsersJson: true,
        journalDifficultyJson: true,
        journalTaskModesJson: true,
      },
    }),
  ]);

  const templateIdToCode = new Map(templates.map((t) => [t.id, t.code]));
  const positionsByJournal = new Map<string, string[]>();
  for (const row of accessRows) {
    const code = templateIdToCode.get(row.templateId);
    if (!code) continue;
    const list = positionsByJournal.get(code) ?? [];
    list.push(row.jobPositionId);
    positionsByJournal.set(code, list);
  }

  // Карта slot users из Organization.journalResponsibleUsersJson.
  const orgSlotUsers = (org?.journalResponsibleUsersJson ?? {}) as Record<
    string,
    Record<string, string | null>
  >;

  // Per-journal task-mode (включая distribution: per-employee/per-area/...).
  // Используется в client'е чтобы preset для per-employee журналов
  // распределял на ВСЕ должности и ставил админа в verifier.
  const taskModesOverride = parseTaskModesJson(org?.journalTaskModesJson);

  // Журналы по алфавиту (клиент группирует по категориям, порядок
  // внутри группы сохраняется).
  const journals = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (j) => j.name).map((j) => {
    const tpl = templates.find((t) => t.code === j.code);
    const def = getDefaultTaskMode(j.code);
    const ovr = taskModesOverride[j.code] ?? {};
    return {
      code: j.code,
      name: j.name,
      description: tpl?.description ?? null,
      initialPositionIds: positionsByJournal.get(j.code) ?? [],
      initialSlotUsers: orgSlotUsers[j.code] ?? {},
      distribution: (ovr.distribution ?? def.distribution) as string,
    };
  });

  return (
    <div className="space-y-5">
      <div>

      </div>

      {/* Тёмный hero снят: ниже идёт большая рабочая таблица журналов,
          баннер только отодвигал её за первый экран. */}
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <PageGuide
        storageKey="journal-responsibles"
        title={t("guideTitle")}
        bullets={[
          {
            title: t("b1Title"),
            body: t("b1Body"),
          },
          {
            title: t("b2Title"),
            body: t("b2Body"),
          },
          {
            title: t("b3Title"),
            body: t("b3Body"),
          },
          {
            title: t("b4Title"),
            body: t("b4Body"),
          },
          {
            title: t("b5Title"),
            body: t("b5Body"),
          },
        ]}
        qa={[
          {
            q: t("q1"),
            a: t("a1"),
          },
          {
            q: t("q2"),
            a: t("a2"),
          },
        ]}
      />

      <JournalResponsiblesClient
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          categoryKey: p.categoryKey,
          activeUsers: p._count.users,
        }))}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          jobPositionId: u.jobPositionId,
          role: u.role,
          isRoot: u.isRoot,
        }))}
        journals={journals}
        difficultyOverride={
          (org?.journalDifficultyJson ?? {}) as Record<string, number>
        }
      />
    </div>
  );
}
