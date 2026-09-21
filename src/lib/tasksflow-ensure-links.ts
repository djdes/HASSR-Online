import { db } from "@/lib/db";
import {
  TasksFlowError,
  normalizeRussianPhone,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";
import { syncTasksflowUsers } from "@/lib/tasksflow-user-sync";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

/**
 * Lite-версия syncTasksflowUsers: только WeSetup → TasksFlow
 * (заводим/линкуем). Reverse-sync (TF → WeSetup) НЕ делаем — он
 * нужен только из UI «Sync» кнопки в settings.
 *
 * Запускается из bulk-assign-today перед фан-аутом, чтобы не валиться
 * на «Дежурные ответственные не привязаны к TasksFlow». Если у юзера
 * нет phone — он остаётся без линка (это OK, он просто не получит
 * TF-задачу). Если TF недоступен — возвращаем noop, чтобы основной
 * flow не сломался.
 */
export async function ensureTasksflowUserLinks(input: {
  organizationId: string;
  integration: {
    id: string;
    baseUrl: string;
    apiKeyEncrypted: string;
    enabled: boolean;
  };
}): Promise<{
  attempted: boolean;
  created: number;
  linked: number;
  withoutPhone: number;
  failures: number;
}> {
  const { organizationId, integration } = input;
  if (!integration.enabled) {
    return {
      attempted: false,
      created: 0,
      linked: 0,
      withoutPhone: 0,
      failures: 0,
    };
  }

  const rawUsers = await db.user.findMany({
    where: { organizationId, isActive: true, archivedAt: null, ...NOT_COMMISSION_WHERE },
    select: {
      id: true,
      name: true,
      phone: true,
      role: true,
      createdAt: true,
      positionTitle: true,
      jobPosition: { select: { name: true, seesAllTasks: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const wesetupUsers = rawUsers.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    createdAt: u.createdAt,
    positionTitle: u.jobPosition?.name ?? u.positionTitle ?? null,
    seesAllTasks: u.jobPosition?.seesAllTasks === true,
  }));

  const client = tasksflowClientFor(integration);

  let remoteUsers;
  try {
    remoteUsers = await client.listUsers();
  } catch (err) {
    // TF недоступен — не блокируем bulk-assign. Просто возвращаем
    // что попробовали но ничего не получилось.
    console.warn("[ensureTasksflowUserLinks] listUsers failed", err);
    return {
      attempted: true,
      created: 0,
      linked: 0,
      withoutPhone: 0,
      failures: 1,
    };
  }

  const existingLinks = await db.tasksFlowUserLink.findMany({
    where: { integrationId: integration.id },
    select: { id: true, wesetupUserId: true, source: true },
  });

  try {
    const result = await syncTasksflowUsers({
      integrationId: integration.id,
      wesetupUsers,
      existingLinks,
      remoteUsers,
      createRemoteUser: async ({ name, phone, isAdmin, position }) =>
        client.createUser({
          phone,
          ...(name ? { name } : {}),
          ...(isAdmin ? { isAdmin: true } : {}),
          ...(position !== undefined ? { position } : {}),
        }),
      upsertLink: async ({
        integrationId,
        wesetupUserId,
        phone,
        tasksflowUserId,
        tasksflowWorkerId,
        source,
      }) => {
        await db.tasksFlowUserLink.upsert({
          where: {
            integrationId_wesetupUserId: {
              integrationId,
              wesetupUserId,
            },
          },
          create: {
            integrationId,
            wesetupUserId,
            phone,
            tasksflowUserId,
            tasksflowWorkerId,
            source,
          },
          update: {
            phone,
            tasksflowUserId,
            tasksflowWorkerId,
            source,
          },
        });
      },
    });

    return {
      attempted: true,
      created: result.totals.createdRemote,
      linked: result.totals.linked,
      withoutPhone: result.totals.withoutPhone,
      failures: result.failures.length,
    };
  } catch (err) {
    if (err instanceof TasksFlowError) {
      console.warn(
        "[ensureTasksflowUserLinks] syncTasksflowUsers failed",
        err.status,
        err.message
      );
    } else {
      console.warn("[ensureTasksflowUserLinks] syncTasksflowUsers error", err);
    }
    return {
      attempted: true,
      created: 0,
      linked: 0,
      withoutPhone: 0,
      failures: 1,
    };
  }

  // Заметка: normalizeRussianPhone импортнут на случай будущего
  // расширения (например, фильтр без телефона перед sync).
  void normalizeRussianPhone;
}
