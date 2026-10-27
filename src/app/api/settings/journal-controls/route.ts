import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { recordAuditLog } from "@/lib/audit-log";
import { getJournalControls, updateJournalControls } from "@/lib/journal-controls.server";
import { SENSOR_JOURNAL_CODES } from "@/lib/journal-controls";

export const dynamic = "force-dynamic";
const schema = z.object({
  /** Спецрежим: включён ли и какие части автоматики видны в журналах. */
  automation: z.object({
    enabled: z.boolean(),
    autoFill: z.boolean(),
    autoCreate: z.boolean(),
    copyYesterday: z.boolean(),
    closeDayAutofill: z.boolean(),
  }).strict().optional(),
  camera: z.object({ code: z.enum(SENSOR_JOURNAL_CODES), enabled: z.boolean() }).optional(),
  setup: z.object({ code: z.enum(["finished_product", "perishable_rejection"]), decision: z.literal("declined") }).optional(),
}).strict().refine((body) => Object.keys(body).length > 0);

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getJournalControls(getActiveOrgId(auth.session)), { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Проверьте настройки" }, { status: 400 });
  const organizationId = getActiveOrgId(auth.session);
  const before = await getJournalControls(organizationId);
  const { automation, camera, setup } = body.data;
  const controls = await updateJournalControls(organizationId, {
    ...(automation ? { automation } : {}),
    ...(camera ? { sensorCamera: { [camera.code]: camera.enabled } } : {}),
    ...(setup ? { brakerageSetup: { [setup.code]: setup.decision } } : {}),
  });
  await recordAuditLog({ request, session: auth.session, organizationId, action: "journal.controls_update", entity: "Organization", entityId: organizationId, details: { before, after: controls } });
  return NextResponse.json(controls);
}
