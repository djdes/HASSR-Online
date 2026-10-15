import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import {
  TasksFlowError,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { buildCompletionValidator } from "@/lib/tasksflow-adapters/task-form";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";
import { toDateKey } from "@/lib/hygiene-document";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit handler for the public `/task-fill/[taskId]` page.
 *
 *   POST /api/task-fill/<taskId>
 *   Body: { token: "<task-fill-hmac>", values: {...} }
 *
 * Flow:
 *   1. Resolve TaskLink → integration → verify HMAC with
 *      webhookSecret. Wrong/expired token → 401.
 *   2. Pick adapter → validate values through its form schema.
 *   3. Adapter.applyRemoteCompletion writes to journal (upsert for
 *      Entry-based, append/update for config.rows-based).
 *   4. Mark the remote TasksFlow task as isCompleted=true so the
 *      worker's dashboard reflects the done state without manual tap.
 *   5. Bump TaskLink.remoteStatus + completedAt for audit.
 */
const bodySchema = z.object({
  token: z.string().min(10),
  values: z.record(z.string(), z.unknown()).optional(),
  /** Unix-timestamp ms когда форма открылась — для time-to-fill метрики.
   *  Опционально, старые клиенты не передают и timing просто не пишется. */
  openedAt: z.number().int().positive().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdRaw } = await ctx.params;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ errorCode: "badTaskId", error: "Bad taskId" }, { status: 400 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { errorCode: "invalidBody", error: err.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    return NextResponse.json({ errorCode: "invalidBody", error: "Invalid body" }, { status: 400 });
  }

  // Resolve the link via HMAC signature — see the matching comment in
  // /task-fill/[taskId]/page.tsx for why findFirst() alone is unsafe
  // when two integrations share the same TasksFlow instance.
  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ errorCode: "taskNotFound", error: "Task not found" }, { status: 404 });
  }
  let link: (typeof candidates)[number] | null = null;
  let lastReason = "bad-signature";
  for (const c of candidates) {
    const v = verifyTaskFillToken(parsed.token, c.integration.webhookSecret);
    if (!v.ok) {
      lastReason = v.reason;
      continue;
    }
    if (v.taskId !== taskId) {
      lastReason = "taskId mismatch";
      continue;
    }
    link = c;
    break;
  }
  if (!link) {
    return NextResponse.json(
      { errorCode: "invalidToken", error: `Invalid token (${lastReason})` },
      { status: 401 }
    );
  }

  const adapter = getAdapter(link.journalCode);
  if (!adapter) {
    return NextResponse.json(
      { errorCode: "unsupportedJournal", error: `Журнал «${link.journalCode}» не поддерживается` },
      { status: 400 }
    );
  }

  // Resolve template scope — определяет flow:
  //   personal → каждое POST = upsert, после save TF task = completed
  //   shared   → каждое POST = APPEND новой записи, TF task остаётся
  //              active (закрывается отдельно через close-no-events
  //              или close-with-events). Это event-log семантика для
  //              acceptance / finished_product / complaint_register etc.
  const template = await db.journalTemplate.findFirst({
    where: { code: link.journalCode },
    select: { id: true, taskScope: true },
  });
  const isShared = template?.taskScope === "shared";

  // Compliance gate: when the org enabled requireAdminForJournalEdit
  // and this is a re-submission of an already-completed task by a
  // non-management worker, refuse to overwrite. UI hides the button,
  // but a worker who knows the URL could still POST — block here.
  // ВАЖНО: гейт НЕ применяется к shared-task (event-log) — там
  // повторный POST = новая запись, не редактирование старой.
  if (link.remoteStatus === "completed" && !isShared) {
    const org = await db.organization.findUnique({
      where: { id: link.integration.organizationId },
      select: { requireAdminForJournalEdit: true },
    });
    if (org?.requireAdminForJournalEdit) {
      const actorId = extractEmployeeId(link.rowKey);
      let actorRole: string | null = null;
      if (actorId) {
        const actor = await db.user.findUnique({
          where: { id: actorId },
          select: { role: true },
        });
        actorRole = actor?.role ?? null;
      }
      if (!isManagementRole(actorRole)) {
        return NextResponse.json(
          {
            errorCode: "adminEditOnly", error:
              "Только администраторы могут изменять выполненные записи. Попросите руководителя поправить данные.",
          },
          { status: 403 }
        );
      }
    }
  }

  // Validate values through the adapter's form schema (if any).
  const rawValues = (parsed.values ?? {}) as Record<string, unknown>;
  let sanitized: Record<string, string | number | boolean | null> = {};
  if (adapter.getTaskForm) {
    const schema = await adapter.getTaskForm({
      documentId: link.journalDocumentId,
      rowKey: link.rowKey,
    });
    if (schema) {
      try {
        const validator = buildCompletionValidator(schema);
        sanitized = validator.parse(rawValues) as typeof sanitized;
      } catch (err) {
        if (err instanceof z.ZodError) {
          const issue = err.issues[0];
          const fieldKey = Array.isArray(issue?.path) ? issue?.path[0] : null;
          const fieldLabel =
            schema.fields.find((f) => f.key === fieldKey)?.label ??
            (typeof fieldKey === "string" ? fieldKey : "поле");
          // Подробный лог в pm2 — чтобы понять что прилетело и какие
          // поля валидатор ожидал, при «странных» падениях с прода.
          console.error("[task-fill] validator failed", {
            taskId,
            journalCode: link.journalCode,
            fieldKey,
            fieldLabel,
            issueMessage: issue?.message,
            allIssues: err.issues,
            receivedKeys: Object.keys(rawValues ?? {}),
            expectedKeys: schema.fields.map((f) => ({
              key: f.key,
              type: f.type,
              required: "required" in f ? f.required : undefined,
            })),
          });
          return NextResponse.json(
            {
              errorCode: "fieldInvalid", errorParams: { field: fieldKey ?? "" }, error: `Ошибка валидации поля «${fieldLabel}»: ${
                issue?.message ?? "неизвестно"
              }`,
            },
            { status: 400 }
          );
        }
        throw err;
      }
    } else {
      sanitized = coerceValues(rawValues);
    }
  } else {
    sanitized = coerceValues(rawValues);
  }

  const todayKey = toDateKey(new Date());
  const applied = await adapter.applyRemoteCompletion({
    documentId: link.journalDocumentId,
    rowKey: link.rowKey,
    completed: true,
    todayKey,
    values: sanitized,
  });

  // Для shared-task (event-log) НЕ помечаем TF задачу completed —
  // она остаётся active весь день, чтобы можно было дописать ещё
  // записи. Закроется отдельно через POST /close-no-events с
  // kind="closed-with-events" или auto-cron'ом по shiftEndHour.
  const client = tasksflowClientFor(link.integration);
  if (!isShared) {
    try {
      // Be tolerant of «already completed» — TasksFlow returns 400 if
      // photo required (we never set that flag, so unlikely). Other
      // errors are logged but don't fail the write — journal is the
      // source of truth, the TF task state is secondary.
      await client.completeTask(taskId).catch((err) => {
        if (!(err instanceof TasksFlowError)) throw err;
        console.warn(
          "[task-fill] completeTask non-fatal error",
          err.status,
          err.message
        );
      });
    } catch (err) {
      console.error("[task-fill] completeTask crashed", err);
    }
  }

  // Для shared — НЕ обновляем remoteStatus на completed (остаётся
   // active). Просто бампаем lastDirection как «была активность».
  await db.tasksFlowTaskLink.update({
    where: { id: link.id },
    data: isShared
      ? { lastDirection: "pull" }
      : {
          remoteStatus: "completed",
          completedAt: new Date(),
          lastDirection: "pull",
        },
  });

  // Time-to-fill метрика — best-effort, не валим основной flow.
  // ROOT-аналитика читает это для UX-research'а: какие формы тормозят.
  if (parsed.openedAt && template) {
    const durationMs = Math.max(
      0,
      Math.min(30 * 60 * 1000, Date.now() - parsed.openedAt)
    );
    if (durationMs > 0) {
      const actorId = extractEmployeeId(link.rowKey);
      db.formFillTiming
        .create({
          data: {
            organizationId: link.integration.organizationId,
            templateId: template.id,
            userId: actorId,
            durationMs,
            source: "task-fill",
          },
        })
        .catch((err) =>
          console.warn("[task-fill] timing write failed", err)
        );
    }
  }

  return NextResponse.json({ ok: true, applied, todayKey, isShared });
}

function coerceValues(
  raw: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null
    ) {
      out[k] = v;
    }
  }
  return out;
}
