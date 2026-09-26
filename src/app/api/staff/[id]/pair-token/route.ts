import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { brandQrPngDataUrl } from "@/lib/brand-qr";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from "@/lib/invite-tokens";
import { getServerSession } from "@/lib/server-session";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/staff/[id]/pair-token — выдать сотруднику ссылку для входа
 * без Telegram.
 *
 * Сценарий целиком офлайновый и в этом его сила: руководитель открывает
 * карточку сотрудника у себя на телефоне, показывает QR, сотрудник
 * сканирует своей камерой, задаёт пароль и оказывается в кабинете.
 * Подтверждение личности здесь сильнее, чем у SMS — люди стоят рядом.
 *
 * Именно поэтому SMS-код отвергнут: помимо цены и регистрации
 * альфа-имени, он ещё и не доходит в подвал кухни с одной палкой сети.
 *
 * Наружу отдаётся сырой токен ОДИН раз — в базе только хеш.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json(
      { error: "Выдавать доступ может руководство" },
      { status: 403 },
    );
  }

  const organizationId = getActiveOrgId(session);
  const { id } = await ctx.params;

  const user = await db.user.findFirst({
    where: { id, organizationId, archivedAt: null },
    select: { id: true, name: true, phone: true, isActive: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }
  if (!user.isActive) {
    return NextResponse.json(
      { error: "Сотрудник неактивен — сначала верните его в штат" },
      { status: 400 },
    );
  }
  if (!user.phone) {
    // Телефон — это и есть логин. Без него ссылка бессмысленна: задать
    // пароль сотрудник сможет, а войти потом будет нечем.
    return NextResponse.json(
      { error: "Сначала укажите телефон в карточке сотрудника — он и будет логином" },
      { status: 400 },
    );
  }

  const raw = generateInviteToken();
  const tokenHash = hashInviteToken(raw);
  const expiresAt = inviteExpiresAt();

  // upsert по userId: выдача новой ссылки гасит старую. Иначе по кухне
  // ходили бы несколько живых ссылок на один аккаунт.
  await db.staffPairToken.upsert({
    where: { userId: user.id },
    create: {
      organizationId,
      userId: user.id,
      tokenHash,
      expiresAt,
      createdById: session.user.id,
    },
    update: {
      tokenHash,
      expiresAt,
      consumedAt: null,
      createdById: session.user.id,
    },
  });

  const base =
    process.env.NEXTAUTH_URL?.replace(/\/+$/, "") ?? "https://wesetup.ru";
  const pairUrl = `${base}/pair/${raw}`;
  // Фирменный QR (`brand-qr.ts`); ×2 к размеру в окне — чётко на ретине.
  const qrPngDataUrl = await brandQrPngDataUrl(pairUrl, { width: 560 });

  return NextResponse.json({
    pairUrl,
    qrPngDataUrl,
    expiresAt: expiresAt.toISOString(),
    userName: user.name,
    phone: user.phone,
  });
}
