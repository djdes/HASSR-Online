import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { resolveOrgFromTasksflowBearerOrSession } from "@/lib/tasksflow-auth";
import {
  TasksFlowError,
  normalizeRussianPhone,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";
import { syncTasksflowUsers } from "@/lib/tasksflow-user-sync";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh the WeSetup ↔ TasksFlow user mapping for the active org.
 *
 * Algorithm:
 *   1. Pull every WeSetup user in the org (we need phone).
 *   2. Pull every TasksFlow user via the bound key.
 *   3. Match by normalized phone — first hit wins on the TasksFlow side.
 *   4. Upsert `TasksFlowUserLink` per WeSetup user. Existing rows with
 *      `source = "manual"` are left alone (the admin pinned them on
 *      purpose, e.g. when phones differ).
 *
 * Returns counts so the UI can show "Связано 7 из 12 сотрудников".
 */
export async function POST(request: Request) {
  const auth = await resolveOrgFromTasksflowBearerOrSession(request);
  if (!auth.ok) return auth.response;
  const orgId = auth.organizationId;
  const integration = await db.tasksFlowIntegration.findUnique({
    where: { organizationId: orgId },
    select: { id: true, baseUrl: true, apiKeyEncrypted: true, enabled: true },
  });
  if (!integration || !integration.enabled) {
    return NextResponse.json(
      { error: "Интеграция не подключена" },
      { status: 400 }
    );
  }

  const rawUsers = await db.user.findMany({
    where: { organizationId: orgId, isActive: true, archivedAt: null, ...NOT_COMMISSION_WHERE },
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
  // jobPosition.name — авторитетный источник (если задано), positionTitle
  // legacy fallback. Так положение синхронизируется с актуальной
  // должностью даже если позиционный snapshot устарел.
  const wesetupUsers = rawUsers.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    createdAt: u.createdAt,
    positionTitle: u.jobPosition?.name ?? u.positionTitle ?? null,
    seesAllTasks: u.jobPosition?.seesAllTasks === true,
  }));

  let remoteUsers;
  try {
    remoteUsers = await tasksflowClientFor(integration).listUsers();
  } catch (err) {
    if (err instanceof TasksFlowError) {
      return NextResponse.json(
        { error: `TasksFlow ошибка: ${err.message}` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "Не удалось получить список пользователей TasksFlow" },
      { status: 502 }
    );
  }

  const existingLinks = await db.tasksFlowUserLink.findMany({
    where: { integrationId: integration.id },
    select: { id: true, wesetupUserId: true, source: true },
  });

  const client = tasksflowClientFor(integration);
  let result;
  try {
    result = await syncTasksflowUsers({
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
  } catch (err) {
    if (err instanceof TasksFlowError) {
      return NextResponse.json(
        { error: `TasksFlow ошибка: ${err.message}` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "Не удалось синхронизировать сотрудников с TasksFlow" },
      { status: 502 }
    );
  }

  // Reverse sync (P1#4): TF → WeSetup. Когда manager в TF добавляет
  // сотрудника, он не появляется в WeSetup автоматически — раньше нужно
  // было руками заводить. Теперь после прямой синхронизации идём
  // вторым проходом: для каждого TF-юзера без WeSetup-связи создаём
  // pending User (isActive=false, синтетический email tf-{id}@invited.local,
  // случайный пароль) + linking row.
  //
  // Pending user может авторизоваться только после того как owner
  // активирует их в /settings/users (включит isActive + сменит email
  // на настоящий и пароль через "сбросить пароль").
  //
  // Не трогаем TF-админов: создавать в WeSetup отдельную учётку для
  // совладельца — overengineering. Owner/admin в TF — это обычно тот
  // же человек, что owner в WeSetup; ему не нужна вторая учётка.
  const wesetupUserIdsLinked = new Set(
    existingLinks.map((l) => l.wesetupUserId),
  );
  const wesetupPhonesLinked = new Set(
    rawUsers
      .filter((u) => wesetupUserIdsLinked.has(u.id))
      .map((u) => normalizeRussianPhone(u.phone || ""))
      .filter((p): p is string => Boolean(p)),
  );
  const wesetupPhonesAll = new Set(
    rawUsers
      .map((u) => normalizeRussianPhone(u.phone || ""))
      .filter((p): p is string => Boolean(p)),
  );
  const orphanTfUsers = remoteUsers.filter((tf) => {
    if (tf.isAdmin) return false;
    const phone = normalizeRussianPhone(tf.phone || "");
    if (!phone) return false;
    if (wesetupPhonesAll.has(phone)) return false;
    if (wesetupPhonesLinked.has(phone)) return false;
    return true;
  });

  const importedFromTasksflow: Array<{
    tasksflowUserId: number;
    name: string | null;
    phone: string;
    wesetupUserId: string;
  }> = [];
  const importFailures: Array<{
    tasksflowUserId: number;
    phone: string;
    message: string;
  }> = [];

  for (const tf of orphanTfUsers) {
    const phone = normalizeRussianPhone(tf.phone || "");
    if (!phone) continue;
    try {
      const synthEmail = `tf-${tf.id}@invited.local`;
      const passwordHash = await bcrypt.hash(
        randomBytes(32).toString("hex"),
        10,
      );
      const created = await db.user.create({
        data: {
          email: synthEmail,
          name: tf.name?.trim() || `TF #${tf.id}`,
          phone,
          passwordHash,
          role: "cook",
          organizationId: orgId,
          isActive: false,
        },
        select: { id: true, name: true },
      });
      await db.tasksFlowUserLink.create({
        data: {
          integrationId: integration.id,
          wesetupUserId: created.id,
          phone,
          tasksflowUserId: tf.id,
          tasksflowWorkerId: tf.id,
          source: "auto",
        },
      });
      importedFromTasksflow.push({
        tasksflowUserId: tf.id,
        name: created.name,
        phone,
        wesetupUserId: created.id,
      });
    } catch (err) {
      importFailures.push({
        tasksflowUserId: tf.id,
        phone,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  await db.tasksFlowIntegration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  return NextResponse.json({
    ...result,
    reverseSync: {
      imported: importedFromTasksflow.length,
      failures: importFailures,
      ...(importedFromTasksflow.length > 0
        ? { details: importedFromTasksflow }
        : {}),
    },
  });
}
