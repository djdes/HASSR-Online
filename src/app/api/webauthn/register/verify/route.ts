import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { requireApiAuth } from "@/lib/auth-helpers";
import { consumeWebAuthnChallenge, deviceLabelFromUserAgent, webAuthnOrigin, webAuthnRpId } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webauthn/register/verify — сохранить passkey сотрудника.
 * Body: { challengeId, response: RegistrationResponseJSON, label?: string }
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    challengeId?: string;
    response?: RegistrationResponseJSON;
    label?: string;
  };
  if (!body.challengeId || !body.response) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  const challenge = await consumeWebAuthnChallenge(body.challengeId, "register");
  if (!challenge || challenge.userId !== auth.session.user.id) {
    return NextResponse.json({ error: "Запрос устарел — попробуйте ещё раз" }, { status: 400 });
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: webAuthnOrigin(),
      expectedRPID: webAuthnRpId(),
      requireUserVerification: true,
    });
  } catch (err) {
    return NextResponse.json({ error: `Не удалось подтвердить ключ: ${String((err as Error).message ?? err).slice(0, 120)}` }, { status: 400 });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Ключ не подтверждён" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const label = (body.label?.trim() || deviceLabelFromUserAgent(request.headers.get("user-agent"))).slice(0, 60);
  const saved = await db.webAuthnCredential.upsert({
    where: { credentialId: credential.id },
    create: {
      userId: auth.session.user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: BigInt(credential.counter),
      transports: credential.transports ?? [],
      deviceLabel: label,
    },
    update: {
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: BigInt(credential.counter),
      transports: credential.transports ?? [],
      deviceLabel: label,
    },
    select: { id: true, deviceLabel: true, createdAt: true },
  });

  return NextResponse.json({ ok: true, credential: saved });
}
