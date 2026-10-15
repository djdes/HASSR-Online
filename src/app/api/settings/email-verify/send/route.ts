import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  generateVerificationCode,
  hashVerificationCode,
  verificationExpiresAt,
} from "@/lib/registration";
import { sendVerificationEmail } from "@/lib/email";
import { isEmailVerified } from "@/lib/email-verification";
import { registrationCodeRateLimiter } from "@/lib/rate-limit";
import { resolveLocale } from "@/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Код подтверждения почты для уже вошедшего пользователя.
 *
 * Отдельный маршрут, а не переиспользование `/api/auth/register/request`:
 * тот отвечает 409 «пользователь уже существует», что здесь как раз
 * норма — аккаунт создан мгновенной регистрацией, почта просто ещё не
 * подтверждена.
 *
 * Адрес берём из сессии, а не из тела запроса: иначе можно было бы
 * рассылать коды на чужие почты от имени сервиса.
 */
export async function POST() {
  const session = await requireAuth();
  const email = session.user.email;
  if (!email) {
    return NextResponse.json(
      { error: "У аккаунта не указана почта" },
      { status: 400 },
    );
  }

  // Уже подтверждена — письмо не шлём. Иначе человек, у которого
  // карточка осталась висеть из-за устаревшего рендера, заказывает код
  // и получает письмо «подтвердите почту» на подтверждённый адрес.
  // Возвращаем `alreadyVerified`, чтобы карточка сразу исчезла.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { emailVerifiedAt: true },
  });
  if (isEmailVerified(me)) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  if (!registrationCodeRateLimiter.consume(`complete:${session.user.id}`)) {
    return NextResponse.json(
      { error: "Слишком часто. Попробуйте через несколько минут" },
      { status: 429 },
    );
  }

  const code = generateVerificationCode();
  const codeHash = await hashVerificationCode(code);
  const expiresAt = verificationExpiresAt();

  await db.emailVerification.upsert({
    where: { email },
    create: { email, codeHash, expiresAt, attempts: 0 },
    update: { codeHash, expiresAt, attempts: 0 },
  });

  await sendVerificationEmail(email, code, resolveLocale({ authenticated: true, userLocale: session.user.locale, organizationLocale: session.user.organizationLocale })).catch((err) =>
    console.error("profile/complete send-code failed", err),
  );

  return NextResponse.json({ ok: true });
}
