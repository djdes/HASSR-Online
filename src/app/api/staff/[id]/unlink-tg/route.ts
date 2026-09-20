import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getServerSession } from "@/lib/server-session";
import {
  StaffTelegramManagementError,
  unlinkStaffTelegram,
} from "@/lib/staff-telegram-management";
import { isManagementRole } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // Согласовано с /api/staff/[id]/invite-tg (ab1d96dd): head_chef
  // тоже управляет TG-привязками своих сотрудников. Раньше: только
  // manager → head_chef мог пригласить через TG, но не отвязать.
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  try {
    const result = await unlinkStaffTelegram({
      employeeId: id,
      organizationId: getActiveOrgId(session),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StaffTelegramManagementError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("staff unlink-tg route error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
