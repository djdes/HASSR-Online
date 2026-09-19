/**
 * Что делать с задачами TasksFlow, когда документ журнала удаляют.
 *
 * ПОЧЕМУ: `TasksFlowTaskLink.journalDocumentId` — обычная строка без FK и
 * без каскада. Удаление документа оставляло и локальные ссылки, и живые
 * задачи в TasksFlow: исполнитель открывал задачу и попадал на документ,
 * которого больше нет.
 *
 * Как чиним по принципам интеграции (CLAUDE.md):
 *   • П-12: из обработчика удаления НЕ ходим в TF API — только пишем
 *     команды в `TasksFlowOutbox`, их проигрывает cron
 *     `/api/cron/tasksflow-outbox`.
 *   • П-15: команда попадает в очередь в той же транзакции, что и
 *     удаление. TF лежит — команда просто ждёт в очереди.
 *   • П-19: у каждой команды свой `Idempotency-Key`. Ключ
 *     ДЕТЕРМИНИРОВАННЫЙ (как у siblings-cleanup): повторное удаление
 *     того же документа не наплодит дублей, а `idempotencyKey` в модели
 *     уникален и сам отсечёт повтор.
 *
 * Функция здесь чистая — собирает команды из строк связи, ничего не
 * пишет. Всё, что касается БД, живёт в обработчике DELETE.
 */

/** Строка `TasksFlowTaskLink`, какой её видит сборщик команд. */
export type DocumentTaskLinkRow = {
  integrationId: string;
  tasksflowTaskId: number;
};

export type OutboxDeleteCommand = {
  integrationId: string;
  organizationId: string;
  idempotencyKey: string;
  /** Единственное действие, которое уже умеет cron outbox'а. */
  action: "deleteTask";
  payload: { taskId: number; journalDocumentId: string; reason: "document-deleted" };
};

/**
 * Команды удаления задач для одного документа.
 *
 * Отсеиваются: нечисловые и неположительные `tasksflowTaskId` (битая
 * запись) и повторы одного и того же taskId — две строки связи на одну
 * задачу дали бы две одинаковые команды.
 */
export function buildDocumentTaskDeleteCommands(args: {
  organizationId: string;
  journalDocumentId: string;
  links: DocumentTaskLinkRow[];
}): OutboxDeleteCommand[] {
  const seen = new Set<number>();
  const commands: OutboxDeleteCommand[] = [];
  for (const link of args.links) {
    const taskId = link.tasksflowTaskId;
    if (!Number.isInteger(taskId) || taskId <= 0) continue;
    if (!link.integrationId) continue;
    if (seen.has(taskId)) continue;
    seen.add(taskId);
    commands.push({
      integrationId: link.integrationId,
      organizationId: args.organizationId,
      idempotencyKey: `doc-delete::${args.journalDocumentId}::${taskId}`,
      action: "deleteTask",
      payload: {
        taskId,
        journalDocumentId: args.journalDocumentId,
        reason: "document-deleted",
      },
    });
  }
  return commands;
}
