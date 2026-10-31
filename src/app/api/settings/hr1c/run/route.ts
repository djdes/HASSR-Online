import { NextResponse } from "next/server";

import { HrSyncError, runHrConnection } from "@/lib/hr1c/sync.server";
import { guardSupply } from "@/lib/supply/guard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/settings/hr1c/run { mode: "preview" | "apply" } — забрать
 * сотрудников из 1С (OData) и показать, что изменится, или применить.
 */
export async function POST(request: Request) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
  const mode = body.mode === "apply" ? "apply" : "preview";
  try {
    const result = await runHrConnection(organizationId, mode, { actor: { id: session.user.id, name: session.user.name ?? null } });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HrSyncError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
