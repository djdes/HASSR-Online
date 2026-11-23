import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { validateAiDigestConfig } from "@/lib/mailing/ai-digest/config";
import { readAiDigestConfig, writeAiDigestConfig } from "@/lib/mailing/ai-digest/run.server";
import { PLATFORM_ORG_ID } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

import { aiDigestState } from "@/lib/mailing/ai-digest/state.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ИИ-сводка администратору (ROOT → «Рассылка» → «ИИ-сводка»).
 * GET — настройки, получатели (пользователи root), история запусков;
 * PUT { config } — сохранить расписание, каналы и шаблон.
 */
export async function GET() {
  await requireRoot();
  try {
    return NextResponse.json(await aiDigestState());
  } catch (error) {
    return mailingErrorResponse(error, "ai-digest read");
  }
}

export async function PUT(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const verdict = validateAiDigestConfig(body.config);
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });
    const before = await readAiDigestConfig();
    const config = await writeAiDigestConfig(verdict.config);
    await recordAuditLog({
      request,
      session,
      organizationId: PLATFORM_ORG_ID,
      action: "mailing.ai_digest.update",
      entity: "platform_setting",
      entityId: "mailing.aiDigest.config",
      details: { before, after: config },
    });
    return NextResponse.json(await aiDigestState(config));
  } catch (error) {
    return mailingErrorResponse(error, "ai-digest write");
  }
}
