import { forbidden, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { visibleStaffWhere } from "@/lib/people-scope.server";
import { paperJournalById } from "@/lib/sphere-journal-rules";
import { PageCrumbs } from "@/components/layout/page-nav";
import { PaperDocumentsClient } from "./paper-documents-client";
import { PaperJournalEditor } from "./paper-journal-editor";
import { PaperJournalIntro } from "./paper-journal-intro";

export const dynamic = "force-dynamic";

/**
 * Бумажный журнал: список документов и быстрый черновик.
 *
 * Документы ведутся как в электронных журналах — на период, с
 * ответственным, каждый на своей странице. Черновик внизу ничего не
 * сохраняет: он для случая «вбил пару строк — скачал — распечатал».
 * Шапка организации подставляется сама, строки печатаются ровно;
 * подписи остаются живыми — в этом весь смысл бумажного журнала.
 */
export default async function PaperJournalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("settingsUi.journalsSettingsClient");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const { id } = await params;
  const journal = paperJournalById(id);
  if (!journal) notFound();

  const organizationId = getActiveOrgId(session);
  const [organization, employees] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, journalShortName: true, legalProfileJson: true, inn: true, address: true },
    }),
    // Люди точки из шапки (2026-11-01, бумажные по точкам): руководитель
    // точки не видит людей других точек в выборе ответственного.
    db.user.findMany({
      where: { AND: [{ organizationId, isActive: true, archivedAt: null }, await visibleStaffWhere(session)] },
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        jobPosition: { select: { name: true, categoryKey: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Должность: справочник → вписанная руками → пусто. Роль («cook») в
  // бланк для проверки не подставляем — это техническая метка.
  const staff = employees.map((u) => ({
    name: u.name,
    title: u.jobPosition?.name?.trim() || u.positionTitle?.trim() || "",
  }));

  return (
    <div className="space-y-5">
      <PageCrumbs
        items={[
          { label: t("title"), href: "/settings/journals#paper" },
          { label: journal.name },
        ]}
      />
      <PaperJournalIntro journal={journal} />
      <PaperDocumentsClient journal={journal} users={employees} />
      <PaperJournalEditor
        mode="draft"
        journal={journal}
        organization={{
          // Как в шапке журналов и в PDF бланка: сокращённое → ЕГРЮЛ → полное.
          name: resolveOrgJournalName(organization),
          inn: organization?.inn ?? null,
          address: organization?.address ?? null,
        }}
        staff={staff}
      />
    </div>
  );
}
