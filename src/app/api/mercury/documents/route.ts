import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { checkPlanFeature, limitResponse } from "@/lib/billing.server";
import { buildingWhere } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { describeDeadline } from "@/lib/mercury/deadline";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABS = {
  pending: ["new", "acknowledged"],
  processed: ["processed"],
  failed: ["process_failed", "processing"],
} as const;

/**
 * GET /api/mercury/documents?tab=pending|processed|failed|all&overdue=1
 *
 * Список входящих ВСД текущей организации и точки. Только чтение —
 * гашение идёт отдельным роутом и всегда через очередь.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const organizationId = getActiveOrgId(session);
  // «Меркурий» — возможность «Премиума»: без неё документы не отдаём.
  const feature = await checkPlanFeature(organizationId, "mercury", "mercury.documents");
  if (!feature.ok) return limitResponse(feature);
  const buildingId = await getActiveBuildingId(session);
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get("tab") ?? "pending";
  const onlyOverdue = searchParams.get("overdue") === "1";
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 200);

  const statuses = tab in TABS ? TABS[tab as keyof typeof TABS] : undefined;

  const rows = await db.mercuryVetDocument.findMany({
    where: {
      organizationId,
      ...buildingWhere(buildingId),
      ...(statuses ? { localStatus: { in: [...statuses] } } : {}),
      ...(onlyOverdue ? { processingDueAt: { lt: new Date() } } : {}),
      // Исходящие и чужие документы менеджеру не показываем.
      NOT: { localStatus: "irrelevant" },
    },
    orderBy: [{ processingDueAt: "asc" }, { firstSeenAt: "desc" }],
    take: limit,
    select: {
      id: true,
      uuid: true,
      number: true,
      remoteStatus: true,
      localStatus: true,
      issueDate: true,
      deliveryDate: true,
      processingDueAt: true,
      productName: true,
      volume: true,
      unit: true,
      batchNumber: true,
      expiryDate: true,
      consignorName: true,
      consignorInn: true,
      manufacturerName: true,
      accompanyingDocs: true,
      transportInfo: true,
      processError: true,
      journalDocumentId: true,
      batchKey: true,
    },
  });

  const now = new Date();
  return NextResponse.json({
    documents: rows.map((row) => ({
      ...row,
      deadline: describeDeadline(row.processingDueAt, now),
    })),
  });
}
