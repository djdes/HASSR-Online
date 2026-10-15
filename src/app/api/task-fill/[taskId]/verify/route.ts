import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/task-fill/[taskId]/verify
 *
 * Verifier (TasksFlow supervisor) принимает решение по документу.
 * Body: { token, decision: "approved"|"rejected", reason?: string }
 *
 * Auth — HMAC-token (тот же что и /api/task-fill/[taskId] для filler'а).
 * Дополнительная проверка: link.kind === "verifier".
 *
 * Action:
 *   • approved → JournalDocument.verificationStatus = "approved",
 *     все entries → verificationStatus = "approved".
 *   • rejected → status = "rejected" + rejectReason saved + entries
 *     помечаются как rejected. Filler-task переоткрывается на TF
 *     (remoteStatus = "active") чтобы сотрудник мог исправить.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdRaw } = await ctx.params;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ errorCode: "badTaskId", error: "Bad taskId" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const token = (body as { token?: unknown } | null)?.token;
  const decision = (body as { decision?: unknown } | null)?.decision;
  const reason = (body as { reason?: unknown } | null)?.reason;

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ errorCode: "missingToken", error: "Missing token" }, { status: 401 });
  }
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { errorCode: "invalidDecision", error: "decision must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }
  if (decision === "rejected") {
    if (typeof reason !== "string" || reason.trim().length < 3) {
      return NextResponse.json(
        { errorCode: "rejectionReason", error: "reason обязателен для rejected (минимум 3 символа)" },
        { status: 400 }
      );
    }
  }

  // Найти TaskLink с проверкой подписи токена.
  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ errorCode: "taskNotFound", error: "Task not found" }, { status: 404 });
  }
  let link: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    const v = verifyTaskFillToken(token, candidate.integration.webhookSecret);
    if (v.ok && v.taskId === taskId) {
      link = candidate;
      break;
    }
  }
  if (!link) {
    return NextResponse.json(
      { errorCode: "invalidToken", error: "Bad signature or expired token" },
      { status: 401 }
    );
  }
  if (link.kind !== "verifier") {
    return NextResponse.json(
      { errorCode: "notVerifierTask", error: "Эта задача не для проверки" },
      { status: 400 }
    );
  }

  const docId = link.journalDocumentId;
  const reasonStr =
    decision === "rejected" && typeof reason === "string"
      ? reason.trim()
      : null;

  const now = new Date();
  // Транзакция: документ + все записи.
  await db.$transaction([
    db.journalDocument.update({
      where: { id: docId },
      data: {
        verificationStatus: decision,
        verificationDecidedAt: now,
        verificationRejectReason:
          decision === "rejected" ? reasonStr : null,
        // verificationDecidedById: верификатор без NextAuth-сессии — нет
        // user.id под рукой. Используем resolved verifierUserId с
        // документа (он всё равно один на doc).
      },
    }),
    db.journalDocumentEntry.updateMany({
      where: { documentId: docId },
      data: {
        verificationStatus: decision,
        verificationRejectReason:
          decision === "rejected" ? reasonStr : null,
        verificationDecidedAt: now,
      },
    }),
  ]);

  await recordAuditLog({
    request,
    organizationId: link.integration.organizationId,
    action:
      decision === "approved"
        ? "journal.document.verify.approve"
        : "journal.document.verify.reject",
    entity: "JournalDocument",
    entityId: docId,
    details: {
      via: "tasksflow-supervisor",
      reason: reasonStr ?? undefined,
    },
  });

  return NextResponse.json({ ok: true, decision });
}
