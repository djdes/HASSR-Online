import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { matchJobPositions } from "@/lib/job-position-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/positions/match
 *
 * Body: { names: string[] }
 *
 * Принимает список имён должностей из импорта (Excel/iiko/CSV) и
 * возвращает для каждого: распознанная JobPosition + confidence.
 *
 * Используется в:
 *   - Bulk-staff-import (auto-fill column mapping)
 *   - Onboarding wizard (preview перед apply)
 *
 * Не пишет в БД — read-only matching. Caller сам решает что делать
 * с результатами (auto-apply при confidence ≥ 0.7, ручной выбор для
 * остальных).
 */
const bodySchema = z.object({
  names: z.array(z.string().min(1).max(120)).min(1).max(500),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad body" },
        { status: 400 }
      );
    }
    throw err;
  }

  const orgId = getActiveOrgId(session);
  const positions = await db.jobPosition.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const matches = matchJobPositions(parsed.names, positions);

  // Считаем сводку — для UI «вот столько мы автоматически распознали».
  const autoApplyThreshold = 0.7;
  const autoCount = matches.filter(
    (m) => m.confidence >= autoApplyThreshold
  ).length;
  const manualCount = matches.length - autoCount;

  return NextResponse.json({
    matches,
    summary: {
      total: matches.length,
      autoApplied: autoCount,
      needManual: manualCount,
      autoPercentage: Math.round((autoCount / matches.length) * 100),
    },
  });
}
