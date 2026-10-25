import { NextResponse } from "next/server";
import { verifyEmailPassword } from "@/lib/credentials";
import { recordLogin } from "@/lib/login-trace";
import { loginRateLimiter } from "@/lib/rate-limit";
import { helperAccessError, readHelperClientInfo } from "@/lib/setup-helper";
import { clientIp, issueHelperDevice } from "@/lib/setup-helper-auth";
import { startTelegramChallenge, twoFactorRequired } from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/setup-helper/auth — вход в приложении «Сетап помощник».
 *
 * Тело: `{ email, password, deviceName, appVersion, installationId }`.
 * Ответ: `{ token, deviceId, user, organization }` или, если у человека
 * включено подтверждение входа кодом, `{ requiresCode, challengeId }` —
 * тогда ключ выдаёт `/api/setup-helper/auth/code`.
 *
 * Проверка пары — общим `verifyEmailPassword`, как у входа на сайт и у
 * «Онлайн принтера»: защита от перебора и подбора адресов одна на все входы.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Введите email и пароль" }, { status: 400 });
  }

  const ip = clientIp(request);
  const rateKey = `setup-helper:${ip ?? "unknown"}`;
  if (!loginRateLimiter.consume(rateKey)) {
    return NextResponse.json(
      { error: "Слишком много попыток входа. Подождите 5 минут." },
      { status: 429 },
    );
  }

  const user = await verifyEmailPassword(email, password);
  if (!user) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  // Роль проверяем до кода: слать в Telegram код человеку, которого всё
  // равно не пустим, незачем.
  const denied = helperAccessError(user);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const userAgent = request.headers.get("user-agent");
  if (twoFactorRequired(user)) {
    const challenge = await startTelegramChallenge(user, { ip, userAgent, method: "password" });
    if ("error" in challenge) {
      return NextResponse.json({ error: challenge.error }, { status: 503 });
    }
    return NextResponse.json({ requiresCode: true, challengeId: challenge.challengeId });
  }

  await recordLogin(user.id, ip, { userAgent, method: "password" });
  // Успешный вход не тратит лимит: за одним роутером кафе входит вся смена.
  loginRateLimiter.refund(rateKey);

  return NextResponse.json(await issueHelperDevice(user, readHelperClientInfo(body)));
}
