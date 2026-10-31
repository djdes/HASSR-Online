/**
 * Rolling-distribution helpers.
 *
 * После сохранения записи в журнале с distribution=rolling сотрудник
 * получает новую TF-задачу того же типа — пока сам не нажмёт «Готово
 * на сегодня». См. docs/JOURNAL-SPECS.md и lib/journal-specs.ts.
 *
 * Hard caps:
 *   • Дневной лимит: spec.rolling.dailyCap (50 для finished_product,
 *     30 для intensive_cooling и т.д.).
 *   • Защита от runaway loop: если сегодня уже создано >= cap rolling-
 *     задач этого журнала на этого сотрудника, новая не создаётся —
 *     UI вернёт `capped: true` и покажет «Лимит на сегодня».
 */

import { db } from "@/lib/db";
import { effectiveJournalSlots } from "@/lib/journal-responsibles-points";
import {
  TasksFlowError,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";
import { getJournalSpec } from "@/lib/journal-specs";
import { getEffectiveTaskMode } from "@/lib/journal-task-modes";
import { getVerifierSlotId } from "@/lib/journal-responsible-schemas";

export type RollingSpawnResult =
  | {
      ok: true;
      tasksflowTaskId: number;
      dailyCount: number;
      remaining: number;
    }
  | {
      ok: false;
      reason:
        | "not-rolling"
        | "no-integration"
        | "no-tf-user-link"
        | "capped"
        | "tf-error";
      message?: string;
      dailyCount?: number;
    };

/**
 * Создаёт новую rolling-задачу для сотрудника. Идемпотентность —
 * spawn'ы не клонируются между запросами; cap применяется как
 * lower-bound (дневной счётчик уже-созданных rolling-задач).
 */
export async function spawnRollingTask(args: {
  organizationId: string;
  journalCode: string;
  /** WeSetup userId — кто только что сохранил запись. */
  filledByUserId: string;
  /** Заголовок задачи (например, «Бракераж готовой продукции — следующее блюдо»). */
  title: string;
  /** Описание-подсказка с инструкцией. */
  description?: string;
  /** Категория для TF (используется в адаптерах cleaning.ts и пр.). */
  category?: string;
  /** Цена/премия в TF. По умолчанию 0. */
  price?: number;
}): Promise<RollingSpawnResult> {
  // 1. Effective mode — действительно rolling?
  const org = await db.organization.findUnique({
    where: { id: args.organizationId },
    select: {
      journalTaskModesJson: true,
    },
  });
  const mode = getEffectiveTaskMode(
    args.journalCode,
    org?.journalTaskModesJson,
  );
  if (mode.distribution !== "rolling") {
    return { ok: false, reason: "not-rolling" };
  }

  const spec = getJournalSpec(args.journalCode);
  const cap = spec.rolling?.dailyCap ?? 50;

  // 2. Daily count — сколько rolling-задач сегодня уже создано на
  // этого юзера в этом журнале. Считаем по TasksFlowTaskLink с
  // ключом-маркером, см. ниже rowKey.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 3. TasksFlow integration лежит на уровне org.
  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId: args.organizationId, enabled: true },
  });
  if (!integration) {
    return { ok: false, reason: "no-integration" };
  }

  // Daily count — считаем только rolling-задачи (rowKey начинается с
  // "rolling:" по convention). Без отдельной таблицы — это самый
  // простой и устойчивый счётчик.
  const dailyCount = await db.tasksFlowTaskLink.count({
    where: {
      integrationId: integration.id,
      journalCode: args.journalCode,
      rowKey: { startsWith: `rolling:${args.filledByUserId}:` },
      createdAt: { gte: todayStart },
    },
  });

  if (dailyCount >= cap) {
    return { ok: false, reason: "capped", dailyCount };
  }

  // 4. Маппинг WeSetup userId → TF userId.
  const userLink = await db.tasksFlowUserLink.findFirst({
    where: {
      integrationId: integration.id,
      wesetupUserId: args.filledByUserId,
    },
    select: { tasksflowUserId: true },
  });
  if (!userLink?.tasksflowUserId) {
    return { ok: false, reason: "no-tf-user-link" };
  }

  // 5. Verifier — из ответственных: у сотрудника одной точки — её
  // (2026-10-31, ответственные по точкам), иначе — организации.
  let verifierTfUserId: number | undefined;
  const filler = await db.user.findFirst({
    where: { id: args.filledByUserId, organizationId: args.organizationId },
    select: { buildingIds: true },
  });
  const fillerPointId = filler?.buildingIds?.length === 1 ? filler.buildingIds[0] : null;
  const verifierSlotId = getVerifierSlotId(args.journalCode);
  const verifierWesetupUserId = (
    await effectiveJournalSlots(args.organizationId, fillerPointId, args.journalCode)
  )[verifierSlotId];
  if (verifierWesetupUserId) {
    const vLink = await db.tasksFlowUserLink.findFirst({
      where: {
        integrationId: integration.id,
        wesetupUserId: verifierWesetupUserId,
      },
      select: { tasksflowUserId: true },
    });
    if (vLink?.tasksflowUserId) {
      verifierTfUserId = vLink.tasksflowUserId;
    }
  }

  // 6. Create в TasksFlow.
  const client = tasksflowClientFor(integration);
  const rowKey = `rolling:${args.filledByUserId}:${Date.now()}`;
  try {
    const created = await client.createTask({
      title: args.title,
      description: args.description ?? "",
      workerId: userLink.tasksflowUserId,
      verifierWorkerId: verifierTfUserId,
      requiresPhoto: false,
      isRecurring: false,
      category: args.category ?? "Журналы",
      price: args.price ?? 0,
    });
    await db.tasksFlowTaskLink.create({
      data: {
        integrationId: integration.id,
        journalCode: args.journalCode,
        // У rolling-задач нет конкретного journalDocument'а (этот механизм
        // не зависит от document-grid'ов). Маркер "rolling" + уникальный
        // rowKey удовлетворяют unique-constraint и позволяют считать.
        journalDocumentId: "rolling",
        rowKey,
        tasksflowTaskId: created.id,
        remoteStatus: "active",
        lastDirection: "push",
      },
    });
    return {
      ok: true,
      tasksflowTaskId: created.id,
      dailyCount: dailyCount + 1,
      remaining: Math.max(0, cap - (dailyCount + 1)),
    };
  } catch (err) {
    const msg =
      err instanceof TasksFlowError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : "unknown";
    return { ok: false, reason: "tf-error", message: msg, dailyCount };
  }
}

/**
 * Сколько rolling-задач этот сотрудник уже создал сегодня. Используется
 * для отображения счётчика «За сегодня заполнено: N».
 */
export async function countRollingToday(args: {
  organizationId: string;
  journalCode: string;
  userId: string;
}): Promise<number> {
  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId: args.organizationId, enabled: true },
  });
  if (!integration) return 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return await db.tasksFlowTaskLink.count({
    where: {
      integrationId: integration.id,
      journalCode: args.journalCode,
      rowKey: { startsWith: `rolling:${args.userId}:` },
      createdAt: { gte: todayStart },
    },
  });
}
