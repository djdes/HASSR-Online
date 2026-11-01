import { NextResponse } from "next/server";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { isAckDocKey } from "@/lib/ppk/acknowledge";
import { ackStatsMany } from "@/lib/ppk/acknowledge.server";
import { visibleStaffWhere } from "@/lib/people-scope.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?docKeys=a,b — сколько сотрудников ознакомились с каждым документом
 * (текущая версия). Документы без аудитории или чужие — не попадают в ответ.
 */
export async function GET(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const raw = new URL(request.url).searchParams.get("docKeys") ?? "";
  const keys = [...new Set(raw.split(",").map((key) => key.trim()).filter(isAckDocKey))].slice(0, 200);
  const many = await ackStatsMany(auth.scope, keys, await visibleStaffWhere(auth.session));
  const stats: Record<string, { acknowledged: number; total: number }> = {};
  for (const [key, one] of Object.entries(many)) {
    stats[key] = { acknowledged: one.acknowledged.length, total: one.acknowledged.length + one.pending.length };
  }
  return NextResponse.json({ stats }, { headers: { "Cache-Control": "private, no-store" } });
}
