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
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const change = await db.changeRequest.findUnique({ where: { id } });
  if (!change || change.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  // Allowlist валидация status — без неё кто-то мог поставить
  // "yolo" в БД, ломая UI-фильтр и audit-flow.
  const VALID_STATUSES = [
    "requested",
    "pending",
    "approved",
    "rejected",
    "implemented",
    "cancelled",
  ];
  if (typeof body.status === "string" && VALID_STATUSES.includes(body.status)) {
    data.status = body.status;
    if (body.status === "approved") data.approvedById = session.user.id;
    if (body.status === "implemented") data.implementedAt = new Date();
  }
  // riskAssessment/testBatchResult — string или null. Раньше принимали
  // любой type, что ломало Prisma при попытке записать object/array.
  if (body.riskAssessment !== undefined) {
    if (body.riskAssessment === null) {
      data.riskAssessment = null;
    } else if (typeof body.riskAssessment === "string") {
      data.riskAssessment = body.riskAssessment.slice(0, 5000);
    }
  }
  if (body.testBatchResult !== undefined) {
    if (body.testBatchResult === null) {
      data.testBatchResult = null;
    } else if (typeof body.testBatchResult === "string") {
      data.testBatchResult = body.testBatchResult.slice(0, 5000);
    }
  }

  const updated = await db.changeRequest.update({ where: { id }, data });
  return NextResponse.json(updated);
}
