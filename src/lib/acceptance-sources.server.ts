import {
  mercuryPendingWhere,
  type AcceptanceSources,
  type MercuryPendingWhere,
} from "@/lib/acceptance-sources";
import { hasPlanFeature } from "@/lib/billing.server";
import { db } from "@/lib/db";

/** Источники данных — отдельно, чтобы правило проверялось тестом без базы. */
export type AcceptanceSourcesDeps = {
  planHasMercury(organizationId: string): Promise<boolean>;
  mercuryIntegration(organizationId: string): Promise<{ enabled: boolean } | null>;
  iikoConnection(organizationId: string): Promise<{ id: string } | null>;
  countVetDocuments(where: MercuryPendingWhere & { processingDueAt?: { lt: Date } }): Promise<number>;
};

const dbDeps: AcceptanceSourcesDeps = {
  // «Меркурий» — возможность «Премиума» (и пробного, прежней «Подписки», демо).
  planHasMercury: (organizationId) => hasPlanFeature(organizationId, "mercury").catch(() => false),
  mercuryIntegration: (organizationId) =>
    db.mercuryIntegration.findUnique({ where: { organizationId }, select: { enabled: true } }),
  iikoConnection: (organizationId) =>
    db.supplyConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: "iiko" } },
      select: { id: true },
    }),
  countVetDocuments: (where) => db.mercuryVetDocument.count({ where }),
};

/**
 * Подсказки журнала приёмки. Оформлять ВСД и принимать накладные из
 * «Входящих» может только руководство (API отвечает 403 остальным), поэтому
 * без `canManage` — `null` и ни одного запроса.
 */
export async function loadAcceptanceSources(
  params: { organizationId: string; buildingId: string | null; canManage: boolean; now?: Date },
  deps: AcceptanceSourcesDeps = dbDeps,
): Promise<AcceptanceSources | null> {
  if (!params.canManage) return null;
  const { organizationId, buildingId } = params;
  const [available, integration, iiko] = await Promise.all([
    deps.planHasMercury(organizationId),
    deps.mercuryIntegration(organizationId),
    deps.iikoConnection(organizationId),
  ]);
  let mercury: AcceptanceSources["mercury"] = null;
  if (available && integration?.enabled) {
    const where = mercuryPendingWhere(organizationId, buildingId);
    const [pending, overdue] = await Promise.all([
      deps.countVetDocuments(where),
      deps.countVetDocuments({ ...where, processingDueAt: { lt: params.now ?? new Date() } }),
    ]);
    mercury = { pending, overdue };
  }
  return { mercury, iikoConnected: Boolean(iiko) };
}
