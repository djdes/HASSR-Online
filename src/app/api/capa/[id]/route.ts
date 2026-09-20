import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { isManagementRole } from "@/lib/user-roles";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const ticket = await db.capaTicket.findUnique({ where: { id } });
  if (!ticket || ticket.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  // Раньше: body.status шёл в DB без проверки. Менеджер мог через
  // прямой fetch установить status=":wq" — на дашборде CAPA-фильтры
  // ломались, потому что ожидали enum.
  const VALID_STATUSES = new Set([
    "open",
    "investigating",
    "corrective_action",
    "verification",
    "closed",
    "rejected",
  ]);
  if (body.status) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: "Некорректный статус CAPA" },
        { status: 400 }
      );
    }
    data.status = body.status;
    if (body.status === "closed") data.closedAt = new Date();
    if (body.status === "verification" || body.status === "corrective_action") data.resolvedAt = new Date();
  }
  if (body.rootCause !== undefined) data.rootCause = body.rootCause;
  if (body.correctiveAction !== undefined) data.correctiveAction = body.correctiveAction;
  if (body.preventiveAction !== undefined) data.preventiveAction = body.preventiveAction;
  if (body.verificationResult !== undefined) data.verificationResult = body.verificationResult;
  if (body.assignedToId !== undefined) {
    // Scope-check: assignedToId должен быть юзером той же org. Иначе
    // менеджер компании A мог назначить CAPA юзеру компании B
    // (broken FK на UI компании B либо cross-tenant exposure через
    // assigned-to фильтр).
    if (body.assignedToId === null) {
      data.assignedToId = null;
    } else {
      const assignee = await db.user.findFirst({
        where: { id: body.assignedToId, organizationId: getActiveOrgId(session) },
        select: { id: true },
      });
      if (!assignee) {
        return NextResponse.json(
          { error: "Сотрудник не найден" },
          { status: 404 }
        );
      }
      data.assignedToId = body.assignedToId;
    }
  }
  if (body.priority !== undefined) {
    // Принимаем только валидные значения priority — иначе UI может
    // получить непонятный enum от другого CAPA-source'а.
    const validPriorities = ["low", "medium", "high", "critical"];
    if (typeof body.priority === "string" && validPriorities.includes(body.priority)) {
      data.priority = body.priority;
    }
  }

  const updated = await db.capaTicket.update({ where: { id }, data });
  return NextResponse.json(updated);
}
