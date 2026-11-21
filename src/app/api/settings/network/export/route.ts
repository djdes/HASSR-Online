import { NextResponse } from "next/server";

import { resolveExportLocale } from "@/i18n/export-locale";
import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { parseNetworkExportFormat } from "@/lib/network-export";
import { networkExportFile } from "@/lib/network-export.server";
import { networkPeriodDays, parseNetworkPeriod } from "@/lib/network-period";
import { loadNetworkPeriod } from "@/lib/network-period.server";
import { NetworkSummaryAccessError, loadNetworkSummary } from "@/lib/network-summary.server";
import { isPointScoped } from "@/lib/point-scope";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

/**
 * GET /api/settings/network/export?period=today|7|30&format=xlsx|pdf —
 * таблица страницы «Сеть» файлом (серия E, Р6), имя `set-2026-11-21.xlsx` /
 * `set-7d-2026-11-21.pdf`. Доступ — как у страницы: полный доступ, не
 * «войти как», не руководитель точки, владелец аккаунта активной
 * организации или управляющий сетью (`loadNetworkSummary`), в аккаунте две
 * организации и больше; иначе 403.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user) || isImpersonating(session) || isPointScoped(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const period = parseNetworkPeriod(searchParams.get("period"));
  const format = parseNetworkExportFormat(searchParams.get("format"));
  if (!format) return NextResponse.json({ error: "Формат: xlsx или pdf" }, { status: 400 });
  if (!limiter.consume(`network-export:${session.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }

  const days = networkPeriodDays(period);
  const now = new Date();
  const today = await loadNetworkSummary({
    ownerUserId: session.user.id,
    activeOrgId: getActiveOrgId(session),
    now,
    journals: days === null,
  }).catch((error: unknown) => {
    if (error instanceof NetworkSummaryAccessError) return null;
    throw error;
  });
  if (!today) return NextResponse.json({ error: "Сводка по сети недоступна" }, { status: 403 });
  const periodSummary =
    days === null ? null : await loadNetworkPeriod(today.accountId, days, { now, activeOrgId: today.activeOrganizationId });

  const file = await networkExportFile({
    format,
    period,
    locale: resolveExportLocale(null, session.user) ?? "ru",
    now,
    today,
    periodSummary,
  });
  return new NextResponse(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
