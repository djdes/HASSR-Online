import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CODES: Set<string> = new Set(
  ACTIVE_JOURNAL_CATALOG.map((j) => j.code as string),
);

/**
 * PUT /api/settings/journal-difficulty
 * Body: { difficulty: { [journalCode]: 1..5 } }
 *
 * Перезаписывает Organization.journalDifficultyJson целиком. Принимает
 * только known journal codes — чужие коды игнорирует. Принимает
 * только числа 1..5 — остальное игнорирует. Это позволяет менеджеру
 * откатить значение к дефолту просто отправив пустой объект.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);
  const body = await request.json().catch(() => null);
  const raw = (body as { difficulty?: unknown } | null)?.difficulty;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json(
      { error: "Body должен содержать поле difficulty: object" },
      { status: 400 },
    );
  }

  const cleaned: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_CODES.has(code)) continue;
    if (typeof value !== "number") continue;
    const rounded = Math.round(value);
    if (rounded < 1 || rounded > 5) continue;
    cleaned[code] = rounded;
  }

  await db.organization.update({
    where: { id: organizationId },
    data: { journalDifficultyJson: cleaned as never },
  });

  return NextResponse.json({ ok: true, difficulty: cleaned });
}
