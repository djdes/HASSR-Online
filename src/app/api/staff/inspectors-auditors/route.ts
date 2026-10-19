import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  buildInternalInspectors,
  externalInspectorEntry,
} from "@/lib/inspectors-auditors";
import { JOURNAL_ACCESS_CATALOG } from "@/lib/journal-access-catalog";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/inspectors-auditors — общий список «Проверяющие и аудиторы».
 *
 *   external[] — ссылки и QR портала проверяющего: kind ("qr" | "link"),
 *                label, период, expiresAt, status ("active" | "expired" |
 *                "revoked"), issuedBy, accessCount, lastAccessedAt, visits[];
 *                хэш токена не отдаётся;
 *   internal[] — сотрудники и их роли проверки (журналы, документы,
 *                помещения, аудиты, прослеживаемость) — см.
 *                src/lib/inspectors-auditors.ts.
 *
 * Доступ: руководитель.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  const [tokens, users, organization, documents, rooms] = await Promise.all([
    db.inspectorToken.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      // tokenHash не выбираем: в ответ он не должен попасть даже случайно.
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
  const now = new Date();
  const external = tokens.map((token) =>
    externalInspectorEntry(token, new Map(issuers.map((user) => [user.id, user.name])), now)
  );

  const disabledCodes = new Set(
    Array.isArray(organization?.disabledJournalCodes)
      ? (organization.disabledJournalCodes as unknown[]).filter((code): code is string => typeof code === "string")
      : []
  );
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
    disabledCodes,
  });

  return NextResponse.json({
    external,
    internal,
    totals: {
      externalActive: external.filter((item) => item.active).length,
      externalTotal: external.length,
      internalPeople: internal.length,
    },
  });
}
