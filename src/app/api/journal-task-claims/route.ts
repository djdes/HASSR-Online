import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import {
  claimJournalTask,
  listClaimsForJournal,
} from "@/lib/journal-task-claims";
import { mirrorClaimToTasksFlow } from "@/lib/tasksflow-claim-mirror";
import { db } from "@/lib/db";
import { canWriteJournal, hasJournalAccess } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { MANUAL_MODE_CLAIM_MESSAGE } from "@/lib/journal-task-flow-rules";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Race-claim API — единый endpoint для всех журналов которые работают
 * по pool-модели (cleaning rooms, cold-equipment fridges, climate
 * areas, finished-product brakerage, и т.п.).
 *
 *   POST /api/journal-task-claims
 *     body: { journalCode, scopeKey, scopeLabel, dateKey: "YYYY-MM-DD",
 *             parentHint?: string }
 *     → { ok: true, claim } если взято;
 *       409 + { reason: "taken_by_other"|"user_has_active"|"scope_completed" }
 *       и существующий claim для UI render.
 *
 *   GET /api/journal-task-claims?journalCode=X&date=YYYY-MM-DD
 *     → { claims: [...] } — для отображения «занято Ивановым»
 *       и one-active-task UI feedback.
 *
 * Семантика scopeKey формируется на клиенте — для consistency между
 * read и write пути. Например: `room:<roomId>:<YYYY-MM-DD>`.
 */

const postSchema = z.object({
  journalCode: z.string().min(1),
  scopeKey: z.string().min(1),
  scopeLabel: z.string().min(1),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  parentHint: z.string().nullish(),
  tasksFlowTaskId: z.string().nullish(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const organizationId = getActiveOrgId(session);
  const userId = session.user.id;

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const dateKey = new Date(`${body.dateKey}T00:00:00.000Z`);
  if (Number.isNaN(dateKey.getTime())) {
    return NextResponse.json({ error: "Невалидная дата" }, { status: 400 });
  }

  // ACL: claim — это write-precursor. Без этого юзер с доступом
  // только к cleaning мог spam-claim'ать med_books / cold_equipment,
  // блокируя реальных исполнителей и создавая верификацию у
  // заведующей под чужим именем.
  const aclActor = {
    id: userId,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (!(await canWriteJournal(aclActor, body.journalCode))) {
    return NextResponse.json(
      { error: "Нет доступа к этому журналу" },
      { status: 403 }
    );
  }

  const result = await claimJournalTask({
    organizationId,
    journalCode: body.journalCode,
    scopeKey: body.scopeKey,
    scopeLabel: body.scopeLabel,
    dateKey,
    userId,
    parentHint: body.parentHint ?? null,
    tasksFlowTaskId: body.tasksFlowTaskId ?? null,
    actorCanAssign:
      session.user.isRoot === true || hasCapability(session.user, "admin.full"),
  });

  if (!result.ok && result.reason === "manual_mode") {
    return NextResponse.json(
      {
        ok: false,
        reason: "manual_mode",
        error: MANUAL_MODE_CLAIM_MESSAGE,
        message: MANUAL_MODE_CLAIM_MESSAGE,
      },
      { status: 403 }
    );
  }

  if (result.ok) {
    if (result.createdNew) {
      await recordAuditLog({
        request,
        session,
        organizationId,
        action: "task.claim",
        entity: "journal_task",
        entityId: result.claim.id,
        details: {
          journalCode: body.journalCode,
          task: body.scopeLabel,
        },
      });
    }
    // Mirror в TasksFlow если есть active integration + task link.
    // Не блокирует ответ при ошибке — graceful degrade.
    void mirrorClaimToTasksFlow({
      organizationId,
      journalCode: body.journalCode,
      scopeKey: body.scopeKey,
      userId,
      event: "claim",
    })
      .then(async (m) => {
        if (m.tasksFlowTaskId) {
          await db.journalTaskClaim.update({
            where: { id: result.claim.id },
            data: { tasksFlowTaskId: String(m.tasksFlowTaskId) },
          }).catch(() => null);
        }
      })
      .catch(() => null);
    return NextResponse.json({ ok: true, claim: result.claim, createdNew: result.createdNew });
  }

  if (result.reason === "taken_by_other") {
    return NextResponse.json(
      {
        ok: false,
        reason: "taken_by_other",
        claim: result.claim,
        message: "Задача уже взята другим сотрудником",
      },
      { status: 409 }
    );
  }
  if (result.reason === "user_has_active") {
    return NextResponse.json(
      {
        ok: false,
        reason: "user_has_active",
        activeClaim: result.activeClaim,
        // На «вы»: остальные экраны приложения обращаются так же.
        message: `Сначала завершите «${result.activeClaim.parentHint || result.activeClaim.scopeLabel}» — или верните её в общий список.`,
      },
      { status: 409 }
    );
  }
  if (result.reason === "scope_completed") {
    return NextResponse.json(
      { ok: false, reason: "scope_completed", message: "Задача уже выполнена" },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { ok: false, reason: "internal_error", message: "Ошибка" },
    { status: 500 }
  );
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const organizationId = getActiveOrgId(session);
  const url = new URL(request.url);
  const journalCode = url.searchParams.get("journalCode");
  const date = url.searchParams.get("date");
  if (!journalCode || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Параметры journalCode и date (YYYY-MM-DD) обязательны" },
      { status: 400 }
    );
  }
  const aclActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (!(await hasJournalAccess(aclActor, journalCode))) {
    return NextResponse.json(
      { error: "Нет доступа к этому журналу" },
      { status: 403 }
    );
  }
  const dateKey = new Date(`${date}T00:00:00.000Z`);
  const claims = await listClaimsForJournal({
    organizationId,
    journalCode,
    dateKey,
  });
  return NextResponse.json({ claims });
}
