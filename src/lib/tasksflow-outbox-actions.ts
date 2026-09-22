/**
 * Команды WeSetup → TasksFlow через `TasksFlowOutbox` (П-15, П-19).
 *
 * Здесь — постановка команды в очередь и разбор нагрузки `createTask`.
 * Клиент БД передаётся параметром (транзакция или `db`), поэтому модуль
 * не тянет Prisma-синглтон и проверяется юнит-тестом на фейковом клиенте.
 *
 * Постановка — `createMany … skipDuplicates` (INSERT … ON CONFLICT DO
 * NOTHING): повтор по `idempotencyKey` не роняет транзакцию Postgres,
 * в отличие от пойманного P2002.
 *
 * `requeue` — для `createTask`: планировщик просит создать задачу, только
 * когда ссылки на неё нет. Значит, доставленная раньше команда с тем же
 * ключом не оставила живой задачи (дату убирали из плана и вернули,
 * задачу удалили в TF) — ставим её снова, с новым «поколением»:
 * заголовок Idempotency-Key получает суффикс `#g<N>`, чтобы TasksFlow не
 * вернул прошлую, уже удалённую задачу.
 */
import type { CreateTaskInput } from "@/lib/tasksflow-client";

export type OutboxAction = "createTask" | "deleteTask" | "completeTask" | "markClaimedByOther";

export type OutboxCreateTaskPayload = {
  journalCode: string;
  documentId: string;
  rowKey: string;
  rowId?: string;
  dateKey?: string;
  task: CreateTaskInput;
  /** Номер повторной постановки той же команды; 0/нет — первая. */
  generation?: number;
};

/**
 * Минимальный срез Prisma-клиента, которым пользуется `enqueueOutbox`.
 * Подходит и `db`, и `tx` из `db.$transaction`.
 */
export type OutboxClientLike = {
  tasksFlowOutbox: {
    createMany(args: {
      data: Array<{
        integrationId: string;
        organizationId: string;
        idempotencyKey: string;
        action: string;
        payload: never;
        status: "pending";
      }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { idempotencyKey: string };
      select: { id: true; status: true; payload: true };
    }): Promise<{ id: string; status: string; payload: unknown } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type EnqueueResult = "queued" | "exists" | "requeued" | "refreshed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function generationOf(payload: unknown): number {
  const value = isRecord(payload) ? payload.generation : undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function withoutGeneration(payload: unknown): string {
  if (!isRecord(payload)) return JSON.stringify(payload ?? null);
  const rest = { ...payload };
  delete rest.generation;
  return JSON.stringify(rest);
}

/** Idempotency-Key для заголовка запроса в TF: ключ + поколение повтора. */
export function outboxHeaderKey(idempotencyKey: string, payload: unknown): string {
  const generation = generationOf(payload);
  return generation > 0 ? `${idempotencyKey}#g${generation}` : idempotencyKey;
}

export async function enqueueOutbox(
  client: OutboxClientLike,
  input: {
    integrationId: string;
    organizationId: string;
    idempotencyKey: string;
    action: OutboxAction;
    payload: Record<string, unknown> | OutboxCreateTaskPayload;
  },
  options: { requeue?: boolean } = {},
): Promise<EnqueueResult> {
  const created = await client.tasksFlowOutbox.createMany({
    data: [
      {
        integrationId: input.integrationId,
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
        action: input.action,
        payload: input.payload as never,
        status: "pending",
      },
    ],
    skipDuplicates: true,
  });
  if (created.count > 0) return "queued";
  if (!options.requeue) return "exists";

  const existing = await client.tasksFlowOutbox.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, status: true, payload: true },
  });
  if (!existing) return "exists";
  const samePayload = withoutGeneration(existing.payload) === withoutGeneration(input.payload);
  const generation = generationOf(existing.payload);

  if (existing.status === "pending") {
    if (samePayload) return "exists";
    await client.tasksFlowOutbox.update({
      where: { id: existing.id },
      data: { payload: { ...input.payload, ...(generation > 0 ? { generation } : {}) } },
    });
    return "refreshed";
  }
  // Проваленную (4xx) с той же нагрузкой не долбим каждый час — повтор
  // имеет смысл, только если что-то поменялось (другой исполнитель).
  if (existing.status === "failed" && samePayload) return "exists";
  await client.tasksFlowOutbox.update({
    where: { id: existing.id },
    data: {
      status: "pending",
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
      deliveredAt: null,
      payload: { ...input.payload, generation: generation + 1 },
    },
  });
  return "requeued";
}

/** Нагрузка `createTask` из строки outbox; битая — null (команда провалится без повторов). */
export function parseCreateTaskPayload(payload: unknown): OutboxCreateTaskPayload | null {
  if (!isRecord(payload)) return null;
  const { journalCode, documentId, rowKey, task } = payload;
  if (typeof journalCode !== "string" || !journalCode) return null;
  if (typeof documentId !== "string" || !documentId) return null;
  if (typeof rowKey !== "string" || !rowKey) return null;
  if (!isRecord(task)) return null;
  if (typeof task.title !== "string" || !task.title.trim()) return null;
  if (typeof task.workerId !== "number" || !Number.isInteger(task.workerId) || task.workerId <= 0) {
    return null;
  }
  return payload as unknown as OutboxCreateTaskPayload;
}
