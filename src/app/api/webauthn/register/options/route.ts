import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { requireApiAuth } from "@/lib/auth-helpers";
import { WEBAUTHN_RP_NAME, storeWebAuthnChallenge, webAuthnRpId } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webauthn/register/options — начать регистрацию passkey.
 *
 * Только под своей сессией: ключ привязывается к вошедшему сотруднику.
 * Уже зарегистрированные ключи исключаем, чтобы телефон не предлагал
 * создать дубликат.
 */
export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const user = await db.user.findUnique({
    where: { id: auth.session.user.id },
    select: { id: true, email: true, name: true, webAuthnCredentials: { select: { credentialId: true, transports: true } } },
  });
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  const options = await generateRegistrationOptions({
    rpName: WEBAUTHN_RP_NAME,
    rpID: webAuthnRpId(),
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: user.webAuthnCredentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  const challengeId = await storeWebAuthnChallenge({ userId: user.id, challenge: options.challenge, kind: "register" });
  return NextResponse.json({ challengeId, options });
}

type AuthenticatorTransport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";
