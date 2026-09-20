import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/capa/bulk-close
 *
 * Body: { ids: string[], note?: string }
 *
 * Закрывает массово до 100 CAPA-тикетов одной операцией. Менеджеру
 * накопилось 20 старых тикетов которые уже разрешены — раньше надо
 * было каждый кликом проводить через 4 шага workflow. Теперь — 1 тап.
 *
 * Auth: management.
 */
const Schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

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

  const now = new Date();
  const result = await db.capaTicket.updateMany({
    where: {
      id: { in: body.ids },
      organizationId: orgId,
      status: { not: "closed" },
    },
    data: {
      status: "closed",
      closedAt: now,
      verificationResult: body.note ?? "Закрыто массово через bulk-close",
    },
  });

  await db.auditLog.create({
    data: {
      organizationId: orgId,
      userId: auth.session.user.id,
      userName: auth.session.user.name ?? null,
      action: "capa.bulk_close",
      entity: "capa_ticket",
      details: {
        requestedIds: body.ids,
        closed: result.count,
        note: body.note ?? null,
      },
    },
  });

  return NextResponse.json({ ok: true, closed: result.count });
}
