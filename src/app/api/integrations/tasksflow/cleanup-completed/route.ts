import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import {
  TasksFlowError,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/tasksflow/cleanup-completed
 *
 * Симметричный к cleanup-pending — но удаляет ВЫПОЛНЕННЫЕ задачи в TF
 * (isCompleted=true), которые накопились со временем. Используется
 * когда uborschica закрыла дофига задач, в TF лента раздулась,
 * админу хочется почистить «архив».
 *
 * SAFETY: фильтруем по `tasksflowCompanyId` интеграции — никогда не
 * трогаем задачи чужих компаний. JournalDocumentEntry и AuditLog
 * остаются, не трогаем — это история compliance.
 *
 * Алгоритм:
 *   1. listTasks() в TF
 *   2. filter: isCompleted=true + companyId совпадает
 *   3. deleteTask на каждой + удаляем локальный TasksFlowTaskLink
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
      { error: "Интеграция с TasksFlow не настроена" },
      { status: 400 },
    );
  }

  const client = tasksflowClientFor(integration);

  let allTasks;
  try {
    allTasks = await client.listTasks();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `TasksFlow listTasks failed: ${msg}` },
      { status: 502 },
    );
  }

  const targetCompanyId = integration.tasksflowCompanyId ?? null;
  if (targetCompanyId === null) {
    return NextResponse.json(
      {
        error:
          "Интеграция не привязана к конкретной компании в TasksFlow " +
          "(tasksflowCompanyId=null). Удалить безопасно невозможно. " +
          "Выполните sync-users в настройках интеграции.",
      },
      { status: 400 },
    );
  }

  const completed = allTasks.filter((t) => {
    if (!t.isCompleted) return false;
    if (t.companyId == null) return false;
    if (t.companyId !== targetCompanyId) return false;
    return true;
  });

  if (completed.length === 0) {
    return NextResponse.json({
      ok: true,
      deletedTfTasks: 0,
      removedLocalLinks: 0,
      totalScanned: allTasks.length,
      message: "Нет выполненных задач — TF архив пуст",
    });
  }

  const taskIds = completed.map((t) => t.id);
  const localLinks = await db.tasksFlowTaskLink.findMany({
    where: {
      integrationId: integration.id,
      tasksflowTaskId: { in: taskIds },
    },
    select: { id: true, tasksflowTaskId: true },
  });
  const localByTfId = new Map(
    localLinks.map((l) => [l.tasksflowTaskId, l.id]),
  );

  let deletedTfTasks = 0;
  let alreadyGone = 0;
  let removedLocalLinks = 0;
  const errors: string[] = [];

  for (const t of completed) {
    let deletedRemotely = false;
    try {
      await client.deleteTask(t.id);
      deletedTfTasks += 1;
      deletedRemotely = true;
    } catch (err) {
      if (
        err instanceof TasksFlowError &&
        (err.status === 404 || err.status === 410)
      ) {
        alreadyGone += 1;
        deletedRemotely = true;
      } else {
        errors.push(
          `task ${t.id}: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }
    if (deletedRemotely) {
      const localId = localByTfId.get(t.id);
      if (localId) {
        await db.tasksFlowTaskLink
          .delete({ where: { id: localId } })
          .catch(() => null);
        removedLocalLinks += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    deletedTfTasks,
    alreadyGone,
    removedLocalLinks,
    totalScanned: allTasks.length,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    message: `Удалено выполненных задач: ${deletedTfTasks} (плюс ${alreadyGone} уже отсутствовали в TF)`,
  });
}
