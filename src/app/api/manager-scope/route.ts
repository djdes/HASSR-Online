import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

const VALID_VIEW_MODES = new Set([
  "all",
  "job_positions",
  "specific_users",
  "none",
]);

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // GET доступен management — listing manager-scopes других юзеров
  // приватно для admin'ов.
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    })
  ) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const orgId = getActiveOrgId(session);
  const scopes = await db.managerScope.findMany({
    where: { organizationId: orgId },
    include: {
      manager: {
        select: { id: true, name: true, jobPositionId: true, positionTitle: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ scopes });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // Управление иерархией — только management. Раньше: ЛЮБОЙ
  // authenticated юзер мог через прямой fetch создать managerScope
  // для себя с viewMode="all" и видеть всех сотрудников org-и.
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    })
  ) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const orgId = getActiveOrgId(session);
  const body = (await req.json().catch(() => ({}))) as {
    managerId?: string;
    viewMode?: string;
    viewJobPositionIds?: string[];
    viewUserIds?: string[];
    assignableJournalCodes?: string[];
  };

  if (typeof body.managerId !== "string" || !body.managerId) {
    return NextResponse.json({ error: "managerId required" }, { status: 400 });
  }

  // Verify manager belongs to same org
  const manager = await db.user.findFirst({
    where: { id: body.managerId, organizationId: orgId },
    select: { id: true },
  });
  if (!manager) {
    return NextResponse.json({ error: "Manager not found" }, { status: 404 });
  }

  // Allowlist для viewMode — раньше принимался любой string,
  // ломая filterSubordinates() switch-логику.
  const viewMode =
    typeof body.viewMode === "string" && VALID_VIEW_MODES.has(body.viewMode)
      ? body.viewMode
      : "all";

  // viewJobPositionIds — фильтруем чужих позиций.
  const candidateJpIds = Array.isArray(body.viewJobPositionIds)
    ? body.viewJobPositionIds.filter(
        (id: unknown): id is string => typeof id === "string" && id.length > 0
      )
    : [];
  let viewJobPositionIds: string[] = [];
  if (candidateJpIds.length > 0) {
    const positions = await db.jobPosition.findMany({
      where: { id: { in: candidateJpIds }, organizationId: orgId },
      select: { id: true },
    });
    viewJobPositionIds = positions.map((p) => p.id);
  }

  // viewUserIds — фильтруем чужих юзеров.
  const candidateUserIds = Array.isArray(body.viewUserIds)
    ? body.viewUserIds.filter(
        (id: unknown): id is string => typeof id === "string" && id.length > 0
      )
    : [];
  let viewUserIds: string[] = [];
  if (candidateUserIds.length > 0) {
    const users = await db.user.findMany({
      where: { id: { in: candidateUserIds }, organizationId: orgId },
      select: { id: true },
    });
    viewUserIds = users.map((u) => u.id);
  }

  const assignableJournalCodes = Array.isArray(body.assignableJournalCodes)
    ? body.assignableJournalCodes.filter(
        (c: unknown): c is string => typeof c === "string" && c.length > 0
      )
    : [];

  const scope = await db.managerScope.upsert({
    where: {
      organizationId_managerId: { organizationId: orgId, managerId: body.managerId },
    },
    create: {
      organizationId: orgId,
      managerId: body.managerId,
      viewMode,
      viewJobPositionIds,
      viewUserIds,
      assignableJournalCodes,
    },
    update: {
      viewMode,
      viewJobPositionIds,
      viewUserIds,
      assignableJournalCodes,
    },
  });

  return NextResponse.json({ scope });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // Только management может удалять scope-rows.
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    })
  ) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const orgId = getActiveOrgId(session);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db.managerScope.deleteMany({
    where: { id, organizationId: orgId },
  });

  return NextResponse.json({ deleted: true });
}
