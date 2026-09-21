import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { storeWebAuthnChallenge, webAuthnRpId } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webauthn/authenticate/options — начать вход по passkey.
 * Body: { userId?: string } — на киоске сотрудник уже выбран (сужаем список
 * ключей); на /login без userId — телефон сам предложит сохранённый ключ.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const userId = typeof body.userId === "string" && body.userId ? body.userId : null;

  const allow = userId
    ? await db.webAuthnCredential.findMany({
        where: { userId },
        select: { credentialId: true, transports: true },
      })
    : [];
  if (userId && allow.length === 0) {
    return NextResponse.json({ error: "У сотрудника нет ключа Face ID — добавьте его в профиле на своём телефоне" }, { status: 404 });
  }

  const options = await generateAuthenticationOptions({
    rpID: webAuthnRpId(),
    userVerification: "required",
    allowCredentials: allow.map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransport[] })),
  });
  const challengeId = await storeWebAuthnChallenge({ userId, challenge: options.challenge, kind: "authenticate" });
  return NextResponse.json({ challengeId, options });
}

type AuthenticatorTransport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";
