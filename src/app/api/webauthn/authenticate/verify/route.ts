import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { issueKioskSession, issueSession } from "@/lib/issue-session";
import { resolveKioskContext } from "@/lib/kiosk-context";
import { recordLogin } from "@/lib/login-trace";
import { consumeWebAuthnChallenge, webAuthnOrigin, webAuthnRpId } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webauthn/authenticate/verify — вход по passkey.
 * Body: { challengeId, response: AuthenticationResponseJSON }
 *
 * На общем планшете (есть device-cookie киоска) выдаётся короткая
 * киоск-сессия и пишется SignatureEvent(method "passkey") — это подпись
 * сотрудника его собственным Face ID. Иначе — обычная сессия сайта.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    challengeId?: string;
    response?: AuthenticationResponseJSON;
  };
  if (!body.challengeId || !body.response?.id) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  const challenge = await consumeWebAuthnChallenge(body.challengeId, "authenticate");
  if (!challenge) {
    return NextResponse.json({ error: "Запрос устарел — попробуйте ещё раз" }, { status: 400 });
  }

  const cred = await db.webAuthnCredential.findUnique({
    where: { credentialId: body.response.id },
    include: { user: { include: { organization: true } } },
  });
  if (!cred || !cred.user.isActive || cred.user.archivedAt) {
    return NextResponse.json({ error: "Ключ не найден" }, { status: 401 });
  }
  if (challenge.userId && challenge.userId !== cred.userId) {
    return NextResponse.json({ error: "Ключ принадлежит другому сотруднику" }, { status: 401 });
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: webAuthnOrigin(),
      expectedRPID: webAuthnRpId(),
      requireUserVerification: true,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64url")),
        counter: Number(cred.counter),
        transports: cred.transports as AuthenticatorTransport[],
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Подпись не подтверждена: ${String((err as Error).message ?? err).slice(0, 120)}` }, { status: 401 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "Подпись не подтверждена" }, { status: 401 });
  }

  await db.webAuthnCredential.update({
    where: { id: cred.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });

  const user = cred.user;
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");
  const kiosk = await resolveKioskContext();

  if (kiosk && kiosk.device.organizationId === user.organizationId) {
    const lockAt = Date.now() + kiosk.organization.kioskIdleLockSeconds * 1000;
    const response = NextResponse.json({ ok: true, mode: "kiosk", user: { id: user.id, name: user.name }, lockAt });
    await issueKioskSession(
      response,
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: kiosk.device.organizationId,
        isRoot: user.isRoot,
        permissionPreset: user.permissionPreset,
      },
      kiosk.organization.name,
      { deviceId: kiosk.device.id, lockAt },
    );
    await db.signatureEvent.create({
      data: {
        organizationId: kiosk.device.organizationId,
        userId: user.id,
        method: "passkey",
        deviceId: kiosk.device.id,
        ip,
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
    });
    await db.kioskDevice.update({ where: { id: kiosk.device.id }, data: { lastSeenAt: new Date() } });
    return response;
  }

  await recordLogin(user.id, ip, { userAgent, method: "passkey" });
  await db.signatureEvent
    .create({
      data: { organizationId: user.organizationId, userId: user.id, method: "passkey", ip, userAgent: userAgent?.slice(0, 500) ?? null },
    })
    .catch(() => null);
  return issueSession(NextResponse.json({ ok: true, mode: "site" }), user, user.organization.name);
}

type AuthenticatorTransport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";
