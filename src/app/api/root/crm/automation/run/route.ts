import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { runLifecycle } from "@/lib/crm/lifecycle/run.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/root/crm/automation/run — прогнать автоворонку сейчас (без паузы 15 минут). */
export async function POST() {
  await requireRoot();
  const result = await runLifecycle({ force: true });
  return NextResponse.json({ ok: result.ok, skipped: result.skipped ?? null, scanned: result.scanned, deals: result.deals, messages: result.messages, tasks: result.tasks, errors: result.errors, log: result.log.slice(0, 50) });
}
