import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { tasksflowClientFor } from "@/lib/tasksflow-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/tasksflow/audit?since=<unix>&taskIds=<csv>
 *
 * Phase 2.10 спека 2026-05-09 (П-17): прокси к TasksFlow GET /api/audit.
 * Возвращает audit-events задач организации.
 *
 * Auth: management-роль в Wesetup. Multi-tenant filter (П-18) обеспечивает
 * сам TF — он скоупит ответ по companyId из API key. Caller не может
 * передать другую company.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId, enabled: true },
  });
  if (!integration) {
    return NextResponse.json({ events: [], count: 0, integration: null });
  }

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) || undefined : undefined;
  const taskIdsParam = url.searchParams.get("taskIds");
  const taskIds = taskIdsParam
    ? taskIdsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    : undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) || undefined : undefined;

  const client = tasksflowClientFor(integration);

  try {
    const result = await client.getAudit({ since, taskIds, limit });
    return NextResponse.json({
      events: result.events,
      count: result.count,
      integration: { id: integration.id },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `TasksFlow audit fetch failed: ${msg}` },
      { status: 502 },
    );
  }
}
