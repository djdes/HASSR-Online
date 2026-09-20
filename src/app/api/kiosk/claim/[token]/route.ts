import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashInviteToken, generateInviteToken } from "@/lib/invite-tokens";
import {
  KIOSK_DEVICE_COOKIE,
  KIOSK_DEVICE_COOKIE_MAX_AGE,
  mintKioskDeviceToken,
} from "@/lib/kiosk-device";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/kiosk/claim/[token] — планшет открывает enroll-ссылку.
 *
 * По одноразовому токену находим устройство, ставим долгоживущую
 * device-cookie `wesetup.kiosk` и уводим на экран киоска. Токен гасим
 * (перезаписываем secretHash), чтобы ссылку нельзя было переиспользовать.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Публичный домен, а не внутренний localhost:3002 за nginx.
  const origin = resolveQrPosterOrigin({
    requested: null,
    configured: process.env.NEXTAUTH_URL ?? null,
    production: process.env.NODE_ENV === "production",
  });

  const device = await db.kioskDevice.findFirst({
    where: { secretHash: hashInviteToken(token), revokedAt: null },
    select: { id: true },
  });
  if (!device) {
    return NextResponse.redirect(`${origin}/mini/kiosk?error=enroll`);
  }

  // Одноразовость: гасим enroll-токен, ставим отметку первого выхода.
  await db.kioskDevice.update({
    where: { id: device.id },
    data: { secretHash: hashInviteToken(generateInviteToken()), lastSeenAt: new Date() },
  });

  const response = NextResponse.redirect(`${origin}/mini/kiosk`);
  response.cookies.set(KIOSK_DEVICE_COOKIE, mintKioskDeviceToken(device.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: KIOSK_DEVICE_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
