import { NextResponse } from "next/server";
import { Prisma, type TasksFlowOutbox } from "@prisma/client";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { checkTasksflowOutboxHealth } from "@/lib/platform-alerts";
import { tasksflowClientFor, TasksFlowError } from "@/lib/tasksflow-client";
import {
  enqueueOutbox,
  outboxHeaderKey,
  parseCreateTaskPayload,
  type OutboxClientLike,
} from "@/lib/tasksflow-outbox-actions";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import {
  gcDeleteIdempotencyKey,
  isGeneralCleaningDatePlanned,
  parseGcRowKey,
} from "@/lib/tasksflow-adapters/sanitation-day-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 20;
const ADVISORY_LOCK_KEY = 9523847; // случайный constant int4 для Postgres advisory lock

/** Что не так с нагрузкой команды (битая — failed без повторов), иначе null. */
function payloadProblem(row: Pick<TasksFlowOutbox, "action" | "payload">): string | null {
  if (row.action === "createTask") {
    return parseCreateTaskPayload(row.payload) ? null : "Invalid payload: createTask task/row missing";
  }
  const payload = row.payload as Record<string, unknown> | null;
  return typeof payload?.taskId === "number" ? null : "Invalid payload: taskId missing or not number";
}

/**
 * `createTask` — разовая задача (сейчас — генуборка на плановую дату).
 * Возвращает пометку для `lastError` доставленной команды или null.
 *
 * Перед созданием перепроверяем, что задача всё ещё нужна: дату могли
 * убрать из плана или отметить, пока команда ждала в очереди; ссылка на
 * строку могла появиться из параллельной доставки.
 */
async function deliverCreateTask(
  row: TasksFlowOutbox,
  client: ReturnType<typeof tasksflowClientFor>,
): Promise<string | null> {
  const payload = parseCreateTaskPayload(row.payload);
  if (!payload) throw new Error("Invalid payload: createTask");

  if (payload.journalCode === SANITATION_DAY_TEMPLATE_CODE) {
    const gc = parseGcRowKey(payload.rowKey);
    const rowId = payload.rowId ?? gc?.rowId;
    const dateKey = payload.dateKey ?? gc?.dateKey;
    const doc = await db.journalDocument.findUnique({
      where: { id: payload.documentId },
      select: { organizationId: true, status: true, config: true },
    });
    if (
      !doc ||
      doc.organizationId !== row.organizationId ||
      doc.status !== "active" ||
      !rowId ||
      !dateKey ||
      !isGeneralCleaningDatePlanned(normalizeSanitationDayConfig(doc.config), rowId, dateKey)
    ) {
      return "skipped: unplanned";
    }
  }

  const linked = await db.tasksFlowTaskLink.findUnique({
    where: {
      integrationId_journalDocumentId_rowKey: {
        integrationId: row.integrationId,
        journalDocumentId: payload.documentId,
        rowKey: payload.rowKey,
      },
    },
    select: { id: true },
  });
  if (linked) return "skipped: already linked";

  const created = await client.createTask(payload.task, {
    idempotencyKey: outboxHeaderKey(row.idempotencyKey, row.payload),
  });
  try {
    await db.tasksFlowTaskLink.create({
      data: {
        integrationId: row.integrationId,
        journalCode: payload.journalCode,
        journalDocumentId: payload.documentId,
        rowKey: payload.rowKey,
        tasksflowTaskId: created.id,
        remoteStatus: created.isCompleted ? "completed" : "active",
        lastDirection: "push",
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Строку успела связать параллельная доставка — новая задача в TF
      // лишняя: удаляем её тем же outbox'ом.
      await enqueueOutbox(db as unknown as OutboxClientLike, {
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        idempotencyKey: gcDeleteIdempotencyKey(payload.documentId, created.id),
        action: "deleteTask",
        payload: {
          taskId: created.id,
          journalDocumentId: payload.documentId,
          rowKey: payload.rowKey,
          reason: "duplicate-create",
        },
      });
      return `duplicate: task ${created.id} queued for deletion`;
    }
    throw err;
  }
  return null;
}

/**
 * GET /api/cron/tasksflow-outbox?secret=$CRON_SECRET
 *
 * Cron-запускаемый endpoint. Проигрывает pending записи из
 * TasksFlowOutbox через TF REST API (П-15: graceful degradation).
 *
 * Phase 1 (этот коммит):
 *   - action="markClaimedByOther" → fallback на client.deleteTask(taskId).
 *     В TF API нет статуса claimed_by_other, поэтому удаляем sibling.
 *     У worker'а задача исчезает из чата.
 *
 * Phase 2.1 (отдельный коммит после правки в TF repo):
 *   - переключаемся на PATCH /api/tasks/<id> со статусом claimed_by_other.
 *
 * 2026-09-22:
 *   - action="createTask" → client.createTask(payload.task) + TaskLink на
 *     (документ, rowKey). Сейчас так создаются задачи генуборки на
 *     плановую дату. Перед созданием проверяем, что дата ещё в плане и
 *     не выполнена (иначе delivered «skipped: unplanned») и что ссылки
 *     нет (delivered «skipped: already linked»). Ссылка появилась
 *     параллельно (P2002) — новую задачу ставим на удаление.
 *
 * Auth: Bearer CRON_SECRET (через checkCronSecret — единый паттерн
 * с остальными /api/cron/*).
 *
 * Limit: 50 записей за один вызов. Cron должен быть настроен на запуск
 * каждые 30 секунд (или столько-сколько нужно при низкой нагрузке).
 *
 * Error policy:
 *   - 404/410     → delivered (задача уже удалена/не существует).
 *   - 4xx (other) → failed permanently, не retry.
 *   - 5xx/network → leave pending, retry в следующий запуск.
 */
export async function GET(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  // B1 fix: Postgres advisory lock — гарантирует что одновременно
  // только один cron-tick обрабатывает outbox. Если другой уже работает
  // (50 строк × сетевая латентность TF может занять > 30s), просто
  // выходим без работы — следующий запуск подхватит.
  //
  // 2026-09-22: блокировка — на время ТРАНЗАКЦИИ (`pg_try_advisory_xact_lock`).
  // Сессионная `pg_try_advisory_lock` + `pg_advisory_unlock` через пул
  // соединений уходили в разные соединения: снятие молча не срабатывало,
  // замок оставался у простаивающего соединения, и следующие тики
  // выходили с «another_tick_running», пока пул его не закроет (e2e
  // генуборок ловил это стабильно). Транзакция держит одно соединение
  // до конца обработки и отпускает замок сама; работа идёт через `db`.
  return db.$transaction(
    async (tx) => {
      const lockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS locked
      `;
      if (!lockResult[0]?.locked) {
        return NextResponse.json({
          ok: true,
          processed: 0,
          skipped: "another_tick_running",
        });
      }
      return processOutboxTick();
    },
    // 50 команд × таймаут TF 15 с — запас до 15 минут, иначе Prisma
    // откатит транзакцию посреди обработки и отпустит замок раньше времени.
    { maxWait: 10_000, timeout: 15 * 60_000 },
  );
}

async function processOutboxTick(): Promise<NextResponse> {
  {
    const pending = await db.tasksFlowOutbox.findMany({
      where: { status: "pending" },
      orderBy: [
        { lastAttemptAt: { sort: "asc", nulls: "first" } },
        { createdAt: "asc" },
      ],
      take: 50,
      include: { integration: true },
    });

    if (pending.length === 0) {
      return NextResponse.json({ ok: true, processed: 0 });
    }

    let delivered = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const row of pending) {
      const payload = row.payload as Record<string, unknown> | null;
      // taskId нужен всем действиям, кроме createTask — у той своя
      // нагрузка (задача и строка журнала).
      const problem = payloadProblem(row);
      if (problem) {
        // Невалидный payload — пометить failed, не retry.
        await db.tasksFlowOutbox.update({
          where: { id: row.id },
          data: {
            status: "failed",
            lastAttemptAt: new Date(),
            lastError: problem,
          },
        });
        failed += 1;
        errors.push({ id: row.id, error: "invalid_payload" });
        continue;
      }
      const taskId = typeof payload?.taskId === "number" ? payload.taskId : 0;

      if (!row.integration.enabled) {
        // Integration отключён — отмечаем lastAttemptAt чтобы row не блокировал
        // queue head (orderBy [createdAt asc, lastAttemptAt asc]), и пишем
        // observable lastError для диагностики.
        await db.tasksFlowOutbox.update({
          where: { id: row.id },
          data: {
            lastAttemptAt: new Date(),
            lastError: "integration_disabled",
          },
        });
        continue;
      }

      const client = tasksflowClientFor(row.integration);

      try {
        // Phase 1 dispatch — markClaimedByOther fallback'ит в delete:
        //   markClaimedByOther: пока удаляем (TF API не имеет нужного статуса)
        //   deleteTask:         прямой delete
        //   completeTask:       client.completeTask
        //   verifyTask:         Phase 2.1+ (mark-verified в TF API)
        // П-19 spec'а 2026-05-09: передаём `row.idempotencyKey` в TF API
        // как Idempotency-Key header. TF сейчас игнорирует, но когда
        // (Phase 2.5+) поддержит — retries станут безопасными без правок
        // здесь. Header отправляется для всех мутирующих запросов.
        const idempotency = { idempotencyKey: row.idempotencyKey };
        let deliveryNote: string | null = null;
        switch (row.action) {
          case "markClaimedByOther":
          case "deleteTask":
            await client.deleteTask(taskId, idempotency);
            break;
          case "completeTask":
            await client.completeTask(taskId, idempotency);
            break;
          case "createTask":
            // Разовая задача с ссылкой на строку журнала (генуборка на
            // плановую дату). Ссылку TaskLink пишем здесь же.
            deliveryNote = await deliverCreateTask(row, client);
            break;
          default: {
            // N3 fix: Unknown action — permanent producer/consumer mismatch.
            // Throw with sentinel `permanent: true` so catch handler treats
            // it as failed-not-retry (вместо leave-pending в 5xx-ветке).
            const err = new Error(`unknown_action: ${row.action}`);
            (err as Error & { permanent?: boolean }).permanent = true;
            throw err;
          }
        }

        await db.tasksFlowOutbox.update({
          where: { id: row.id },
          data: {
            status: "delivered",
            deliveredAt: new Date(),
            lastAttemptAt: new Date(),
            attempts: { increment: 1 },
            ...(deliveryNote ? { lastError: deliveryNote } : {}),
          },
        });
        delivered += 1;
      } catch (err) {
        const isTfError = err instanceof TasksFlowError;
        const status = isTfError ? err.status : 0;
        const msg = err instanceof Error ? err.message : "unknown";

        // N3 fix: permanent sentinel (unknown_action) — failed, не retry.
        if (
          err instanceof Error &&
          (err as Error & { permanent?: boolean }).permanent
        ) {
          await db.tasksFlowOutbox.update({
            where: { id: row.id },
            data: {
              status: "failed",
              lastAttemptAt: new Date(),
              attempts: { increment: 1 },
              lastError: err.message,
            },
          });
          failed += 1;
          errors.push({ id: row.id, error: err.message });
          continue;
        }

        // 404/410: задача уже удалена/не существует — считаем delivered.
        if (status === 404 || status === 410) {
          await db.tasksFlowOutbox.update({
            where: { id: row.id },
            data: {
              status: "delivered",
              deliveredAt: new Date(),
              lastAttemptAt: new Date(),
              attempts: { increment: 1 },
              lastError: `${status} treated as already-gone`,
            },
          });
          delivered += 1;
          continue;
        }

        // 4xx (кроме 404/410): permanent failure — пометить failed, не retry.
        if (status >= 400 && status < 500) {
          await db.tasksFlowOutbox.update({
            where: { id: row.id },
            data: {
              status: "failed",
              lastAttemptAt: new Date(),
              attempts: { increment: 1 },
              lastError: `${status}: ${msg}`,
            },
          });
          failed += 1;
          errors.push({ id: row.id, error: `${status}: ${msg}` });
          continue;
        }

        // 5xx или network — оставляем pending для retry в следующий запуск,
        // но с capped attempts (I1 fix). Когда attempts достигнет MAX_ATTEMPTS —
        // помечаем failed, чтобы не зацикливаться вечно.
        const nextAttempts = row.attempts + 1;
        const giveUp = nextAttempts >= MAX_ATTEMPTS;
        await db.tasksFlowOutbox.update({
          where: { id: row.id },
          data: {
            status: giveUp ? "failed" : "pending",
            lastAttemptAt: new Date(),
            attempts: { increment: 1 },
            lastError: giveUp
              ? `${status || "network"}: ${msg} (gave up after ${nextAttempts} attempts)`
              : `${status || "network"}: ${msg}`,
          },
        });
        if (giveUp) {
          failed += 1;
        }
        errors.push({ id: row.id, error: `${status || "network"}: ${msg}` });
      }
    }

    // Проверяем очередь ПОСЛЕ проигрывания: до него в ней штатно лежат
    // записи, накопившиеся с прошлого тика, и алерт был бы ложным.
    const health = await checkTasksflowOutboxHealth();

    return NextResponse.json({
      ok: true,
      processed: pending.length,
      delivered,
      failed,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      health: health ?? undefined,
    });
  }
}
