import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { isManagementRole } from "@/lib/user-roles";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const batch = await db.batch.findUnique({ where: { id } });
  if (!batch || batch.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(batch);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const batch = await db.batch.findUnique({ where: { id } });
  if (!batch || batch.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  // Allowlist для status. ПОЧЕМУ переписан: здесь стояли значения
  // active/consumed/expired/rejected/quarantine, которых нет ни в модели
  // (default «received»), ни в UI (received / in_production / finished /
  // shipped / expired / written_off). Кнопки «В производство», «Готово»,
  // «Отгрузить», «Списать» присылали свои значения, allowlist их не
  // пропускал, update уходил с пустым data — ответ 200, статус не менялся.
  const VALID_STATUSES = [
    "received",
    "in_production",
    "finished",
    "shipped",
    "expired",
    "written_off",
  ];
  if (typeof body.status === "string") {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: "Неизвестный статус партии" },
        { status: 400 }
      );
    }
    data.status = body.status;
  }
  if (typeof body.productName === "string" && body.productName.trim()) {
    data.productName = body.productName.trim().slice(0, 200);
  }
  if (body.notes !== undefined) {
    if (body.notes === null) {
      data.notes = null;
    } else if (typeof body.notes === "string") {
      data.notes = body.notes.slice(0, 2000);
    }
  }
  if (body.expiryDate) {
    const d = new Date(body.expiryDate);
    if (!Number.isNaN(d.getTime())) {
      data.expiryDate = d;
    }
  }

  const updated = await db.batch.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}
