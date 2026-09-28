import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-tokens";
import { checkUserActivation, seatLimitResponse } from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ token: string }> };

/**
 * POST /api/invite/[token]/accept — sets the invited user's password and
 * activates them. Marks the InviteToken.usedAt so replay is impossible.
 *
 * Never reveals whether the token is bad vs expired — any invalid state
 * returns the same generic 400.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;
  const raw = (token || "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Ссылка некорректна" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Пароль должен быть не короче 6 символов" },
      { status: 400 }
    );
  }

  const tokenHash = hashInviteToken(raw);
  const invite = await db.inviteToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Ссылка недействительна" },
      { status: 400 }
    );
  }

  // Принятие приглашения делает сотрудника активным — место в тарифе.
  // Сброс пароля уже активному ничего не добавляет и не блокируется.
  const seats = await checkUserActivation(invite.userId, {
    source: "invite.accept",
    audience: "invitee",
  });
  if (!seats.ok) return seatLimitResponse(seats);

  const passwordHash = await bcrypt.hash(password, 12);

  await db.$transaction([
    db.user.update({
      where: { id: invite.userId },
      data: { passwordHash, isActive: true },
    }),
    db.inviteToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    email: invite.user.email,
  });
}
