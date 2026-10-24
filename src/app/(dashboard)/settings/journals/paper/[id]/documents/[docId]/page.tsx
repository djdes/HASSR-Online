import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { paperJournalById } from "@/lib/sphere-journal-rules";
import { PageCrumbs } from "@/components/layout/page-nav";
import { PaperJournalEditor } from "../../paper-journal-editor";
import { PaperDocumentHeader } from "./paper-document-header";

export const dynamic = "force-dynamic";

/** `Date` из БД → `YYYY-MM-DD` для редактора и подписи периода. */
function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Страница документа бумажного журнала — как у электронных: свой адрес,
 * шапка с периодом и людьми, редактор с автосохранением. Чужая
 * организация или чужой журнал в адресе — 404, а не пустой бланк.
 */
export default async function PaperDocumentPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const t = await getTranslations("settingsUi.journalsSettingsClient");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/dashboard");
  const { id, docId } = await params;
  const journal = paperJournalById(id);
  if (!journal) notFound();

  const organizationId = getActiveOrgId(session);
  const [organization, document, employees] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, journalShortName: true, legalProfileJson: true, inn: true, address: true },
    }),
    db.paperJournalDocument.findFirst({
      where: { id: docId, journalId: id, organizationId },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      select: {
        name: true,
        positionTitle: true,
        jobPosition: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!document) notFound();

  const staff = employees.map((u) => ({
    name: u.name,
    title: u.jobPosition?.name?.trim() || u.positionTitle?.trim() || "",
  }));
  const rows = Array.isArray(document.rows)
    ? (document.rows as unknown[])
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => String(cell ?? "")))
    : [];
  const period = { from: isoDay(document.dateFrom), to: isoDay(document.dateTo) };

  return (
    <div className="space-y-5">
      <PageCrumbs
        items={[
          { label: t("title"), href: "/settings/journals#paper" },
          { label: journal.name, href: `/settings/journals/paper/${journal.id}` },
          { label: document.title },
        ]}
      />
      <PaperDocumentHeader
        journal={journal}
        title={document.title}
        period={period}
        responsible={document.responsible}
        verifier={document.verifier}
        closed={document.status === "closed"}
      />
      <PaperJournalEditor
        mode="document"
        journal={journal}
        organization={{
          // Как в шапке журналов и в PDF бланка: сокращённое → ЕГРЮЛ → полное.
          name: resolveOrgJournalName(organization),
          inn: organization?.inn ?? null,
          address: organization?.address ?? null,
        }}
        staff={staff}
        documentId={document.id}
        initialRows={rows}
        responsible={document.responsible ?? ""}
        verifier={document.verifier ?? ""}
        period={period}
        readOnly={document.status === "closed"}
      />
    </div>
  );
}
