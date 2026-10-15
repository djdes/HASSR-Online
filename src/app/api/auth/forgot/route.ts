import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from "@/lib/invite-tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { registrationCodeRateLimiter } from "@/lib/rate-limit";
import { resolveLocale } from "@/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Восстановление доступа.
 *
 * Пароль после мгновенной регистрации живёт только в письме, поэтому
 * без этого маршрута потерянное письмо означало бы потерянный аккаунт.
 *
 * Ответ ВСЕГДА `200 { ok: true }` — независимо от того, есть такой
 * пользователь или нет. Иначе маршрут превратился бы в перебор чужих
 * почт: сам сброс, в отличие от входа, ничем не защищён паролем.
 *
 * Переиспользуем механику приглашений (`InviteToken`): та же таблица,
 * тот же экран установки пароля, та же одноразовость.
 */
export async function POST(request: Request) {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || "unknown";

  const body = await request.json().catch(() => null);
  const email =
    typeof (body as { email?: unknown } | null)?.email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";

  if (!registrationCodeRateLimiter.consume(`forgot:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком часто. Попробуйте через несколько минут" },
      { status: 429 },
    );
  }

  if (email && email.length <= 200) {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, isActive: true, locale: true },
    });

    if (user && user.isActive) {
      const raw = generateInviteToken();
      const tokenHash = hashInviteToken(raw);
      const expiresAt = inviteExpiresAt();

      // userId уникален в InviteToken — повторный запрос заменяет
      // прежнюю ссылку, старая перестаёт работать.
      await db.inviteToken.upsert({
        where: { userId: user.id },
        create: { userId: user.id, tokenHash, expiresAt },
        update: { tokenHash, expiresAt, usedAt: null },
      });

      const base = (
        process.env.NEXTAUTH_URL ||
        process.env.APP_URL ||
        "https://wesetup.ru"
      ).replace(/\/+$/, "");

      await sendPasswordResetEmail({
        to: email,
        resetUrl: `${base}/invite/${raw}?reset=1`,
        locale: resolveLocale({ authenticated: true, userLocale: user.locale }),
      }).catch((err) => console.error("sendPasswordResetEmail failed", err));
    }
  }

  return NextResponse.json({ ok: true });
}
