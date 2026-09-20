import { NextResponse } from "next/server";
import { verifyEmailPassword } from "@/lib/credentials";
import { issueSession } from "@/lib/issue-session";
import { loginRateLimiter } from "@/lib/rate-limit";
import { recordLogin } from "@/lib/login-trace";
import { startTelegramChallenge, twoFactorRequired } from "@/lib/two-factor";


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Введите email и пароль" },
        { status: 400 }
      );
    }

    // Rate-limit на IP (5 попыток / 5 мин) — защита от brute-force.
    // Кладём ключ комбинированный (IP + email-prefix) чтобы не банить
    // всю сетку при попытках на один email.
    const xff = request.headers.get("x-forwarded-for") ?? "";
    const ip = xff.split(",")[0].trim() || "unknown";
    const rlKey = `login:${ip}`;
    if (!loginRateLimiter.consume(rlKey)) {
      return NextResponse.json(
        {
          error: "Слишком много попыток входа. Подождите 5 минут.",
        },
        { status: 429 }
      );
    }

    // Проверка и защита от user-enumeration — в `lib/credentials.ts`:
    // тем же кодом входит программа «Онлайн принтер», и защита у обоих
    // входов обязана быть одна.
    const user = await verifyEmailPassword(email, password);

    if (!user) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    // Включено подтверждение кодом — сессию не выдаём: код уходит в
    // Telegram, сессию выдаст /api/auth/login/code.
    if (twoFactorRequired(user)) {
      const challenge = await startTelegramChallenge(user, {
        ip: ip === "unknown" ? null : ip,
        userAgent: request.headers.get("user-agent"),
        method: "password",
      });
      if ("error" in challenge) {
        return NextResponse.json({ error: challenge.error }, { status: 503 });
      }
      return NextResponse.json({ requiresCode: true, challengeId: challenge.challengeId });
    }
    // Отметка о входе — до выдачи сессии, но не в блокирующем смысле:
    // recordLogin глотает свои ошибки, вход от неё не зависит.
    await recordLogin(user.id, ip === "unknown" ? null : ip, {
      userAgent: request.headers.get("user-agent"),
      method: "password",
    });

    // Минт JWT и раскладка кук вынесены в lib/issue-session.ts —
    // мгновенная регистрация выдаёт сессию тем же кодом.
    // Успешный вход не тратит лимит: он защищает от перебора паролей, а за
    // одним роутером кафе входит вся смена.
    loginRateLimiter.refund(rlKey);
    return issueSession(
      NextResponse.json({ success: true }),
      user,
      user.organization.name,
    );
  } catch (error) {
    console.error("Custom login error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
