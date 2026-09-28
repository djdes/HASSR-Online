import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { clientIp } from "@/lib/client-ip";
import { validateFreePeriodInput } from "@/lib/billing-period";
import {
  collectBillingOverview,
  readFreePeriodSettings,
  writeFreePeriodSettings,
} from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/root/billing-period — бесплатный период «подписка для всех» и
 * переход на оплату. ROOT-only (прокси отдаёт 404 остальным).
 *
 * GET — настройки + счётчики аккаунтов по состояниям.
 * PUT — `{ startsAt, endsAt, graceDays, transitionEnabled }` целиком.
 */

function toJson(settings: Awaited<ReturnType<typeof readFreePeriodSettings>>) {
  return {
    startsAt: settings.startsAt.toISOString(),
    endsAt: settings.endsAt.toISOString(),
    graceDays: settings.graceDays,
    transitionEnabled: settings.transitionEnabled,
  };
}

export async function GET() {
  await requireRoot();
  const [settings, overview] = await Promise.all([
    readFreePeriodSettings(),
    collectBillingOverview(),
  ]);
  return NextResponse.json({ settings: toJson(settings), overview });
}

export async function PUT(request: Request) {
  const session = await requireRoot();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const checked = validateFreePeriodInput({
    startsAt: body?.startsAt,
    endsAt: body?.endsAt,
    graceDays: body?.graceDays,
    transitionEnabled: body?.transitionEnabled,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const saved = await writeFreePeriodSettings(checked.value, {
    userId: session.user.id,
    userName: session.user.name ?? session.user.email ?? null,
    organizationId: session.user.organizationId,
    ipAddress: clientIp(request),
  });
  const overview = await collectBillingOverview();
  return NextResponse.json({ settings: toJson(saved), overview });
}
