import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import {
  buildInternalInspectors,
  externalInspectorEntry,
  type ExternalInspector,
  type InternalInspector,
} from "@/lib/inspectors-auditors";
import { JOURNAL_ACCESS_CATALOG } from "@/lib/journal-access-catalog";

export type InspectorsAuditors = {
  external: ExternalInspector[];
  internal: InternalInspector[];
  totals: { externalActive: number; externalTotal: number; internalPeople: number };
  /** Документ → код его журнала: ссылка «где роль меняется» для проверяющего документа. */
  documentJournals: Record<string, string>;
};

/**
 * Общий список «Проверяющие и аудиторы» — источник
 * `GET /api/staff/inspectors-auditors` и страницы `/settings/inspectors`.
 * Хэш токена портала не выбирается вовсе: наружу он не попадёт даже случайно.
 */
export async function loadInspectorsAuditors(organizationId: string, now = new Date()): Promise<InspectorsAuditors> {
  const [tokens, users, organization, documents, rooms] = await Promise.all([
    db.inspectorToken.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        label: true,
        periodFrom: true,
        periodTo: true,
        expiresAt: true,
        lastAccessedAt: true,
        accessCount: true,
        revokedAt: true,
        createdAt: true,
        createdById: true,
        visits: {
          orderBy: { signedAt: "desc" },
          take: 20,
          select: { id: true, signedAt: true, inspectorName: true, templatesViewed: true },
        },
      },
    }),
    db.user.findMany({
      where: { organizationId, archivedAt: null, isRoot: false },
      select: {
        id: true,
        name: true,
        positionTitle: true,
        jobPosition: { select: { name: true } },
      },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { journalResponsibleUsersJson: true, disabledJournalCodes: true },
    }),
    db.journalDocument.findMany({
      where: { organizationId, status: "active", verifierUserId: { not: null } },
      select: { id: true, title: true, verifierUserId: true, template: { select: { code: true } } },
    }),
    db.room.findMany({
      where: { building: { organizationId }, NOT: { verifierUserIds: { isEmpty: true } } },
      select: { id: true, name: true, verifierUserIds: true },
    }),
  ]);

  // Кто выпустил ссылку — и уже архивные сотрудники: история не должна терять имя.
  const issuerIds = [...new Set(tokens.map((token) => token.createdById).filter((id): id is string => Boolean(id)))];
  const issuers = issuerIds.length
    ? await db.user.findMany({ where: { id: { in: issuerIds } }, select: { id: true, name: true } })
    : [];
  const issuerNames = new Map(issuers.map((user) => [user.id, user.name]));
  const external = tokens.map((token) => externalInspectorEntry(token, issuerNames, now));

  const internal = buildInternalInspectors({
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      position: user.jobPosition?.name?.trim() || user.positionTitle?.trim() || "",
    })),
    responsibleSlots: organization?.journalResponsibleUsersJson ?? {},
    documents: documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      templateCode: doc.template.code,
      verifierUserId: doc.verifierUserId,
    })),
    rooms,
    journalNames: new Map<string, string>(JOURNAL_ACCESS_CATALOG.map((item) => [item.code, item.name])),
    disabledCodes: parseDisabledCodes(organization?.disabledJournalCodes),
  });

  return {
    external,
    internal,
    totals: {
      externalActive: external.filter((item) => item.active).length,
      externalTotal: external.length,
      internalPeople: internal.length,
    },
    documentJournals: Object.fromEntries(documents.map((doc) => [doc.id, doc.template.code])),
  };
}
