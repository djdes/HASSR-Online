import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { loadBuildingContext } from "@/lib/active-building";
import { buildingWhere, viewedPointId } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { documentVisibleWhere } from "@/lib/document-point-access";
import { inspectorTokensWhere } from "@/lib/inspector-point";
import {
  buildInternalInspectors,
  externalInspectorEntry,
  type ExternalInspector,
  type InternalInspector,
} from "@/lib/inspectors-auditors";
import { JOURNAL_ACCESS_CATALOG } from "@/lib/journal-access-catalog";
import { visibleStaffWhere } from "@/lib/people-scope.server";
import { visibleObjectBuildingIds } from "@/lib/point-objects.server";
import { parsePointScope } from "@/lib/point-scope";

export type InspectorsAuditors = {
  external: ExternalInspector[];
  internal: InternalInspector[];
  totals: { externalActive: number; externalTotal: number; internalPeople: number };
  /** Документ → код его журнала: ссылка «где роль меняется» для проверяющего документа. */
  documentJournals: Record<string, string>;
};

/**
 * Область списка (2026-11-01, «точка видит только своё»): руководитель точки —
 * его точки, точка в шапке — только она (и общее). «Вся организация» и
 * выключенные точки — всё, как раньше.
 */
export type InspectorsAuditorsScope = {
  /** Ссылки проверяющего: руководителю точки — его точек (как «Портал инспектора»), точка в шапке — её и на всю организацию. */
  tokenWhere: Prisma.InspectorTokenWhereInput;
  /** Люди списка (`visibleStaffWhere`). */
  userWhere: Prisma.UserWhereInput;
  /** Документы доступных точек и точки из шапки; общие — везде. */
  documentWhere: Prisma.JournalDocumentWhereInput;
  /** Точки помещений (`visibleObjectBuildingIds`); null — все. */
  roomBuildingIds: string[] | null;
};

export async function loadInspectorsAuditorsScope(session: Session): Promise<InspectorsAuditorsScope> {
  const [context, userWhere, roomBuildingIds] = await Promise.all([
    loadBuildingContext(session),
    visibleStaffWhere(session),
    visibleObjectBuildingIds(session),
  ]);
  const viewedPoint = viewedPointId(context);
  return {
    tokenWhere: { AND: [inspectorTokensWhere(parsePointScope(session.user.pointScope)), buildingWhere(viewedPoint)] },
    userWhere,
    documentWhere: { AND: [documentVisibleWhere(context), buildingWhere(viewedPoint)] },
    roomBuildingIds,
  };
}

/**
 * Общий список «Проверяющие и аудиторы» — источник
 * `GET /api/staff/inspectors-auditors` и страницы `/settings/inspectors`.
 * Хэш токена портала не выбирается вовсе: наружу он не попадёт даже случайно.
 * `scope` — область человека (`loadInspectorsAuditorsScope`).
 */
export async function loadInspectorsAuditors(
  organizationId: string,
  scope: InspectorsAuditorsScope,
  now = new Date(),
): Promise<InspectorsAuditors> {
  const [tokens, users, organization, documents, rooms] = await Promise.all([
    db.inspectorToken.findMany({
      where: { organizationId, ...scope.tokenWhere },
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
      where: { organizationId, archivedAt: null, isRoot: false, ...scope.userWhere },
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
      where: { organizationId, status: "active", verifierUserId: { not: null }, ...scope.documentWhere },
      select: { id: true, title: true, verifierUserId: true, template: { select: { code: true } } },
    }),
    db.room.findMany({
      where: {
        building: { organizationId },
        NOT: { verifierUserIds: { isEmpty: true } },
        ...(scope.roomBuildingIds ? { buildingId: { in: scope.roomBuildingIds } } : {}),
      },
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
