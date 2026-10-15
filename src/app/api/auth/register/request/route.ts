import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  generateVerificationCode,
  hashVerificationCode,
  verificationExpiresAt,
} from "@/lib/registration";
import { sendVerificationEmail } from "@/lib/email";
import { registrationCodeRateLimiter } from "@/lib/rate-limit";
import { verifyRegistrationChallenge } from "@/lib/registration-antibot";
import { resolveRequestLocale } from "@/i18n/site-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register/request
 *
 * Step 1 of the multi-step registration wizard. Accepts the email the caller
 * wants to register, creates or resets an EmailVerification row with a fresh
 * 6-digit code, and mails the raw code. No Organization / User is created yet;
 * that happens in /register/confirm after the user enters the code.
 *
 * Existing account short-circuit: if an active User already owns that email,
 * we reject with 409 instead of silently sending a code.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Введите корректный email" },
      { status: 400 }
    );
  }

  // Rate-limit per-IP: защита от email-spam'а и DB-bloat'а.
  // Без этого бот мог отправить тысячи кодов на чужие email-адреса.
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || "unknown";
  if (!registrationCodeRateLimiter.consume(`register:${ip}`)) {
    return NextResponse.json(
      {
        error:
          "Слишком много запросов кода. Подождите 10 минут перед следующей попыткой.",
      },
      { status: 429 }
    );
  }

  const challenge = await verifyRegistrationChallenge(body);
  if (!challenge.ok) {
    return NextResponse.json({ error: challenge.error }, { status: challenge.status });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Пользователь с таким email уже существует" },
      { status: 409 }
    );
  }

  const code = generateVerificationCode();
  const codeHash = await hashVerificationCode(code);
  const expiresAt = verificationExpiresAt();

  await db.emailVerification.upsert({
    where: { email },
    update: { codeHash, expiresAt, attempts: 0 },
    create: { email, codeHash, expiresAt },
  });

  // Если SMTP не настроен и в production — отдаём 503 без кода.
  // Раньше API возвращал devCode прямо в JSON, и так как на проде
  // SMTP_HOST=localhost — любой мог зарегистрировать компанию на чужой
  // email, просто прочитав код из ответа.
  const smtpHost = (process.env.SMTP_HOST ?? "").trim();
  const smtpDisabled = !smtpHost || smtpHost === "localhost";
  const allowFallback = process.env.ALLOW_DEV_REGISTRATION_FALLBACK === "1";

  if (smtpDisabled && process.env.NODE_ENV === "production" && !allowFallback) {
    console.error(
      `[register/request] SMTP_HOST не настроен в production. Email с кодом для ${email} не отправлен.`
    );
    return NextResponse.json(
      {
        error:
          "Сервис подтверждения email временно недоступен. Обратитесь в поддержку.",
      },
      { status: 503 }
    );
  }

  await sendVerificationEmail(email, code, resolveRequestLocale(request)).catch((err) => {
    console.error("sendVerificationEmail failed", err);
  });

  // devCode возвращается только в development или при явном
  // ALLOW_DEV_REGISTRATION_FALLBACK=1. Никогда в production по умолчанию.
  const exposeCode =
    smtpDisabled &&
    (process.env.NODE_ENV !== "production" || allowFallback);
  return NextResponse.json({
    ok: true,
    ...(exposeCode ? { devCode: code } : {}),
  });
}
