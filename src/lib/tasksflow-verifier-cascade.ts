/**
 * Каскад смены verifier'а в TasksFlow при изменении «ответственного
 * по журналу» в WeSetup-настройках.
 *
 * Сценарий: менеджер заходит в /settings/journal-responsibles, меняет
 * проверяющего по журналу «Уборка» с заведующей А на заведующую Б.
 * До этого момента TasksFlow-задачи, созданные по этому журналу, имели
 * verifier_worker_id = TF-id заведующей А. Без каскада новый
 * проверяющий не увидит эти задачи в своём табе «На проверке».
 *
 * Этот helper:
 *   1. Находит активную TF-интеграцию для org.
 *   2. Резолвит TF-id'ы старого и нового verifier'ов.
 *   3. Находит TF-задачи которые относятся к этому journalCode (через
 *      journalLink-блоб), И принадлежат компании org, И имеют
 *      verifier_worker_id = старый или null. Меняет на новый.
 *   4. По scope:
 *      • "active-any" — только incomplete задачи (isCompleted=false)
 *        и submitted-задачи (verification_status='submitted'). Логично
 *        для «изменить в активных».
 *      • "all" — все, включая уже одобренные / отклонённые.
 *
 * Не валит весь pipeline если TF недоступен — возвращает report с
 * `errors` count.
 */

import { db } from "@/lib/db";
import {
  tasksflowClientFor,
  TasksFlowError,
} from "@/lib/tasksflow-client";

export type VerifierCascadeScope = "active-any" | "all";

export type VerifierCascadeReport = {
  attempted: number;
  updated: number;
  errors: number;
  skippedReason?: string;
};

export async function cascadeVerifierToTasksflow(args: {
  organizationId: string;
  journalCode: string;
  newPrimaryUserId: string | null;
  scope: VerifierCascadeScope;
  /**
   * Только задачи документов этой точки (ответственные точки, 2026-10-31);
   * `null` — только общих документов (без точки); не задано — все.
   */
  buildingId?: string | null;
}): Promise<VerifierCascadeReport> {
  const { organizationId, journalCode, newPrimaryUserId, scope } = args;

  const integration = await db.tasksFlowIntegration.findUnique({
    where: { organizationId },
    select: {
      id: true,
      enabled: true,
      baseUrl: true,
      apiKeyEncrypted: true,
    },
  });
  if (!integration || !integration.enabled) {
    return { attempted: 0, updated: 0, errors: 0, skippedReason: "no-integration" };
  }

  // Резолвим TF-id нового проверяющего (если задан).
  let newVerifierTfId: number | null = null;
  if (newPrimaryUserId) {
    const link = await db.tasksFlowUserLink.findFirst({
      where: {
        integrationId: integration.id,
        wesetupUserId: newPrimaryUserId,
        tasksflowUserId: { not: null },
      },
      select: { tasksflowUserId: true },
    });
    newVerifierTfId = link?.tasksflowUserId ?? null;
  }

  // Находим TF-task-link-и для этого journalCode. Каждый link знает
  // tasksflowTaskId — туда и патчим verifierWorkerId.
  // Линки создаются bulk-assign-today при createTask; по journalCode
  // фильтруем точечно.
  const linksWhere: Record<string, unknown> = {
    integrationId: integration.id,
    journalCode,
  };
  if (args.buildingId !== undefined) {
    const pointDocs = await db.journalDocument.findMany({
      where: { organizationId, buildingId: args.buildingId, template: { code: journalCode } },
      select: { id: true },
    });
    linksWhere.journalDocumentId = { in: pointDocs.map((doc) => doc.id) };
  }
  if (scope === "active-any") {
    // Активные: те что не "completed" со стороны WeSetup. У link есть
    // remoteStatus и поле claimedAt; "completed" — закрытые.
    linksWhere.remoteStatus = { not: "completed" };
  }
  const links = await db.tasksFlowTaskLink.findMany({
    where: linksWhere,
    select: { id: true, tasksflowTaskId: true },
  });

  if (links.length === 0) {
    return { attempted: 0, updated: 0, errors: 0 };
  }

  // Patch'им через TasksFlow API. Здесь нет batch-route, делаем по
  // одному (links обычно ≤ десятков — N помещений × N сотрудников).
  const client = tasksflowClientFor(integration);
  let updated = 0;
  let errors = 0;
  for (const link of links) {
    try {
      await client.updateTask(link.tasksflowTaskId, {
        verifierWorkerId: newVerifierTfId,
      });
      updated += 1;
    } catch (err) {
      errors += 1;
      console.warn(
        "[verifier-cascade] updateTask failed",
        link.tasksflowTaskId,
        err instanceof TasksFlowError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : err,
      );
    }
  }

  return { attempted: links.length, updated, errors };
}
