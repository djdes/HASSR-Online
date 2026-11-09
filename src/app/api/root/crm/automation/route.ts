import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, readJson } from "@/lib/crm/api.server";
import { lifecycleSettingsSchema } from "@/lib/crm/lifecycle/settings";
import { readLifecycleSettings, writeLifecycleSettings } from "@/lib/crm/lifecycle/settings.server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/root/crm/automation — настройки автоворонки. */
export async function GET() {
  await requireRoot();
  return NextResponse.json({ settings: await readLifecycleSettings() });
}

/** PUT /api/root/crm/automation — сохранить настройки (охват «все»). */
export async function PUT(request: Request) {
  const session = await requireRoot();
  const parsed = lifecycleSettingsSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  if (parsed.data.defaultAssigneeId) {
    const user = await db.user.findFirst({ where: { id: parsed.data.defaultAssigneeId, isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { has: "crm" } }] }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "Ответственный по умолчанию — сотрудник с разделом «CRM»" }, { status: 400 });
  }
  const before = await readLifecycleSettings();
  const saved = await writeLifecycleSettings(parsed.data);
  await db.auditLog
    .create({ data: { organizationId: session.user.organizationId, userId: session.user.id, userName: session.user.name ?? null, action: "crm.automation.update", entity: "crm", entityId: "lifecycle", details: { before, after: saved } as object } })
    .catch(() => undefined);
  return NextResponse.json({ settings: saved });
}
