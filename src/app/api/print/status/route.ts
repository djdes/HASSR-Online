import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { isAgentOnline } from "@/lib/print-agent-auth";
import { getViewedPointId } from "@/lib/active-building";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Сколько последних заданий показываем в истории печати. */
const HISTORY_LIMIT = 15;

/**
 * GET /api/print/status — состояние принтера и история печати для блока
 * «Онлайн принтер» на дашборде.
 */
export async function GET() {
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  // Точка в шапке (2026-11-01): её принтеры и задания плюс общие; «Вся
  // организация» — всё. Руководитель точки всегда смотрит свою точку.
  const viewedPointId = await getViewedPointId(session);
  const pointWhere = viewedPointId ? { OR: [{ buildingId: viewedPointId }, { buildingId: null }] } : {};

  const [agents, jobs] = await Promise.all([
    db.printAgent.findMany({
      where: { organizationId, revokedAt: null, ...pointWhere },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        name: true,
        printerName: true,
        lastSeenAt: true,
        agentVersion: true,
        building: { select: { name: true } },
      },
    }),
    db.printJob.findMany({
      where: { organizationId, ...pointWhere },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        docTitle: true,
        status: true,
        errorMsg: true,
        createdAt: true,
        printedAt: true,
        createdByName: true,
      },
    }),
  ]);

  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      printerName: a.printerName,
      agentVersion: a.agentVersion,
      buildingName: a.building?.name ?? null,
      lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
      online: isAgentOnline(a.lastSeenAt),
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      docTitle: j.docTitle,
      status: j.status,
      errorMsg: j.errorMsg,
      createdAt: j.createdAt.toISOString(),
      printedAt: j.printedAt?.toISOString() ?? null,
      createdByName: j.createdByName,
    })),
  });
}
