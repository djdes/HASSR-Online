import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { validateDeviceToken } from "@/lib/mobile-devices";

/**
 * Переключатель «Уведомления на этом телефоне» в профиле приложения.
 *
 * GET `?token=` — `{ pushEnabled }` этого телефона; PATCH
 * `{ token, pushEnabled }` — включить или выключить push. Только свой
 * телефон: чужой токен (или не зарегистрированный) — 404, как будто его
 * нет вовсе.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const parsed = validateDeviceToken(req.nextUrl.searchParams.get("token"));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const device = await db.mobileDevice.findFirst({
    where: { token: parsed.token, userId: auth.session.user.id },
    select: { pushEnabled: true },
  });
  if (!device) {
    return NextResponse.json({ error: "Телефон не найден" }, { status: 404 });
  }
  return NextResponse.json({ pushEnabled: device.pushEnabled });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as
    | { token?: unknown; pushEnabled?: unknown }
    | null;
  const parsed = validateDeviceToken(body?.token);
  if (!parsed.ok || typeof body?.pushEnabled !== "boolean") {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const res = await db.mobileDevice.updateMany({
    where: { token: parsed.token, userId: auth.session.user.id },
    data: { pushEnabled: body.pushEnabled },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Телефон не найден" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, pushEnabled: body.pushEnabled });
}
