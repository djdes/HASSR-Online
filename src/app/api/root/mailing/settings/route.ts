import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { PLATFORM_ORG_ID } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";
import { validateMailingSettingsInput } from "@/lib/mailing/rate-limit";
import {
  emailSendStats,
  emailsSentThisHour,
  readMailingSettings,
  readWorkerHeartbeat,
  writeMailingSettings,
} from "@/lib/mailing/settings.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function snapshot() {
  const [settings, stats, hour, heartbeat] = await Promise.all([
    readMailingSettings(),
    emailSendStats(),
    emailsSentThisHour(),
    readWorkerHeartbeat(),
  ]);
  return { settings, sentToday: stats.today, sentLastMinute: stats.lastMinute, sentThisHour: hour, heartbeat };
}

/**
 * GET — лимиты и выключатель очереди, сколько писем ушло сегодня и в этом
 * часе, последний проход обработчика. PUT — изменить: поля, которых нет в
 * запросе, остаются как были.
 */
export async function GET() {
  await requireRoot();
  try {
    return NextResponse.json(await snapshot());
  } catch (error) {
    return mailingErrorResponse(error, "settings read");
  }
}

export async function PUT(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const before = await readMailingSettings();
    const verdict = validateMailingSettingsInput(body, before);
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });
    const settings = await writeMailingSettings(verdict.value);
    console.info(`[mailing] settings updated by ${session.user.email ?? session.user.id}`, { before, after: settings });
    await recordAuditLog({
      request,
      session,
      organizationId: PLATFORM_ORG_ID,
      action: before.enabled !== settings.enabled ? (settings.enabled ? "mailing.queue.enable" : "mailing.queue.disable") : "mailing.settings.update",
      entity: "platform_setting",
      entityId: "mailing.settings",
      details: { before, after: settings },
    });
    return NextResponse.json(await snapshot());
  } catch (error) {
    return mailingErrorResponse(error, "settings write");
  }
}
