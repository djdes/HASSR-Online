import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Раньше: isManagerRole — только role=manager. head_chef не мог
    // открыть /settings/audit, ROOT impersonating получал 403.
    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json(
        { error: "Это действие доступно руководителю" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const entity = searchParams.get("entity");
    const action = searchParams.get("action");
    const journalCode = searchParams.get("journalCode");

    // Динамический where с расширением через JSON-path для journalCode
    // фильтра (нужно для просмотра «всё что связано с конкретным журналом»).
    const where: Record<string, unknown> = {
      organizationId: getActiveOrgId(session),
    };

    if (entity) {
      where.entity = entity;
    }

    if (action) {
      where.action = action;
    }

    if (journalCode) {
      // Prisma JSON-path: details->>journalCode = $1. Если в записи
      // нет details или нет journalCode — она не пройдёт.
      where.details = {
        path: ["journalCode"],
        equals: journalCode,
      };
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Audit log fetch error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
