import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import {
  notifyEmployee,
  notifyOrganization,
  escapeTelegramHtml as esc,
} from "@/lib/telegram";
import { tasksflowClientFor, TasksFlowError } from "@/lib/tasksflow-client";
import { filterRecipientsByPlace, placeOfEvent } from "@/lib/place-recipients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/tasksflow-escalations?secret=$CRON_SECRET
 *
 * Раз в 6 часов проходит по всем активным TasksFlowTaskLink:
 *   - >L1 ч без выполнения → push непосредственному руководителю
 *     по ManagerScope (либо management в целом если scope не задан);
 *   - >L2 ч без выполнения → push owner'у/manager'у уровнем выше +
 *     помечается уже escalated_owner.
 *
 * Пороги конфигурируются через env vars (default 24/48 ч):
 *   TASKSFLOW_ESCALATE_L1_HOURS — мягкий пинг руководителю
 *   TASKSFLOW_ESCALATE_L2_HOURS — жёсткий пинг owner'у
 *
 * Per-org override пока нет (требует schema change на TasksFlowIntegration —
 * см. P1#3 в docs/THREAD_TASKSFLOW.md, согласовать с потоком 1).
 *
 * Дедупликация — через AuditLog с entity="tasksflow_task_link",
 * entityId=link.id, action ∈ {`escalated_l1`, `escalated_l2`}.
 *
 * INFRA NEXT: добавить в внешний cron 4 раза в день (06/12/18/00 MSK)
 * на /api/cron/tasksflow-escalations.
 */
function readHourThreshold(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  // Sanity-cap чтобы случайно `1000000` не отключил эскалацию навсегда.
  return Math.min(parsed, 24 * 30);
}

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const l1Hours = readHourThreshold("TASKSFLOW_ESCALATE_L1_HOURS", 24);
  const l2Hours = readHourThreshold("TASKSFLOW_ESCALATE_L2_HOURS", 48);
  // Defensive: L2 должен быть строго больше L1; если конфигурация
  // некорректна (l2 <= l1), стрейтиться на defaults вместо silent
  // skip-escalation-l2-навсегда.
  const useL2 = l2Hours > l1Hours ? l2Hours : Math.max(l1Hours * 2, 48);

  const now = new Date();
  const sinceL1 = new Date(now.getTime() - l1Hours * 60 * 60 * 1000);
  const sinceL2 = new Date(now.getTime() - useL2 * 60 * 60 * 1000);

  // Все активные task-link'и старше L1-порога. Заодно подтянем integration,
  // чтобы найти organizationId и сходить в TF API за заголовком.
  const links = await db.tasksFlowTaskLink.findMany({
    where: {
      remoteStatus: "active",
      createdAt: { lte: sinceL1 },
    },
    include: {
      integration: {
        select: {
          id: true,
          organizationId: true,
          baseUrl: true,
          apiKeyEncrypted: true,
          enabled: true,
          tasksflowCompanyId: true,
          label: true,
        },
      },
    },
  });

  const enabledLinks = links.filter((l) => l.integration.enabled);
  let escalatedL1 = 0;
  let escalatedL2 = 0;
  let skipped = 0;

  // Соберём существующие AuditLog'и оптом.
  const linkIds = enabledLinks.map((l) => l.id);
  const existing = await db.auditLog.findMany({
    where: {
      entity: "tasksflow_task_link",
      entityId: { in: linkIds },
      action: { in: ["escalated_l1", "escalated_l2"] },
    },
    select: { entityId: true, action: true },
  });
  const dedupe = new Set(
    existing.map((e) => `${e.entityId}:${e.action}`)
  );

  for (const link of enabledLinks) {
    const isOverL2 = link.createdAt < sinceL2;
    const stage = isOverL2 ? "escalated_l2" : "escalated_l1";

    if (dedupe.has(`${link.id}:${stage}`)) {
      skipped += 1;
      continue;
    }

    // На L2 хотим быть уверены что L1 уже отправлен (для чистоты лога).
    if (stage === "escalated_l2" && !dedupe.has(`${link.id}:escalated_l1`)) {
      // Допускаем — если задача висит >48h и пропустили L1, сразу L2.
    }

    // Title задачи нужен для красивого пуша; берём из TF (лёгкий запрос).
    let taskTitle: string | null = null;
    let assignedWorkerId: number | null = null;
    try {
      const tfClient = tasksflowClientFor(link.integration);
      const task = await tfClient.getTask(link.tasksflowTaskId);
      if (task.isCompleted) {
        // TF уже выполнил — синхронизируем remoteStatus и пропускаем.
        await db.tasksFlowTaskLink.update({
          where: { id: link.id },
          data: { remoteStatus: "completed", completedAt: new Date() },
        });
        skipped += 1;
        continue;
      }
      taskTitle = task.title;
      assignedWorkerId = task.workerId;
    } catch (err) {
      if (err instanceof TasksFlowError && err.status === 404) {
        // Задача удалена в TF — закрываем link.
        await db.tasksFlowTaskLink.update({
          where: { id: link.id },
          data: { remoteStatus: "completed", completedAt: new Date() },
        });
        skipped += 1;
        continue;
      }
      // На сетевые ошибки тихо пропускаем — следующий cron повторит.
      skipped += 1;
      continue;
    }

    // Найдём WeSetup-юзера-исполнителя по TF workerId, чтобы ManagerScope
    // мог дать руководителя.
    let employeeId: string | null = null;
    let employeeName: string | null = null;
    if (assignedWorkerId) {
      const userLink = await db.tasksFlowUserLink.findFirst({
        where: {
          integrationId: link.integration.id,
          tasksflowWorkerId: assignedWorkerId,
        },
        select: {
          wesetupUserId: true,
          user: { select: { name: true } } as never,
        } as never,
      });
      if (userLink) {
        employeeId = (userLink as { wesetupUserId: string }).wesetupUserId;
        employeeName =
          (userLink as { user?: { name?: string } }).user?.name ?? null;
      }
    }

    // Для L1: ищем непосредственного руководителя через ManagerScope.
    // ManagerScope.viewMode определяет, кого видит manager. Нам надо
    // обратное: найти manager'ов, которые видят этого employee.
    let managerToPing: string | null = null;
    if (employeeId) {
      const scopes = await db.managerScope.findMany({
        where: {
          organizationId: link.integration.organizationId,
          OR: [
            { viewMode: "all" },
            {
              viewMode: "specific_users",
              viewUserIds: { has: employeeId },
            },
          ],
        },
        select: { managerId: true, viewMode: true, manager: { select: { buildingIds: true } } },
      });
      // Только руководители, кому задача по месту (2026-11-01): задача точки А
      // не уходит руководителю точки Б.
      const place = await placeOfEvent(link.integration.organizationId, {
        documentId: link.journalDocumentId,
        userId: employeeId,
      });
      const nearby = await filterRecipientsByPlace(
        link.integration.organizationId,
        scopes.map((scope) => ({ ...scope, buildingIds: scope.manager.buildingIds })),
        place,
      );
      // Предпочитаем не "all" (более конкретный manager).
      const specific = nearby.find((s) => s.viewMode === "specific_users");
      managerToPing = specific?.managerId ?? nearby[0]?.managerId ?? null;
    }

    const titleText = taskTitle ?? `Задача #${link.tasksflowTaskId}`;
    const employeeText = employeeName ?? "не назначен";
    const ageHours = Math.floor(
      (now.getTime() - link.createdAt.getTime()) / (60 * 60 * 1000)
    );

    if (stage === "escalated_l1" && managerToPing) {
      // Soft-ping: «у Иван висит просроченная задача».
      const message =
        `🟡 <b>Просроченная задача в TasksFlow</b>\n\n` +
        `«${esc(titleText)}»\n` +
        `Исполнитель: ${esc(employeeText)}\n` +
        `Не выполнено уже ${ageHours} ч (норма ≤ ${l1Hours} ч).`;
      await notifyEmployee(managerToPing, message);
      escalatedL1 += 1;
    } else if (stage === "escalated_l2") {
      // Hard-ping: всему management.
      const message =
        `🚨 <b>Срочно! Просроченная задача >${useL2} ч</b>\n\n` +
        `«${esc(titleText)}»\n` +
        `Исполнитель: ${esc(employeeText)}\n` +
        `Не выполнено ${ageHours} ч — это критическое отставание.\n` +
        `Проверьте ${
          link.integration.label
            ? `«${esc(link.integration.label)}»`
            : "TasksFlow"
        } и переназначьте либо отмените.`;
      // Задача точки — её руководителям и офису (фаза 3 «Офис и точки»).
      await notifyOrganization(link.integration.organizationId, message, ["owner"], undefined, undefined, {
        buildingId: await placeOfEvent(link.integration.organizationId, { documentId: link.journalDocumentId }),
      });
      escalatedL2 += 1;
    } else {
      skipped += 1;
      continue;
    }

    await db.auditLog.create({
      data: {
        organizationId: link.integration.organizationId,
        action: stage,
        entity: "tasksflow_task_link",
        entityId: link.id,
        details: {
          tasksflowTaskId: link.tasksflowTaskId,
          journalCode: link.journalCode,
          rowKey: link.rowKey,
          ageHours,
          employeeId,
          employeeName,
          managerPinged: managerToPing,
        },
      },
    });
  }

  return NextResponse.json({
    ok: true,
    linksScanned: enabledLinks.length,
    escalatedL1,
    escalatedL2,
    skipped,
    thresholdsHours: { l1: l1Hours, l2: useL2 },
  });
}

export const GET = handle;
export const POST = handle;
