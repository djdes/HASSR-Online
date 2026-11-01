import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { mercurySettingsGuard } from "@/lib/mercury/settings-guard";
import { enqueueMercuryApplication } from "@/lib/mercury/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/mercury/enterprises/load — «Загрузить площадки из
 * Меркурия»: ставит в очередь заявку на список площадок хозяйствующего
 * субъекта. Ответ разберёт крон очереди (`runMercuryOutbox`): новые площадки
 * появятся без точки и выключенными — точку выбирает руководитель.
 */
export async function POST() {
  const g = await mercurySettingsGuard();
  if (g.error) return g.error;

  const integration = await db.mercuryIntegration.findUnique({
    where: { organizationId: g.organizationId },
    select: { id: true, issuerGuid: true },
  });
  if (!integration) {
    return NextResponse.json({ error: "Сначала сохраните реквизиты подключения к Меркурию" }, { status: 409 });
  }

  const queued = await db.mercuryOutbox.findFirst({
    where: { integrationId: integration.id, action: "getActivityLocationList", status: { in: ["pending", "submitted"] } },
    select: { id: true },
  });
  if (queued) return NextResponse.json({ ok: true, alreadyQueued: true });

  await enqueueMercuryApplication({
    integrationId: integration.id,
    organizationId: g.organizationId,
    action: "getActivityLocationList",
    payload: { enterpriseGuid: integration.issuerGuid },
  });
  return NextResponse.json({ ok: true, alreadyQueued: false });
}
