import { db } from "@/lib/db";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { tasksflowClientFor, TasksFlowError } from "@/lib/tasksflow-client";
import { pickPrimaryStaff } from "@/lib/user-roles";
import { placeOfEvent } from "@/lib/place-recipients";
import { loadWorkerPointScope, personInWorkerScope } from "@/lib/worker-point-scope";

/**
 * Автоматический offboarding (Feature 3.5.4):
 *   при деактивации сотрудника (isActive=false) автоматически:
 *     1. archivedAt=now()
 *     2. telegramChatId=null (TG-аккаунт отвязывается)
 *     3. находим преемника по той же jobPositionId — либо fallback
 *        на первого активного сотрудника совместимой роли;
 *     4. в TasksFlow перевешиваем все его открытые задачи на преемника
 *        (если интеграция включена и преемник имеет TF user link);
 *     5. AuditLog `offboarding.complete` с count'ом и именами;
 *     6. Telegram-уведомление руководителям с резюме.
 *
 * Идемпотентно — повторный вызов на уже архивированном user'е ничего
 * не сломает (просто 0 задач для перевода).
 *
 * Дёргается из `/api/users/[id]` (PUT при isActive→false и DELETE).
 */
export async function performOffboarding({
  userId,
  organizationId,
  actorId,
  actorName,
}: {
  userId: string;
  organizationId: string;
  actorId: string;
  actorName: string | null;
}): Promise<{
  reassignedCount: number;
  successorName: string | null;
  successorId: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const departing = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      jobPositionId: true,
      telegramChatId: true,
      organizationId: true,
    },
  });
  if (!departing || departing.organizationId !== organizationId) {
    return {
      reassignedCount: 0,
      successorName: null,
      successorId: null,
      errors: ["Пользователь не найден"],
    };
  }

  // 1+2: архив + clear TG.
  await db.user.update({
    where: { id: userId },
    data: {
      archivedAt: new Date(),
      telegramChatId: null,
    },
  });

  // 3. Successor lookup.
  const allCandidates = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      archivedAt: null,
      isRoot: false,
      id: { not: userId },
    },
    select: {
      id: true,
      name: true,
      role: true,
      jobPositionId: true,
      buildingIds: true,
    },
  });
  // Преемник — среди тех, кто работает на точках уволенного (2026-11-01,
  // «точка видит только своё»): кондитера точки А не заменит кондитер
  // точки Б. Подходящих нет — без преемника.
  const pointScope = await loadWorkerPointScope(organizationId, userId);
  const candidates = allCandidates.filter((c) => personInWorkerScope(pointScope, c.buildingIds));
  // Same jobPosition first.
  let successor = departing.jobPositionId
    ? candidates.find((c) => c.jobPositionId === departing.jobPositionId) ?? null
    : null;
  // Fallback: same role.
  if (!successor) {
    successor = candidates.find((c) => c.role === departing.role) ?? null;
  }
  // Fallback: pick by general staff priority.
  if (!successor) {
    successor = pickPrimaryStaff(candidates);
  }

  // 4. Reassign TF tasks. Только для активного интегратора.
  let reassignedCount = 0;
  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId, enabled: true },
  });

  if (integration && successor) {
    const [departingLink, successorLink] = await Promise.all([
      db.tasksFlowUserLink.findFirst({
        where: { integrationId: integration.id, wesetupUserId: userId },
      }),
      db.tasksFlowUserLink.findFirst({
        where: { integrationId: integration.id, wesetupUserId: successor.id },
      }),
    ]);
    const successorTfWorkerId = successorLink?.tasksflowWorkerId ?? null;
    const departingTfWorkerId = departingLink?.tasksflowWorkerId ?? null;

    if (successorTfWorkerId && departingTfWorkerId) {
      const openLinks = await db.tasksFlowTaskLink.findMany({
        where: {
          integrationId: integration.id,
          remoteStatus: "active",
        },
        select: { id: true, tasksflowTaskId: true, rowKey: true },
      });

      const tfClient = tasksflowClientFor(integration);
      for (const link of openLinks) {
        // Дёшево проверить что task действительно у уходящего —
        // через getTask. На больших объёмах можно оптимизировать,
        // но для offboarding редкого юзера 50-100 запросов терпимо.
        try {
          const task = await tfClient.getTask(link.tasksflowTaskId);
          if (task.workerId !== departingTfWorkerId) continue;
          await tfClient.updateTask(link.tasksflowTaskId, {
            title: task.title,
            workerId: successorTfWorkerId,
          });
          reassignedCount += 1;
        } catch (err) {
          if (err instanceof TasksFlowError && err.status === 404) continue;
          errors.push(
            `task #${link.tasksflowTaskId}: ${
              err instanceof Error ? err.message : "ошибка"
            }`
          );
        }
      }
    } else if (!successorTfWorkerId) {
      errors.push(
        "Преемник не привязан к TasksFlow — задачи не переведены автоматически"
      );
    }
  }

  // 5. AuditLog.
  await db.auditLog.create({
    data: {
      organizationId,
      userId: actorId,
      userName: actorName,
      action: "offboarding.complete",
      entity: "user",
      entityId: userId,
      details: {
        departingUserName: departing.name,
        departingRole: departing.role,
        successorId: successor?.id ?? null,
        successorName: successor?.name ?? null,
        reassignedCount,
        errors,
      },
    },
  });

  // 6. Notify managers.
  const successorLine = successor
    ? `Преемник: <b>${esc(successor.name)}</b>`
    : "Преемник не найден — назначьте задачи вручную";
  const message =
    `🔚 <b>Сотрудник деактивирован</b>\n\n` +
    `${esc(departing.name)} (${esc(departing.role)})\n` +
    `${successorLine}\n` +
    `Задач перевешено в TasksFlow: <b>${reassignedCount}</b>` +
    (errors.length > 0
      ? `\n\nОшибки: ${esc(errors.slice(0, 3).join("; "))}`
      : "");

  // notifyOrganization получает массив ролей — но если первый элемент
  // "owner" или "manager", он автоматически расширяется до полного
  // набора management ролей через MANAGEMENT_ROLES. Поэтому ["owner"]
  // достаточно — попадёт ко всем менеджерам/head_chef'ам/owner'ам.
  // Человек одной точки — её руководителям и офису (фаза 3 «Офис и точки»).
  await notifyOrganization(organizationId, message, ["owner"], undefined, undefined, {
    buildingId: await placeOfEvent(organizationId, { userId: departing.id }),
  });

  return {
    reassignedCount,
    successorName: successor?.name ?? null,
    successorId: successor?.id ?? null,
    errors,
  };
}
