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
 * POST /api/integrations/tasksflow/reset-negative-balances
 *
 * Hot-fix proxy: вызывает на TasksFlow POST /api/admin/reset-negative-balances
 * для текущей организации. Обнуляет отрицательные bonus_balance у workers,
 * накопленные из-за bug'а до commit'а ef3e8ec.
 *
 * Auth: management-роль в Wesetup.
 * Multi-tenant safety: TF само scop'ит по companyId из API key.
 */
export async function POST() {
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
    return NextResponse.json(
      { error: "TasksFlow integration не настроена" },
      { status: 400 },
    );
  }

  const client = tasksflowClientFor(integration);

  try {
    const result = await client.resetNegativeBalances();
    return NextResponse.json({
      ok: true,
      reset: result.reset,
      users: result.users,
      message:
        result.reset === 0
          ? "Отрицательных балансов нет — всё хорошо"
          : `Обнулено балансов: ${result.reset}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `TasksFlow reset failed: ${msg}` },
      { status: 502 },
    );
  }
}
