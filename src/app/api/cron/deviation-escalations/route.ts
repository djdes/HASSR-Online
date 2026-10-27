import { NextResponse } from "next/server";
import { checkCronSecret } from "@/lib/cron-auth";
import { escalateOpenIncidents } from "@/lib/temperature-deviations";
import { expirePointAssignments } from "@/lib/point-assignments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/deviation-escalations?secret=$CRON_SECRET
 *
 * Каждые 5 минут проходит по открытым инцидентам отклонения температуры
 * и, если ответственный не исправил за отведённое организацией время,
 * сообщает руководству — ровно один раз на инцидент.
 *
 * Почему кроном, а не только на новом показании: показания могут
 * перестать приходить вовсе (датчик отвалился, повар не заполняет
 * журнал). Именно этот случай и есть «не исправляется».
 *
 * Порог и сам факт эскалации — per-org: `deviationEscalationMinutes`
 * и `escalateDeviationsToManagement`, настраиваются в
 * /settings/compliance.
 *
 * Заодно — автовозврат с временной точки (замена, `expirePointAssignments`):
 * этот крон точно стоит в crontab прода и ходит часто, так что сотрудник
 * возвращается на свою точку в пределах 5 минут после конца срока. Ошибка
 * возврата не мешает эскалациям и наоборот.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  const pointAssignments = await expirePointAssignments().catch((error) => {
    console.error("[cron/deviation-escalations] point assignments", error);
    return { expired: 0, error: error instanceof Error ? error.message : String(error) };
  });
  const result = await escalateOpenIncidents();
  return NextResponse.json({ ok: true, ...result, pointAssignments });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
