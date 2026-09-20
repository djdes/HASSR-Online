import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * H7 — Gift subscription. Owner может «подарить» 30/90 дней
 * подписки другой organization. Создаётся уникальный code
 * который reciever вводит при регистрации (или в /settings/subscription)
 * → его org.subscriptionEnd увеличивается.
 *
 * MVP-вариант: код хранится в AuditLog с
 * `action="gift.created"`. При активации (другой endpoint) — там же
 * логируется `gift.claimed`. Без отдельной модели — для простоты,
 * пока не масштаб.
 *
 * POST /api/settings/subscription/gift
 * Body: { durationDays: 30 | 90, recipientEmail?: string }
 * → { code: "WSET-XXXXXX-XXXXXX", url: "..." }
 *
 * Auth: owner.
 */

const Schema = z.object({
  durationDays: z.union([z.literal(30), z.literal(90)]),
  recipientEmail: z.string().email().optional(),
});

function makeCode(): string {
  const part = () =>
    randomBytes(3).toString("hex").toUpperCase().slice(0, 6);
  return `WSET-${part()}-${part()}`;
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  const orgId = getActiveOrgId(auth.session);
  const code = makeCode();
  await db.auditLog.create({
    data: {
      organizationId: orgId,
      userId: auth.session.user.id,
      userName: auth.session.user.name ?? null,
      action: "gift.created",
      entity: "gift_code",
      entityId: code,
      details: {
        durationDays: body.durationDays,
        recipientEmail: body.recipientEmail ?? null,
        claimedAt: null,
        claimedByOrgId: null,
      },
    },
  });

  const base =
    process.env.NEXTAUTH_URL?.replace(/\/+$/, "") ?? "https://wesetup.ru";
  const url = `${base}/register?gift=${code}`;
  return NextResponse.json({
    ok: true,
    code,
    url,
    durationDays: body.durationDays,
  });
}
