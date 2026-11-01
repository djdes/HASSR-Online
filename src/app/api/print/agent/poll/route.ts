import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateAgent, touchAgent } from "@/lib/print-agent-auth";
import { loadPointsWithOwnAgent } from "@/lib/print-agent-point.server";
import { printJobQueueWhere } from "@/lib/print-point-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/print/agent/poll — программа спрашивает, есть ли что печатать.
 *
 * Опрос, а не push: агент стоит за NAT в заведении, достучаться до него
 * снаружи нельзя. Пять секунд задержки для «распечатать журнал при
 * проверке» незаметны.
 */

/** Сколько ждём агента, прежде чем считать задание зависшим. */
const STUCK_AFTER_MS = 10 * 60 * 1000;

/** Сколько раз пробуем отдать задание, прежде чем признать ошибку. */
const MAX_ATTEMPTS = 3;

export async function GET(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  }

  const now = new Date();

  // Самолечение: агент мог умереть посреди печати (выключили машину,
  // упала служба). Без возврата в очередь задание висело бы вечно —
  // тот же приём есть у Magday.
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  await db.printJob.updateMany({
    where: {
      organizationId: agent.organizationId,
      status: "printing",
      claimedAt: { lt: stuckBefore },
      attempts: { lt: MAX_ATTEMPTS },
    },
    data: { status: "pending", agentId: null },
  });
  // Исчерпавшие попытки не возвращаем в очередь: иначе сломанный принтер
  // будет вечно крутить одно задание и прятать за собой все остальные.
  await db.printJob.updateMany({
    where: {
      organizationId: agent.organizationId,
      status: "printing",
      claimedAt: { lt: stuckBefore },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      status: "error",
      errorMsg: "Принтер не ответил за три попытки",
    },
  });

  // Принтер своей точки (2026-11-01): агент точки — задания своей точки и
  // общие; общий агент — ещё и задания точек без своего принтера.
  const pointsWithAgent = agent.buildingId ? [] : await loadPointsWithOwnAgent(agent.organizationId);
  const next = await db.printJob.findFirst({
    where: {
      organizationId: agent.organizationId,
      status: "pending",
      ...printJobQueueWhere(agent, pointsWithAgent),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, docTitle: true },
  });

  await touchAgent(agent.id, null);

  if (!next) return NextResponse.json({ job: null });

  // Захват через updateMany с проверкой статуса: в организации может
  // стоять два агента, и оба спросят очередь в одну секунду. Проиграв
  // гонку, просто ждём следующего опроса.
  const claimed = await db.printJob.updateMany({
    where: { id: next.id, status: "pending" },
    data: {
      status: "printing",
      agentId: agent.id,
      claimedAt: now,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 0) return NextResponse.json({ job: null });

  return NextResponse.json({
    job: {
      id: next.id,
      docTitle: next.docTitle,
      pdfUrl: `/api/print/jobs/${next.id}/pdf`,
    },
  });
}
