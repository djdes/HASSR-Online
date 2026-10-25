import { NextResponse } from "next/server";
import { recordLogin } from "@/lib/login-trace";
import { createRateLimiter } from "@/lib/rate-limit";
import { helperAccessError, readHelperClientInfo } from "@/lib/setup-helper";
import { clientIp, issueHelperDevice } from "@/lib/setup-helper-auth";
import { verifyTelegramChallenge } from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Как у `/api/auth/login/code`: перебор ограничен и попытками челленджа (5),
// и IP — 15 за 5 минут.
const limiter = createRateLimiter({ tokensPerInterval: 15, intervalMs: 5 * 60 * 1000 });

/**
 * POST /api/setup-helper/auth/code — второй шаг входа в приложении:
 * `{ challengeId, code, deviceName, appVersion, installationId }` → ключ.
 */
export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!limiter.consume(`setup-helper-code:${ip ?? "unknown"}`)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите 5 минут." }, { status: 429 });
  }

  const raw: unknown = await request.json().catch(() => ({}));
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!challengeId || !code) {
    return NextResponse.json({ error: "Введите код" }, { status: 400 });
  }

  const result = await verifyTelegramChallenge(challengeId, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });

  const denied = helperAccessError(result.user);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  await recordLogin(result.user.id, ip, {
    userAgent: request.headers.get("user-agent"),
    method: result.method,
  });
  return NextResponse.json(await issueHelperDevice(result.user, readHelperClientInfo(body)));
}
