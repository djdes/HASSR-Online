import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { readJson } from "@/lib/crm/api.server";
import { CrmTaskError, writeLifecycleSettings } from "@/lib/crm/tasks.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/root/crm/tasks/settings — сценарий «пробный и оплата»: кому задачи, кто согласует, скидки. */
export async function PUT(request: Request) {
  await requireRoot();
  try {
    const settings = await writeLifecycleSettings(await readJson(request));
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    if (error instanceof CrmTaskError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[crm-tasks] settings failed", error);
    return NextResponse.json({ error: "Не получилось сохранить — попробуйте ещё раз" }, { status: 500 });
  }
}
