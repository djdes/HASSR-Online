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
 * POST /api/integrations/tasksflow/cleanup-pending
 *
 * Удаляет в TasksFlow ВСЕ незавершённые задачи компании этой
 * интеграции — не только те что записаны в TasksFlowTaskLink.
 *
 * Алгоритм:
 *   1. listTasks() в TF — получаем все задачи которые видит наш
 *      API-ключ (TF их же фильтрует по companyId ключа).
 *   2. Фильтруем по `!isCompleted` — выполненные оставляем для
 *      compliance-истории.
 *   3. Если у интеграции задан tasksflowCompanyId — дополнительно
 *      сужаем до своей компании (на случай ключей с расширенным
 *      доступом).
 *   4. DELETE каждую → удаляем локальный TasksFlowTaskLink если был.
 *
 * Раньше чистили ТОЛЬКО по locale TasksFlowTaskLink, поэтому при 108
 * задач в TF удалялось ~20 (только те что bulk-assign успел записать
 * в local link). Остальные «осиротелые» задачи (созданные в TF
 * вручную, импортированные, или потерявшие локальный link при
 * прошлых force-wipe) — оставались висеть.
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
      { status: 400 }
    );
  }

  const client = tasksflowClientFor(integration);

  // 1. Достаём все задачи которые видит ключ.
  let allTasks;
  try {
    allTasks = await client.listTasks();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `TasksFlow listTasks failed: ${msg}` },
      { status: 502 }
    );
  }

  // 2. Фильтруем: только незавершённые + только нашей компании.
  // SAFETY: если у интеграции не задан tasksflowCompanyId — отказываем,
  // иначе при ключе с cross-org доступом снесём чужие таски. Если у
  // конкретной задачи companyId не пришёл — её тоже скипаем (default-deny).
  const targetCompanyId = integration.tasksflowCompanyId ?? null;
  if (targetCompanyId === null) {
    return NextResponse.json(
      {
        error:
          "Интеграция не привязана к конкретной компании в TasksFlow " +
          "(tasksflowCompanyId=null). Удалить безопасно невозможно — " +
          "выполните «Синхронизация с TasksFlow» в настройках, чтобы " +
          "проставить компанию.",
      },
      { status: 400 }
    );
  }
  const pending = allTasks.filter((t) => {
    if (t.isCompleted) return false;
    if (t.companyId == null) return false;
    if (t.companyId !== targetCompanyId) return false;
    return true;
  });

  if (pending.length === 0) {
    return NextResponse.json({
      ok: true,
      deletedTfTasks: 0,
      removedLocalLinks: 0,
      totalScanned: allTasks.length,
      message: "Нет невыполненных задач — TasksFlow уже чистый",
    });
  }

  // 3. Грузим все локальные ссылки одним запросом, чтобы потом удалять
  // их батчем по tfTaskId без N+1.
  const taskIds = pending.map((t) => t.id);
  const localLinks = await db.tasksFlowTaskLink.findMany({
    where: {
      integrationId: integration.id,
      tasksflowTaskId: { in: taskIds },
    },
    select: { id: true, tasksflowTaskId: true },
  });
  const localByTfId = new Map(
    localLinks.map((l) => [l.tasksflowTaskId, l.id])
  );

  let deletedTfTasks = 0;
  let alreadyGone = 0;
  let removedLocalLinks = 0;
  const errors: string[] = [];

  for (const t of pending) {
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
          `task #${t.id} (${t.title ?? ""}): ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }
    if (deletedRemotely) {
      const localId = localByTfId.get(t.id);
      if (localId) {
        await db.tasksFlowTaskLink
          .delete({ where: { id: localId } })
          .then(() => {
            removedLocalLinks += 1;
          })
          .catch(() => {
            /* race с другим cleanup'ом — игнорируем */
          });
      }
    }
  }

  await db.auditLog.create({
    data: {
      organizationId,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? null,
      action: "tasksflow.cleanup_pending",
      entity: "TasksFlowTaskLink",
      entityId: integration.id,
      details: {
        totalScanned: allTasks.length,
        pendingFound: pending.length,
        deletedTfTasks,
        alreadyGone,
        removedLocalLinks,
        errorsCount: errors.length,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    deletedTfTasks,
    removedLocalLinks,
    alreadyGone,
    totalScanned: allTasks.length,
    pendingFound: pending.length,
    errors: errors.slice(0, 10),
    errorsTotal: errors.length,
  });
}
