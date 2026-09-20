import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getServerSession } from "@/lib/server-session";
import {
  StaffTelegramInviteError,
  issueStaffTelegramInvite,
} from "@/lib/staff-telegram-invite";
import { isManagementRole } from "@/lib/user-roles";

/**
 * POST /api/staff/[id]/invite-tg
 *
 * Issues or reissues a Telegram invite for an existing employee on the
 * `/settings/users` page. Reissue is requested with `{ mode: "rebind" }`.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // head_chef нанимает / приглашает поваров напрямую — должен мочь
  // выпустить TG-invite наравне с manager'ом. Раньше: только manager.
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_USERNAME не настроен на сервере" },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    const mode = body.mode === "rebind" ? "rebind" : "invite";

    const result = await issueStaffTelegramInvite({
      employeeId: id,
      organizationId: getActiveOrgId(session),
      mode,
      botUsername,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StaffTelegramInviteError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("staff invite-tg route error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
