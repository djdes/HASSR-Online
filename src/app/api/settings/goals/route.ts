import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O1 — Gamification goals. MVP без отдельной schema-модели —
 * храним в AuditLog с `action="goal.created"`. Активные goals
 * берём по `details.deadline > now() AND details.completedAt IS NULL`.
 *
 * Типы целей:
 *   - "compliance_streak" — N дней подряд compliance ≥ 80%
 *   - "entry_count" — N записей за период
 *   - "zero_capa" — N дней без открытия CAPA
 *
 * Менеджер видит «Достигни 100% compliance 7 дней подряд → +5000₽»
 * → мотивирует команду через journal-bonuses.
 *
 * GET /api/settings/goals → активные цели
 * POST /api/settings/goals → создать новую
 */

const PostSchema = z.object({
  type: z.enum(["compliance_streak", "entry_count", "zero_capa"]),
  target: z.number().int().positive(),
  rewardRub: z.number().int().nonnegative().optional(),
  deadline: z.string().datetime(),
  description: z.string().max(500).optional(),
});

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  const goals = await db.auditLog.findMany({
    where: {
      organizationId: orgId,
      action: "goal.created",
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const now = new Date();
  const active = goals.filter((g) => {
    const d = (g.details as Record<string, unknown>) ?? {};
    const deadline = d.deadline as string | undefined;
    const completedAt = d.completedAt as string | null | undefined;
    if (!deadline) return false;
    if (completedAt) return false;
    return new Date(deadline) > now;
  });

  return NextResponse.json({
    goals: active.map((g) => {
      const d = (g.details as Record<string, unknown>) ?? {};
      return {
        id: g.id,
        createdAt: g.createdAt.toISOString(),
        type: d.type,
        target: d.target,
        rewardRub: d.rewardRub ?? 0,
        deadline: d.deadline,
        description: d.description ?? null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await request.json());
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
  const goal = await db.auditLog.create({
    data: {
      organizationId: orgId,
      userId: auth.session.user.id,
      userName: auth.session.user.name ?? null,
      action: "goal.created",
      entity: "goal",
      details: {
        type: body.type,
        target: body.target,
        rewardRub: body.rewardRub ?? 0,
        deadline: body.deadline,
        description: body.description ?? null,
        completedAt: null,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    id: goal.id,
    createdAt: goal.createdAt.toISOString(),
  });
}
