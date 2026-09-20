import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/tasksflow/health
 *
 * Realtime ping TasksFlow `/api/health` (см. P1#5). Возвращает
 * «зелёный/жёлтый/красный» для UI карточки на странице
 * /settings/integrations/tasksflow.
 *
 * Палитра:
 *   • green  — TasksFlow ответил 200 + `ok: true` + dbLatencyMs < 200
 *   • yellow — ответил 200 + `ok: true` но dbLatencyMs >= 200, либо
 *              есть несоответствие версий клиента/сервера
 *   • red    — таймаут (>5s), 5xx, `ok: false`, или интеграция выключена
 *
 * Не кэшируем: ответ меняется минута за минуту, и UI рисует индикатор
 * по запросу с экрана settings.
 */
const FETCH_TIMEOUT_MS = 5_000;
const GREEN_LATENCY_MS = 200;

type HealthState = "green" | "yellow" | "red";

type TasksFlowHealthResponse = {
  ok?: boolean;
  db?: string;
  dbLatencyMs?: number;
  buildSha?: string;
  uptimeSec?: number;
  now?: string;
  dbError?: string;
};

export async function GET() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);
  const integration = await db.tasksFlowIntegration.findUnique({
    where: { organizationId: orgId },
    select: { id: true, baseUrl: true, enabled: true },
  });
  if (!integration) {
    return NextResponse.json({
      status: "red" as HealthState,
      reason: "no_integration",
      message: "Интеграция с TasksFlow не настроена.",
    });
  }
  if (!integration.enabled) {
    return NextResponse.json({
      status: "red" as HealthState,
      reason: "disabled",
      message: "Интеграция выключена.",
    });
  }

  // TasksFlow exposes both /api/health и /health — ходим в /api/health,
  // потому что он стабильно существовал ещё до redesign'а P1#5.
  const url = stripTrailingSlash(integration.baseUrl) + "/api/health";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    let body: TasksFlowHealthResponse | null = null;
    try {
      body = (await response.json()) as TasksFlowHealthResponse;
    } catch {
      body = null;
    }

    if (!response.ok) {
      return NextResponse.json({
        status: "red" as HealthState,
        reason: "http_error",
        httpStatus: response.status,
        latencyMs,
        message: `TasksFlow вернул HTTP ${response.status}`,
        remote: body,
      });
    }

    const remoteOk = body?.ok === true;
    if (!remoteOk) {
      return NextResponse.json({
        status: "red" as HealthState,
        reason: "remote_unhealthy",
        httpStatus: response.status,
        latencyMs,
        message: body?.dbError
          ? `TasksFlow: ${body.dbError}`
          : "TasksFlow сообщил о неработающей БД.",
        remote: body,
      });
    }

    const dbLatency = typeof body?.dbLatencyMs === "number" ? body.dbLatencyMs : 0;
    const yellowReason: string | null =
      dbLatency >= GREEN_LATENCY_MS
        ? `TasksFlow БД отвечает медленно (${dbLatency} мс)`
        : null;
    const status: HealthState = yellowReason ? "yellow" : "green";

    return NextResponse.json({
      status,
      reason: yellowReason ? "slow_db" : "ok",
      httpStatus: response.status,
      latencyMs,
      message:
        yellowReason ?? `TasksFlow здоров (${latencyMs} мс).`,
      remote: body,
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json({
      status: "red" as HealthState,
      reason: aborted ? "timeout" : "network_error",
      latencyMs,
      message: aborted
        ? `TasksFlow не ответил за ${FETCH_TIMEOUT_MS} мс.`
        : `Сетевая ошибка: ${err instanceof Error ? err.message : "неизвестно"}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
