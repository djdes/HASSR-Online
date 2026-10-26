import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasPlanFeature } from "@/lib/billing.server";
import { countPendingVetDocuments } from "@/lib/mercury/sync";
import { resolveTransportMode } from "@/lib/mercury/transport";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mercury — состояние интеграции с ФГИС «Меркурий».
 *
 * Раньше здесь была заглушка, которая просила у пользователя `apiKey` и
 * тем самым задавала неверную модель. На деле APIKey выдаётся ОДИН на
 * информационную систему (то есть на весь WeSetup) и живёт в env; у
 * организации свои — ГУИД хозяйствующего субъекта и логин
 * уполномоченного лица. Ключ в этот ответ не попадает никогда.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const organizationId = getActiveOrgId(session);
  const [org, integration] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    }),
    db.mercuryIntegration.findUnique({
      where: { organizationId },
      select: {
        environment: true,
        issuerGuid: true,
        initiatorLogin: true,
        enabled: true,
        autoProcessMode: true,
        lastSyncAt: true,
        lastSyncError: true,
        apiKeyPrefix: true,
        _count: { select: { enterprises: true, documents: true } },
      },
    }),
  ]);

  const mode = resolveTransportMode({});
  const counts = integration
    ? await countPendingVetDocuments(organizationId, org?.timezone)
    : { pending: 0, overdue: 0, todayKey: "" };

  return NextResponse.json({
    available: await hasPlanFeature(organizationId, "mercury"),
    configured: Boolean(integration),
    enabled: integration?.enabled ?? false,
    // Демо-режим показывается в интерфейсе крупной плашкой: принять
    // выдуманные ВСД за настоящие — худшее, что тут может случиться.
    mode,
    environment: integration?.environment ?? "test",
    issuerGuid: integration?.issuerGuid ?? null,
    initiatorLogin: integration?.initiatorLogin ?? null,
    autoProcessMode: integration?.autoProcessMode ?? "assisted",
    enterprises: integration?._count.enterprises ?? 0,
    documents: integration?._count.documents ?? 0,
    pending: counts.pending,
    overdue: counts.overdue,
    lastSyncAt: integration?.lastSyncAt ?? null,
    lastSyncError: integration?.lastSyncError ?? null,
  });
}
