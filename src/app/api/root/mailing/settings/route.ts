import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { PLATFORM_ORG_ID } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";
import { validateMailingSettingsInput } from "@/lib/mailing/rate-limit";
import { emailSendStats, readMailingSettings, writeMailingSettings } from "@/lib/mailing/settings.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — скорость отправки и сколько писем ушло сегодня; PUT — изменить скорость. */
export async function GET() {
  await requireRoot();
  try {
    const [settings, stats] = await Promise.all([readMailingSettings(), emailSendStats()]);
    return NextResponse.json({ settings, sentToday: stats.today, sentLastMinute: stats.lastMinute });
  } catch (error) {
    return mailingErrorResponse(error, "settings read");
  }
}

export async function PUT(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const verdict = validateMailingSettingsInput({ perMinute: body.perMinute, perDay: body.perDay });
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });
    const before = await readMailingSettings();
    const settings = await writeMailingSettings(verdict.value);
    console.info(`[mailing] settings updated by ${session.user.email ?? session.user.id}`, { before, after: settings });
    await recordAuditLog({
      request,
      session,
      organizationId: PLATFORM_ORG_ID,
      action: "mailing.settings.update",
      entity: "platform_setting",
      entityId: "mailing.settings",
      details: { before, after: settings },
    });
    const stats = await emailSendStats();
    return NextResponse.json({ settings, sentToday: stats.today, sentLastMinute: stats.lastMinute });
  } catch (error) {
    return mailingErrorResponse(error, "settings write");
  }
}
