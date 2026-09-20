import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildingTargets } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ensureDocumentsFor } from "@/lib/journal-auto-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk-create journal documents for selected templates.
 *
 *   POST /api/journal-documents/bulk-create
 *   Body: { codes: ["hygiene", "cold_equipment_control", …] }
 *
 * Creates a month-long active document for each templateCode that
 * doesn't already have one covering today. Idempotent — existing
 * active docs returned as-is with `created: false`.
 *
 * Auth: management session.
 */

const bodySchema = z.object({
  codes: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  const results = await ensureDocumentsFor(db, {
    organizationId,
    templateCodes: parsed.codes,
    // Точки: по документу на каждую точку организации.
    buildingIds: await buildingTargets(organizationId),
  });
  const created = results.filter((r) => r.created).length;
  const skipped = results.length - created;
  return NextResponse.json({ created, skipped, results });
}
