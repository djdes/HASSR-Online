import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { buildingWhere } from "@/lib/building-scope";
import { journalSettingsPointId } from "@/lib/journal-settings-target";
import { db } from "@/lib/db";
import { applyOrgJournalOverrides } from "@/lib/org-journal-settings";
import { sortJournalsByName } from "@/lib/journal-sort";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getDisabledJournalCodes, getDisabledPaperJournalIds, parseDisabledCodes } from "@/lib/disabled-journals";
import { getFillMode } from "@/lib/journal-routing";
import { JournalsSettingsClient } from "./journals-settings-client";
import { PageGuide } from "@/components/ui/page-guide";
import { normalizeSphere } from "@/lib/org-profile";
import { paperJournalsFor } from "@/lib/sphere-journal-rules";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import { getJournalPreviewMap } from "@/lib/journal-preview/service";

export const dynamic = "force-dynamic";

export default async function JournalsSettingsPage() {
  const t = await getTranslations("settingsUi.journalsPage");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [templateRows, organization, positions, users, positionAccess] =
    await Promise.all([
      db.journalTemplate.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          isMandatorySanpin: true,
          isMandatoryHaccp: true,
          fillMode: true,
          defaultAssigneeId: true,
          bonusAmountKopecks: true,
        },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          disabledJournalCodes: true,
          disabledPaperJournalIds: true,
          type: true,
        },
      }),
      db.jobPosition.findMany({
        where: { organizationId },
        orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, categoryKey: true },
      }),
      db.user.findMany({
        where: {
          organizationId,
          isActive: true,
          archivedAt: null,
          isRoot: false,
        },
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, jobPositionId: true },
      }),
      db.jobPositionJournalAccess.findMany({
        where: { organizationId },
        select: { templateId: true, jobPositionId: true },
      }),
    ]);
  // Распределение, исполнитель и бонус — свои у организации (`OrganizationJournalSetting`).
  const templates = await applyOrgJournalOverrides(organizationId, templateRows);

  // Точка из шапки — её набор журналов; «Вся организация» — набор всех точек.
  const pointId = await journalSettingsPointId(session);

  // Сколько активных документов у каждого журнала: выключение прячет их
  // из всех списков, и человек должен увидеть число заранее.
  const activeDocuments = await db.journalDocument.groupBy({
    by: ["templateId"],
    where: { organizationId, status: "active", ...buildingWhere(pointId) },
    _count: { _all: true },
  });
  const activeDocsByTemplate = new Map(
    activeDocuments.map((row) => [row.templateId, row._count._all])
  );

  const disabled = pointId
    ? await getDisabledJournalCodes(organizationId, pointId)
    : parseDisabledCodes(organization?.disabledJournalCodes);
  const disabledPaper = pointId
    ? await getDisabledPaperJournalIds(organizationId, pointId)
    : parseDisabledCodes(organization?.disabledPaperJournalIds);
  const sphere = normalizeSphere(organization?.type);
  const accessByTemplate = new Map<string, string[]>();
  for (const row of positionAccess) {
    const list = accessByTemplate.get(row.templateId) ?? [];
    list.push(row.jobPositionId);
    accessByTemplate.set(row.templateId, list);
  }

  // Снимки реальных документов — те же, что на дашборде и в /journals.
  const previewUrls = await getJournalPreviewMap(organizationId, pointId);

  // Журналы по алфавиту: клиент раскладывает их по группам
  // («обязательные», «рекомендуем», остальные) с сохранением порядка.
  const items = sortJournalsByName(templates, (t) => t.name).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isMandatorySanpin: t.isMandatorySanpin,
    isMandatoryHaccp: t.isMandatoryHaccp,
    previewUrl: previewUrls.get(t.code) ?? null,
    enabled: !disabled.has(t.code),
    fillMode: getFillMode(t),
    defaultAssigneeId: t.defaultAssigneeId,
    allowedPositionIds: accessByTemplate.get(t.id) ?? [],
    bonusAmountKopecks: t.bonusAmountKopecks,
    activeDocumentCount: activeDocsByTemplate.get(t.id) ?? 0,
  }));

  // Бумажные бланки сферы с тем же признаком enabled, что у
  // электронных: хранение негативное, поэтому новый бланк в каталоге
  // сразу включён.
  const paperItems = sortJournalsByName(paperJournalsFor(sphere), (j) => j.name).map((journal) => ({
    ...journal,
    enabled: !disabledPaper.has(journal.id),
  }));

  return (
    <div className="space-y-5">
      <PageGuide
        title={t("guideTitle")}
        storageKey="settings-journals-v2"
        bullets={[
          { title: t("b1Title"), body: t("b1Body") },
          { title: t("b2Title"), body: t("b2Body") },
          { title: t("b3Title"), body: t("b3Body") },
        ]}
        qa={[
          { q: t("q1"), a: t("a1") },
          { q: t("q2"), a: t("a2") },
          { q: t("q3"), a: t("a3") },
          { q: t("q4"), a: t("a4") },
        ]}
      />
      <JournalsSettingsClient
        items={items}
        paperItems={paperItems}
        sampleCodes={SAMPLE_JOURNAL_CODES}
        positions={positions}
        users={users}
        sphere={sphere}
      />
    </div>
  );
}
