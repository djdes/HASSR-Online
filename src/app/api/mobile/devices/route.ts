import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { parseMobileAppUserAgent } from "@/lib/mobile-app";
import {
  registerMobileDevice,
  removeMobileDevice,
  validateDeviceInput,
  validateDeviceToken,
} from "@/lib/mobile-devices";

/**
 * Телефон с приложением WeSetup для push.
 *
 * POST `{ token, platform: "ios" | "android" }` — зарегистрировать или
 * перенести устройство на вошедшего (приложение шлёт после входа и на
 * каждом запуске). DELETE `{ token }` — отвязать при выходе (до выхода:
 * без сессии ответ 401).
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  // Общий планшет (киоск): личные уведомления того, кто ввёл ПИН, на
  // общем экране никому не нужны.
  if (session.user.kioskDeviceId) {
    return NextResponse.json(
      { error: "На общем планшете уведомления не подключаются" },
      { status: 403 }
    );
  }
  const parsed = validateDeviceInput(await req.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const app = parseMobileAppUserAgent(req.headers.get("user-agent"));
  await registerMobileDevice({
    userId: session.user.id,
    // Домашняя организация человека: устройство принадлежит ему, а не
    // той компании, которую он сейчас смотрит.
    organizationId: session.user.organizationId,
    token: parsed.token,
    platform: parsed.platform,
    appVersion: app?.version ?? "0.0.0",
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const parsed = validateDeviceToken(body?.token);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const removed = await removeMobileDevice(auth.session.user.id, parsed.token);
  return NextResponse.json({ ok: true, removed });
}
