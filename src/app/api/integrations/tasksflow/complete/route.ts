import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyForTaskSubmission } from "@/lib/tasksflow-adapters/row-key";
import { buildCompletionValidator } from "@/lib/tasksflow-adapters/task-form";
import { toDateKey } from "@/lib/hygiene-document";
import {
  extractTasksFlowBearer,
  findTaskLinkForAuthorizedIntegrations,
  getMatchingTasksFlowIntegrations,
} from "@/lib/tasksflow-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Apply a completion with structured form values.
 *
 *   POST /api/integrations/tasksflow/complete
 *   Headers: Authorization: Bearer tfk_…
 *   Body:
 *     {
 *       "taskId":      number,
 *       "isCompleted": boolean,     // false to undo
 *       "values":      Record<string, unknown>   // per TaskFormSchema
 *     }
 *
 * Validated against the journal's TaskFormSchema (if any), then the
 * adapter's `applyRemoteCompletion({values})` maps into the journal's
 * native model. Idempotent — same payload twice is a no-op.
 *
 * This supplements the existing webhook + sync-tasks paths. Those two
 * track only `isCompleted` (boolean). This endpoint also carries the
 * structured form values the employee entered.
 */
const bodySchema = z.object({
  taskId: z.number().int().positive(),
  isCompleted: z.boolean(),
  values: z.record(z.string(), z.unknown()).optional(),
  integrationId: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const presented = extractTasksFlowBearer(auth);
  if (!presented) {
    return NextResponse.json({ error: "Missing Bearer key" }, { status: 401 });
  }
  const integrations = await getMatchingTasksFlowIntegrations(presented);
  if (integrations.length === 0) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const found = await findTaskLinkForAuthorizedIntegrations({
    integrations,
    tasksflowTaskId: payload.taskId,
    preferredIntegrationId: payload.integrationId,
  });
  if (!found) {
    return NextResponse.json(
      { error: "Task not bound to a journal row" },
      { status: 404 }
    );
  }
  const { integration, link } = found;

  const adapter = getAdapter(link.journalCode);
  if (!adapter) {
    return NextResponse.json(
      { error: `Журнал «${link.journalCode}» пока нельзя заполнить из задачи` },
      { status: 400 }
    );
  }

  // Validate values against the form schema if the adapter publishes one.
  let sanitized: Record<string, string | number | boolean | null> = {};
  const sourceValues = (payload.values ?? {}) as Record<string, unknown>;
  if (adapter.getTaskForm) {
    try {
      const schema = await adapter.getTaskForm({
        documentId: link.journalDocumentId,
        rowKey: link.rowKey,
      });
      if (schema) {
        const validator = buildCompletionValidator(schema);
        sanitized = validator.parse(sourceValues) as typeof sanitized;
      } else {
        sanitized = coerceValues(sourceValues);
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: `Ошибка валидации: ${err.issues[0]?.message ?? "неизвестно"}`,
          },
          { status: 400 }
        );
      }
      throw err;
    }
  } else {
    sanitized = coerceValues(sourceValues);
  }

  const todayKey = toDateKey(new Date());

  // Idempotency: TasksFlow при сетевых сбоях / таймаутах может сделать
  // несколько retry-вызовов с тем же payload. Адаптеры с append-семантикой
  // (acceptance/complaint/accident/breakdown/ppe/staff-training/traceability/
  // metal-impurity/disinfectant/glass-list/audit-report) на каждый вызов
  // создают НОВУЮ строку — это даёт дубли в журнале.
  //
  // Дедуп через AuditLog без schema change: считаем sha256 от
  // (integrationId | taskId | isCompleted | stableJSON(values) | todayKey).
  // Если такой entityId уже записан в `tasksflow_complete_event` за
  // последний час — это retry, отвечаем кэшированным результатом
  // и НЕ применяем повторно. Если payload отличается (юзер
  // отредактировал данные) — хэш другой, обработка идёт штатно.
  const eventId = createHash("sha256")
    .update(
      [
        integration.id,
        payload.taskId,
        payload.isCompleted ? "1" : "0",
        stableStringify(sanitized),
        todayKey,
      ].join("\0"),
    )
    .digest("hex");

  const sinceHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dedup = await db.auditLog.findFirst({
    where: {
      entity: "tasksflow_complete_event",
      entityId: eventId,
      createdAt: { gte: sinceHourAgo },
    },
    select: { details: true },
  });
  if (dedup) {
    const cached =
      dedup.details && typeof dedup.details === "object"
        ? (dedup.details as Record<string, unknown>)
        : {};
    return NextResponse.json({
      ok: true,
      applied: Boolean(cached.applied),
      todayKey,
      deduped: true,
    });
  }

  const changed = await adapter.applyRemoteCompletion({
    documentId: link.journalDocumentId,
    // Строчный журнал: каждая отправка — новая строка, иначе она
    // переписывала прошлую. Хвост ключа — от `eventId` (содержимое запроса),
    // а не от времени: повтор TasksFlow, пришедший до записи дедупа (первый
    // запрос ещё ждёт блокировку документа), попадает в ту же строку.
    rowKey: rowKeyForTaskSubmission(link.journalCode, link.rowKey, parseInt(eventId.slice(0, 12), 16)),
    completed: payload.isCompleted,
    todayKey,
    values: sanitized,
  });

  await db.tasksFlowTaskLink.update({
    where: { id: link.id },
    data: {
      remoteStatus: payload.isCompleted ? "completed" : "active",
      completedAt: payload.isCompleted ? new Date() : null,
      lastDirection: "pull",
    },
  });

  // Зеркалим completion-event в наш JournalTaskClaim, если он есть.
  // Сотрудник в TF Telegram нажал «Готово» — в WeSetup mini-app сразу
  // видно «Готово · Иванов».
  try {
    const { syncTasksFlowCompletionToClaim } = await import(
      "@/lib/tasksflow-claim-mirror"
    );
    await syncTasksFlowCompletionToClaim({
      organizationId: integration.organizationId,
      journalCode: link.journalCode,
      scopeKey: link.rowKey,
      isCompleted: payload.isCompleted,
      tasksFlowTaskId: payload.taskId,
    });
  } catch (err) {
    console.error("[tasksflow-complete] sync to claim failed", err);
  }

  // Race-siblings cleanup (П-2 спека 2026-05-09): когда worker закрыл
  // race-задачу на комнату, sibling-задачи у других уборщиков должны
  // исчезнуть. Только для cleaning журнала + isCompleted=true.
  //
  // ВАЖНО: НЕ оборачиваем в try/catch. Если markSiblings падает —
  // webhook возвращает 500, TF делает retry, AuditLog.create на
  // строке 243 не выполняется → top-level dedup при retry не
  // короткозамкнётся, весь flow перезапустится. Идемпотентность
  // обеспечена deterministic key (siblings::<excludeId>::<sibId>)
  // в markSiblingsAsClaimedByOther + upsert в adapter.applyRemoteCompletion.
  if (
    payload.isCompleted &&
    link.journalCode === "cleaning" &&
    link.rowKey.startsWith("room::")
  ) {
    const { markSiblingsAsClaimedByOther } = await import(
      "@/lib/cleaning-siblings-cleanup"
    );
    // Phase-1: имя worker'а не приходит в payload. Передаём пустую
    // строку — markSiblingsAsClaimedByOther подставит "другой уборщик".
    // claimedByWorkerId: 0 как unknown (валидация в функции это разрешает).
    // Phase-2.1: добавим запрос в TF GET /api/tasks/<id> для получения
    // completedByWorkerId и его имени, чтобы у sibling'а был корректный
    // statusText "Сделал: Иван П.".
    const siblingsResult = await markSiblingsAsClaimedByOther({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      journalDocumentId: link.journalDocumentId,
      closedRowKey: link.rowKey,
      excludeTaskId: payload.taskId,
      claimedByName: "",
      claimedByWorkerId: 0,
    });
    // Логируем при любом ненулевом результате (и marked, и skipped):
    // skipped > 0 = TF/webhook делает retry, полезно для диагностики.
    if (siblingsResult.marked > 0 || siblingsResult.skipped > 0) {
      console.log(
        `[siblings-cleanup] task=${payload.taskId} room-key=${link.rowKey} marked=${siblingsResult.marked} skipped=${siblingsResult.skipped}`,
      );
    }
  }

  // Записываем audit AFTER успешной apply — иначе при ошибке adapter'а
  // следующий retry сразу dedupнется и журнал останется без записи.
  await db.auditLog.create({
    data: {
      organizationId: integration.organizationId,
      action: "tasksflow_complete",
      entity: "tasksflow_complete_event",
      entityId: eventId,
      details: {
        taskId: payload.taskId,
        isCompleted: payload.isCompleted,
        journalCode: link.journalCode,
        rowKey: link.rowKey,
        applied: changed,
        todayKey,
      },
    },
  });

  return NextResponse.json({ ok: true, applied: changed, todayKey });
}

/** Stable JSON for hashing — keys sorted, undefined skipped, null preserved. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Best-effort narrow of unknown values to the shape adapters expect. */
function coerceValues(
  raw: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return out;
}
