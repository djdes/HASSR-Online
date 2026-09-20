import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { verifyPhonePassword } from "@/lib/credentials";
import { issueSession } from "@/lib/issue-session";
import { recordLogin } from "@/lib/login-trace";
import { startTelegramChallenge, twoFactorRequired } from "@/lib/two-factor";
import { loginRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mini/login — вход сотрудника по телефону и паролю.
 *
 * Нужен, чтобы рабочий кабинет открывался ВНЕ Telegram: как обычная
 * вкладка браузера и, дальше, как установленное на телефон приложение.
 * До этого `/mini` без Telegram упирался в глухой экран «Откройте
 * внутри Telegram», хотя половина механики уже была — `/join/[token]`
 * заводит сотрудника с настоящим паролем и прямо пишет ему «войдите по
 * своему телефону и паролю». Экрана входа просто не существовало.
 *
 * Telegram-вход никуда не девается и остаётся основным для тех, кто уже
 * привязан. Это дополнение, а не замена.
 *
 * Структура повторяет `/api/auth/login` осознанно: тот же ограничитель
 * попыток, та же отметка о входе, та же выдача сессии. Расхождение в
 * защите двух входов рано или поздно означало бы дыру в том из них,
 * про который забыли.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const phone = String(body?.phone ?? "").trim();
    const password = String(body?.password ?? "");

    if (!phone || !password) {
      return NextResponse.json(
        { error: "Введите телефон и пароль" },
        { status: 400 },
      );
    }

    const ip = clientIp(request) ?? "unknown";
    if (!loginRateLimiter.consume(`mini-login:${ip}`)) {
      return NextResponse.json(
        { error: "Слишком много попыток входа. Подождите 5 минут." },
        { status: 429 },
      );
    }

    const user = await verifyPhonePassword(phone, password);
    if (!user) {
      // Одинаковый текст на «нет такого номера» и «не тот пароль»:
      // иначе по ответу перебираются существующие номера.
      return NextResponse.json(
        { error: "Неверный телефон или пароль" },
        { status: 401 },
      );
    }

    if (twoFactorRequired(user)) {
      const challenge = await startTelegramChallenge(user, {
        ip: ip === "unknown" ? null : ip,
        userAgent: request.headers.get("user-agent"),
        method: "phone",
      });
      if ("error" in challenge) {
        return NextResponse.json({ error: challenge.error }, { status: 503 });
      }
      return NextResponse.json({ requiresCode: true, challengeId: challenge.challengeId });
    }
    await recordLogin(user.id, ip === "unknown" ? null : ip, {
      userAgent: request.headers.get("user-agent"),
      method: "phone",
    });

    // Успешный вход не тратит лимит (см. /api/auth/login).
    loginRateLimiter.refund(`mini-login:${ip}`);
    return issueSession(
      NextResponse.json({ success: true }),
      user,
      user.organization.name,
    );
  } catch (error) {
    console.error("[mini-login]", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 },
    );
  }
}
