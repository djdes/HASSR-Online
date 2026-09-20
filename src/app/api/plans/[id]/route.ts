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

  const plan = await db.productionPlan.findUnique({ where: { id } });
  if (!plan || plan.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (Array.isArray(body.items)) {
    data.items = body.items;
  }
  // Allowlist для status — раньше можно было поставить любой string,
  // ломая UI-фильтр (draft/active/completed/cancelled).
  const VALID_STATUSES = ["draft", "active", "completed", "cancelled"];
  if (typeof body.status === "string" && VALID_STATUSES.includes(body.status)) {
    data.status = body.status;
  }
  if (body.notes !== undefined) {
    if (body.notes === null) {
      data.notes = null;
    } else if (typeof body.notes === "string") {
      data.notes = body.notes.slice(0, 2000);
    }
  }

  const updated = await db.productionPlan.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}
