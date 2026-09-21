import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decideClaim, normalizeTaskFlowMode } from "@/lib/journal-task-flow-rules";

/**
 * Race-claim helpers для journal task pool. Базовая модель — общая
 * для всех журналов: cleaning rooms, cold-equipment fridges,
 * climate-control areas, finished-product brakerage, и т.п.
 *
 * Семантика:
 *   - claim()    — атомарно «забрать» задачу. Возвращает claim или
 *                  существующий active claim другого юзера (race-loss).
 *   - release()  — отпустить задачу без выполнения (передумал).
 *   - complete() — завершить задачу. Other-user claims остаются
 *                  заблокированными — winner take all.
 *   - getActiveClaimForUser() — для one-active-task rule: пока у юзера
 *                  есть active claim, нельзя брать другие.
 *
 * Race-safety: unique constraint
 * `(organizationId, journalCode, scopeKey, status)` гарантирует, что
 * параллельные claim()-ы не создадут две active записи. Один из них
 * упадёт с P2002 — мы ловим это и отдаём существующий claim.
 *
 * Date-component в scopeKey:
 *   формат `<resourceType>:<resourceId>:<extra...>:<YYYY-MM-DD>`.
 *   Например: `room:abc123:2026-04-29` — на следующий день scopeKey
 *   становится другим, claim возможен заново.
 */

export type ClaimResult =
  | { ok: true; claim: ClaimRow; createdNew: true }
  | { ok: true; claim: ClaimRow; createdNew: false } // уже взято этим же юзером (idempotent)
  | { ok: false; reason: "taken_by_other"; claim: ClaimRow }
  | { ok: false; reason: "user_has_active"; activeClaim: ClaimRow }
  | { ok: false; reason: "scope_completed" }
  /** Режим «Только руководитель назначает»: сотрудник сам не берёт. */
  | { ok: false; reason: "manual_mode" }
  | { ok: false; reason: "internal_error" };

export type ClaimRow = {
  id: string;
  organizationId: string;
  journalCode: string;
  scopeKey: string;
  scopeLabel: string;
  dateKey: Date;
  userId: string;
  userName?: string | null;
  status: "active" | "completed" | "released" | "expired";
  claimedAt: Date;
  completedAt: Date | null;
  releasedAt: Date | null;
  parentHint: string | null;
  entryId: string | null;
  tasksFlowTaskId: string | null;
};

/**
 * Возвращает taskFlowMode организации. По умолчанию "race".
 *   - race   — стандарт. Один active claim per scope, остальные блокируются.
 *   - shared — все могут заполнять параллельно. one-active-task игнорируется.
 *   - manual — обычные сотрудники не могут claim, только admin force-assign'ом.
 */
export async function getTaskFlowMode(
  organizationId: string
): Promise<"race" | "shared" | "manual"> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { taskFlowMode: true },
  });
  return normalizeTaskFlowMode(org?.taskFlowMode);
}

/**
 * Атомарный claim. Если у юзера уже есть другая active-задача — отказ
 * (one-active-task rule). Если scope уже взят кем-то другим — отдаём
 * existing.
 *
 * В "shared" режиме: bypassActiveCheck автоматически true, разрешаем
 * параллельные active claims разными юзерами на тот же scope (но unique-
 * constraint всё равно один-в-один — это ограничение схемы; для shared
 * фактически берёт первый, остальные используют existing claim напрямую).
 */
export async function claimJournalTask(args: {
  organizationId: string;
  journalCode: string;
  scopeKey: string;
  scopeLabel: string;
  dateKey: Date;
  userId: string;
  parentHint?: string | null;
  tasksFlowTaskId?: string | null;
  /** Если true — обходим one-active-task rule (например, ROOT
   *  заполняет за сотрудника, или admin-override). Это и есть
   *  «назначение руководителем»: разрешено в любом режиме. */
  bypassActiveCheck?: boolean;
  /** У того, кто берёт задачу себе, есть право назначать (руководитель,
   *  ROOT) — в режиме `manual` ему самостоятельное взятие разрешено. */
  actorCanAssign?: boolean;
}): Promise<ClaimResult> {
  // 1) Проверяем completed — может быть scope уже завершён.
  const completed = await db.journalTaskClaim.findFirst({
    where: {
      organizationId: args.organizationId,
      journalCode: args.journalCode,
      scopeKey: args.scopeKey,
      status: "completed",
    },
    select: { id: true },
  });
  if (completed) return { ok: false, reason: "scope_completed" };

  // 2) Режим распределения: в `manual` сотрудник сам не берёт;
  //    правило «одна активная задача» — везде, кроме `shared`.
  const flowMode = await getTaskFlowMode(args.organizationId);
  const decision = decideClaim({
    mode: flowMode,
    assignedByManager: args.bypassActiveCheck === true,
    actorCanAssign: args.actorCanAssign === true,
  });
  if (!decision.allowed) return { ok: false, reason: "manual_mode" };
  if (decision.enforceOneActive) {
    const active = await db.journalTaskClaim.findFirst({
      where: {
        organizationId: args.organizationId,
        userId: args.userId,
        status: "active",
      },
    });
    if (active) {
      // Если active — это тот же scope, возвращаем idempotent.
      if (
        active.journalCode === args.journalCode &&
        active.scopeKey === args.scopeKey
      ) {
        return { ok: true, claim: rowFromDb(active), createdNew: false };
      }
      return { ok: false, reason: "user_has_active", activeClaim: rowFromDb(active) };
    }
  }

  // 3) Атомарный insert; race-protection через unique.
  try {
    const created = await db.journalTaskClaim.create({
      data: {
        organizationId: args.organizationId,
        journalCode: args.journalCode,
        scopeKey: args.scopeKey,
        scopeLabel: args.scopeLabel,
        dateKey: args.dateKey,
        userId: args.userId,
        status: "active",
        parentHint: args.parentHint ?? null,
        tasksFlowTaskId: args.tasksFlowTaskId ?? null,
      },
    });
    return { ok: true, claim: rowFromDb(created), createdNew: true };
  } catch (err) {
    // Race-loss: P2002 unique violation на (org, code, scope, status=active).
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await db.journalTaskClaim.findFirst({
        where: {
          organizationId: args.organizationId,
          journalCode: args.journalCode,
          scopeKey: args.scopeKey,
          status: "active",
        },
      });
      if (winner) {
        if (winner.userId === args.userId) {
          return { ok: true, claim: rowFromDb(winner), createdNew: false };
        }
        return { ok: false, reason: "taken_by_other", claim: rowFromDb(winner) };
      }
    }
    return { ok: false, reason: "internal_error" };
  }
}

/**
 * Отпустить активную задачу — например, передумал, передал коллеге.
 * Можно сделать только своему claim'у, проверяет ownership.
 */
export async function releaseJournalTask(args: {
  claimId: string;
  userId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const claim = await db.journalTaskClaim.findUnique({
    where: { id: args.claimId },
  });
  if (!claim) return { ok: false, reason: "not_found" };
  if (claim.userId !== args.userId) return { ok: false, reason: "not_owner" };
  if (claim.status !== "active") return { ok: false, reason: "not_active" };

  await db.journalTaskClaim.update({
    where: { id: args.claimId },
    data: { status: "released", releasedAt: new Date() },
  });
  return { ok: true };
}

/**
 * Завершить задачу. entryId — необязательно, можно поставить позже.
 */
export async function completeJournalTask(args: {
  claimId: string;
  userId: string;
  entryId?: string;
  /** Снимок form-data — для verification UI заведующей. */
  completionData?: Record<string, unknown>;
}): Promise<{ ok: boolean; reason?: string }> {
  const claim = await db.journalTaskClaim.findUnique({
    where: { id: args.claimId },
  });
  if (!claim) return { ok: false, reason: "not_found" };
  if (claim.userId !== args.userId) return { ok: false, reason: "not_owner" };
  if (claim.status !== "active") return { ok: false, reason: "not_active" };

  await db.journalTaskClaim.update({
    where: { id: args.claimId },
    data: {
      status: "completed",
      completedAt: new Date(),
      entryId: args.entryId ?? claim.entryId ?? null,
      verificationStatus: "pending",
      // Перезаписываем completionData при каждом complete (например, после
      // переделки от заведующей — новые данные).
      ...(args.completionData
        ? { completionData: args.completionData as never }
        : {}),
    },
  });
  return { ok: true };
}

/**
 * One-active-task rule helper. Возвращает active claim юзера если
 * есть. UI кнопки «Взять» disabled если результат не null + tooltip
 * «Сначала заверши <parentHint>».
 */
export async function getActiveClaimForUser(
  userId: string,
  organizationId: string
): Promise<ClaimRow | null> {
  const active = await db.journalTaskClaim.findFirst({
    where: { organizationId, userId, status: "active" },
    orderBy: { claimedAt: "desc" },
  });
  return active ? rowFromDb(active) : null;
}

/**
 * Список claims по журналу/дате — для UI render «занято Ивановым»
 * у конкретных scope'ов.
 */
export async function listClaimsForJournal(args: {
  organizationId: string;
  journalCode: string;
  dateKey: Date;
}): Promise<ClaimRow[]> {
  const dayStart = new Date(
    Date.UTC(
      args.dateKey.getUTCFullYear(),
      args.dateKey.getUTCMonth(),
      args.dateKey.getUTCDate()
    )
  );
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const claims = await db.journalTaskClaim.findMany({
    where: {
      organizationId: args.organizationId,
      journalCode: args.journalCode,
      dateKey: { gte: dayStart, lt: dayEnd },
    },
    include: { user: { select: { name: true } } },
    orderBy: { claimedAt: "asc" },
  });
  return claims.map((c) => ({ ...rowFromDb(c), userName: c.user.name }));
}

/**
 * Auto-expire claims, которые висят active слишком долго. Например,
 * сотрудник взял задачу, ушёл со смены, не завершил и не отпустил.
 * Crone дёргает раз в час и помечает status=expired для тех, у кого
 * claimedAt > now - hours.
 */
export async function expireStaleClaims(hoursOld: number): Promise<number> {
  const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
  const result = await db.journalTaskClaim.updateMany({
    where: { status: "active", claimedAt: { lt: cutoff } },
    data: { status: "expired" },
  });
  return result.count;
}

/* ---------- internal ---------- */

function rowFromDb(row: {
  id: string;
  organizationId: string;
  journalCode: string;
  scopeKey: string;
  scopeLabel: string;
  dateKey: Date;
  userId: string;
  status: string;
  claimedAt: Date;
  completedAt: Date | null;
  releasedAt: Date | null;
  parentHint: string | null;
  entryId: string | null;
  tasksFlowTaskId: string | null;
}): ClaimRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    journalCode: row.journalCode,
    scopeKey: row.scopeKey,
    scopeLabel: row.scopeLabel,
    dateKey: row.dateKey,
    userId: row.userId,
    status: row.status as ClaimRow["status"],
    claimedAt: row.claimedAt,
    completedAt: row.completedAt,
    releasedAt: row.releasedAt,
    parentHint: row.parentHint,
    entryId: row.entryId,
    tasksFlowTaskId: row.tasksFlowTaskId,
  };
}
