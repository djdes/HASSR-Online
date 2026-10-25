import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { clientIp } from "@/lib/client-ip";
import { validateTrialInput, type TrialSettings } from "@/lib/billing-period";
import {
  collectBillingOverview,
  readTrialSettings,
  writeTrialSettings,
} from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/root/billing-period — пробный период тарифов 2026-10 и переход на
 * оплату. ROOT-only (прокси отдаёт 404 остальным). Адрес прежний: им
 * пользуется карточка на /root/tariffs.
 *
 * GET — настройки + счётчики аккаунтов по состояниям.
 * PUT — `{ trialDays, launchedAt, graceDays, transitionEnabled }` целиком.
 */

function toJson(settings: TrialSettings) {
  return {
    trialDays: settings.trialDays,
    launchedAt: settings.launchedAt.toISOString(),
    graceDays: settings.graceDays,
    transitionEnabled: settings.transitionEnabled,
  };
}

export async function GET() {
  await requireRoot();
  const [settings, overview] = await Promise.all([readTrialSettings(), collectBillingOverview()]);
  return NextResponse.json({ settings: toJson(settings), overview });
}

export async function PUT(request: Request) {
  const session = await requireRoot();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const checked = validateTrialInput({
    trialDays: body?.trialDays,
    launchedAt: body?.launchedAt,
    graceDays: body?.graceDays,
    transitionEnabled: body?.transitionEnabled,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const saved = await writeTrialSettings(checked.value, {
    userId: session.user.id,
    userName: session.user.name ?? session.user.email ?? null,
    organizationId: session.user.organizationId,
    ipAddress: clientIp(request),
  });
  const overview = await collectBillingOverview();
  return NextResponse.json({ settings: toJson(saved), overview });
}
