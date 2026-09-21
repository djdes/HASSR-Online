import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import {
  completeJournalTask,
  releaseJournalTask,
} from "@/lib/journal-task-claims";
import { db } from "@/lib/db";
import {
  validateCompletion,
  type SideEffect,
} from "@/lib/journal-completion-validators";
import { notifyOrganization } from "@/lib/telegram";
import { mirrorClaimToTasksFlow } from "@/lib/tasksflow-claim-mirror";
import { recordAuditLog } from "@/lib/audit-log";
import {
  checkSkipReason,
  parseSkipReasonPolicy,
  type SkipReasonPolicy,
} from "@/lib/no-events-reason";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 *   POST   /api/journal-task-claims/[id]/release   — отпустить
 *   POST   /api/journal-task-claims/[id]/complete  — завершить (опц. entryId)
 *   DELETE /api/journal-task-claims/[id]          — alias на release
 *
 * Single endpoint с action-в-теле для проще роутинга:
 *   POST /api/journal-task-claims/[id]
 *   body: { action: "release" | "complete", entryId?: string }
 */

const bodySchema = z.object({
  action: z.enum(["release", "complete", "skip"]),
  entryId: z.string().optional(),
  /** Form-payload для validator. Если задан — будет провалидирован
   *  через journal-completion-validators до записи complete.
   *  Side-effects (CAPA, Telegram) запускаются после успешной валидации. */
  data: z.record(z.string(), z.unknown()).optional(),
  /** Для action=skip — причина почему сегодня не требуется. */
  skipReason: z.string().max(300).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const userId = session.user.id;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  // На action=skip — задача отмечается как «сегодня не требуется».
  // Без валидаторов, без side-effects, но с двумя обязательными
  // условиями: руководитель разрешил пропуск для этого журнала
  // (`JournalTemplate.allowNoEvents`) и сотрудник написал причину.
  // Пропуск уходит заведующей на проверку наравне с обычной задачей —
  // иначе «Сегодня не требуется» превращалось в кнопку «закрыть день
  // не глядя», и в /verifications эта запись не появлялась вовсе.
  if (body.action === "skip") {
    const claim = await db.journalTaskClaim.findUnique({ where: { id } });
    if (!claim) {
      return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    }
    if (claim.userId !== userId) {
      return NextResponse.json({ ok: false, reason: "not_owner" }, { status: 403 });
    }
    if (claim.status !== "active") {
      return NextResponse.json({ ok: false, reason: "not_active" }, { status: 409 });
    }
    const skipSettings = await journalSkipSettings(claim.journalCode);
    if (!skipSettings.allowSkip) {
      return NextResponse.json(
        {
          ok: false,
          reason: "skip_not_allowed",
          message:
            "Для этого журнала пропуск не разрешён. Обратитесь к руководителю",
        },
        { status: 403 }
      );
    }
    // Причина — из списка журнала; свой текст — только если разрешён.
    const reasonCheck = checkSkipReason(body.skipReason, skipSettings.policy);
    if (!reasonCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: reasonCheck.code,
          message: reasonCheck.message,
          error: reasonCheck.message,
        },
        { status: 400 }
      );
    }
    const skipReason = reasonCheck.reason;
    await db.journalTaskClaim.update({
      where: { id },
      data: {
        status: "completed",
        completedAt: new Date(),
        // Как обычная выполненная задача: заведующая увидит её в
        // «Ждут проверки» и решит, был ли пропуск оправдан.
        verificationStatus: "pending",
        completionData: {
          skipped: true,
          reason: skipReason,
        } as never,
      },
    });
    // Mirror в TF (если есть) — completeTask, чтобы и там не висело.
    void mirrorClaimToTasksFlow({
      organizationId: claim.organizationId,
      journalCode: claim.journalCode,
      scopeKey: claim.scopeKey,
      userId: claim.userId,
      event: "complete",
    }).catch(() => null);
    await recordAuditLog({
      request,
      session,
      organizationId: claim.organizationId,
      action: "task.skip",
      entity: "journal_task",
      entityId: claim.id,
      details: {
        journalCode: claim.journalCode,
        task: claim.scopeLabel,
        reason: skipReason,
      },
    });
    return NextResponse.json({ ok: true, skipped: true });
  }

  // На complete — если передан form-payload, валидируем и запускаем
  // side-effects (CAPA / Telegram) перед фиксацией claim'а.
  //
  // ВАЖНО: проверку ownership делаем ДО validateCompletion. Иначе
  // юзер A мог бы триггерить side-effects (CAPA, Telegram alert) на
  // claim'е юзера B — и завершение не происходит, но CAPA уже
  // создан, заведующая получает ложный alert.
  let validationWarnings: { message: string }[] = [];
  if (body.action === "complete" && body.data) {
    const claim = await db.journalTaskClaim.findUnique({
      where: { id },
      include: { user: { select: { name: true } } },
    });
    if (!claim) {
      return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    }
    if (claim.userId !== userId) {
      return NextResponse.json({ ok: false, reason: "not_owner" }, { status: 403 });
    }
    if (claim.status !== "active") {
      return NextResponse.json({ ok: false, reason: "not_active" }, { status: 409 });
    }
    const validation = await validateCompletion({
      organizationId: claim.organizationId,
      journalCode: claim.journalCode,
      scopeKey: claim.scopeKey,
      scopeLabel: claim.scopeLabel,
      userId: claim.userId,
      userName: claim.user.name,
      data: body.data,
    });
    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, reason: "validation_failed", errors: validation.errors },
        { status: 400 }
      );
    }
    validationWarnings = validation.warnings;
    await runSideEffects(claim.organizationId, validation.sideEffects);
  }

  const fn =
    body.action === "release"
      ? () => releaseClaim(id, userId)
      : () =>
          completeJournalTask({
            claimId: id,
            userId,
            entryId: body.entryId,
            completionData: body.data,
          });

  const result = await fn();
  if (!result.ok) {
    const map: Record<string, number> = {
      not_found: 404,
      not_owner: 403,
      not_active: 409,
    };
    return NextResponse.json(
      { ok: false, reason: result.reason ?? "internal_error" },
      { status: map[result.reason ?? ""] ?? 500 }
    );
  }

  // После успеха — зеркалим в TasksFlow (background, не блокирует ответ).
  const mirrorClaim = await db.journalTaskClaim.findUnique({ where: { id } });
  if (mirrorClaim) {
    await recordAuditLog({
      request,
      session,
      organizationId: mirrorClaim.organizationId,
      action: body.action === "complete" ? "task.complete" : "task.release",
      entity: "journal_task",
      entityId: mirrorClaim.id,
      details: {
        journalCode: mirrorClaim.journalCode,
        task: mirrorClaim.scopeLabel,
      },
    });
    void mirrorClaimToTasksFlow({
      organizationId: mirrorClaim.organizationId,
      journalCode: mirrorClaim.journalCode,
      scopeKey: mirrorClaim.scopeKey,
      userId: mirrorClaim.userId,
      event: body.action === "complete" ? "complete" : "release",
    }).catch(() => null);
  }
  return NextResponse.json({ ok: true, warnings: validationWarnings });
}

/**
 * Разрешил ли руководитель пропуск «сегодня не требуется» для журнала.
 *
 * Тумблер живёт в `/settings/journals/<code>/scope`. Кнопка в приложении
 * его не читала вовсе — запрет ничего не запрещал.
 */
async function journalSkipSettings(
  journalCode: string
): Promise<{ allowSkip: boolean; policy: SkipReasonPolicy }> {
  const template = await db.journalTemplate.findUnique({
    where: { code: journalCode },
    select: {
      allowNoEvents: true,
      noEventsReasons: true,
      allowFreeTextReason: true,
    },
  });
  return {
    // Шаблона нет — считаем, что запрета не ставили.
    allowSkip: template?.allowNoEvents !== false,
    policy: parseSkipReasonPolicy(template),
  };
}

/**
 * GET /api/journal-task-claims/[id] — одна задача по её id.
 *
 * Экран задачи раньше искал себя в «моей текущей задаче» и при
 * расхождении писал «уже закрыта или её взял другой сотрудник». У
 * человека с зависшей вчерашней задачей это была неправда: задача его,
 * просто не самая свежая. Отдаём ровно запрошенную.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const claim = await db.journalTaskClaim.findUnique({
    where: { id },
    include: { verifiedBy: { select: { name: true } } },
  });
  if (!claim) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  if (claim.userId !== session.user.id) {
    return NextResponse.json({ ok: false, reason: "not_owner" }, { status: 403 });
  }
  if (claim.status !== "active") {
    return NextResponse.json({ ok: false, reason: "not_active" }, { status: 409 });
  }

  // Норма температуры — из карточки оборудования этой задачи
  // (`scopeKey` вида `fridge:<equipmentId>:<смена>:<дата>`). Поле ввода
  // в приложении рисует ту же подсказку и тот же старт степпера, что и
  // журнал на сайте.
  let temperatureNorm: { min: number | null; max: number | null } | null = null;
  const fridge = /^fridge:([^:]+):/.exec(claim.scopeKey);
  if (fridge) {
    const equipment = await db.equipment.findUnique({
      where: { id: fridge[1] },
      select: { tempMin: true, tempMax: true },
    });
    if (equipment && (equipment.tempMin !== null || equipment.tempMax !== null)) {
      temperatureNorm = { min: equipment.tempMin, max: equipment.tempMax };
    }
  }

  const skipSettings = await journalSkipSettings(claim.journalCode);

  return NextResponse.json({
    claim: {
      id: claim.id,
      journalCode: claim.journalCode,
      scopeKey: claim.scopeKey,
      scopeLabel: claim.scopeLabel,
      parentHint: claim.parentHint,
      status: claim.status,
      dateKey: claim.dateKey.toISOString().slice(0, 10),
      // Отказ заведующей: без этих полей повар видел обычную активную
      // задачу и пустую форму — «Переделать» до него не доходило.
      verificationStatus: claim.verificationStatus,
      verifierComment: claim.verifierComment,
      verifiedByName: claim.verifiedBy?.name ?? null,
      completionData:
        (claim.completionData as Record<string, unknown> | null) ?? null,
      temperatureNorm,
      // Кнопку «Сегодня не требуется» показываем только там, где
      // руководитель разрешил пропуск.
      allowSkip: skipSettings.allowSkip,
      // Готовые причины пропуска и можно ли написать свою — экран
      // показывает кнопки-варианты и поле только при разрешении.
      skipReasons: skipSettings.policy.reasons,
      allowFreeTextReason: skipSettings.policy.allowFreeText,
    },
  });
}

/**
 * Вернуть задачу в общий список.
 *
 * В схеме стоит `@@unique(organizationId, journalCode, scopeKey, status)`:
 * «отпущенная» строка на одну задачу может быть только одна. Когда
 * сотрудник второй раз за день берёт и возвращает ту же задачу, запись
 * упиралась в это ограничение, и запрос падал пустым 500 — в приложении
 * это выглядело как кнопка, которая молча не работает. В отпущенной
 * строке ничего заполненного нет, поэтому прошлую убираем и повторяем.
 */
async function releaseClaim(
  claimId: string,
  userId: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    return await releaseJournalTask({ claimId, userId });
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    const claim = await db.journalTaskClaim.findUnique({ where: { id: claimId } });
    if (!claim) return { ok: false, reason: "not_found" };
    await db.journalTaskClaim.deleteMany({
      where: {
        organizationId: claim.organizationId,
        journalCode: claim.journalCode,
        scopeKey: claim.scopeKey,
        status: "released",
        id: { not: claimId },
      },
    });
    return await releaseJournalTask({ claimId, userId });
  }
}

async function runSideEffects(organizationId: string, effects: SideEffect[]) {
  for (const e of effects) {
    if (e.kind === "create_capa") {
      try {
        await db.capaTicket.create({
          data: {
            organizationId,
            title: e.title,
            description: e.data ? JSON.stringify(e.data, null, 2) : null,
            priority: e.severity === "high" ? "high" : e.severity === "low" ? "low" : "medium",
            category: "journal-anomaly",
            sourceType: "journal-claim",
          },
        });
      } catch (err) {
        console.error("[journal-claim] create_capa failed", err);
      }
    } else if (e.kind === "telegram_alert") {
      try {
        await notifyOrganization(
          organizationId,
          e.message,
          e.recipients === "owners" ? ["owner", "manager"] : ["manager", "head_chef"]
        );
      } catch (err) {
        console.error("[journal-claim] telegram_alert failed", err);
      }
    }
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const result = await releaseClaim(id, session.user.id);
  if (result.ok) {
    const released = await db.journalTaskClaim.findUnique({ where: { id } });
    if (released) {
      await recordAuditLog({
        request,
        session,
        organizationId: released.organizationId,
        action: "task.release",
        entity: "journal_task",
        entityId: released.id,
        details: { journalCode: released.journalCode, task: released.scopeLabel },
      });
    }
  }
  if (!result.ok) {
    const map: Record<string, number> = {
      not_found: 404,
      not_owner: 403,
      not_active: 409,
    };
    return NextResponse.json(
      { ok: false, reason: result.reason ?? "internal_error" },
      { status: map[result.reason ?? ""] ?? 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
