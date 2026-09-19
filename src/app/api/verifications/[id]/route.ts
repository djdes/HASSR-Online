import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { notifyEmployee } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/verifications/[id]
 *
 *   body: { action: "approve" | "reject", comment?: string }
 *
 * Заведующая одобряет или отклоняет выполненную задачу. Reject
 * возвращает claim в active со статусом verification=rejected — UI
 * сотрудника видит «Переделать: <comment>» и может исправить.
 *
 * Approve проставляет verificationStatus=approved, фиксирует
 * verifiedById + verifiedAt.
 *
 * Сотрудник получает Telegram-нотификацию о решении.
 */
const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasCapability(session.user, "tasks.verify")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const claim = await db.journalTaskClaim.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, telegramChatId: true } } },
  });
  if (!claim) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  // Мультиарендность: задача чужой организации не должна подтверждаться
  // отсюда — id приходит от клиента и ничем больше не ограничен.
  if (claim.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  // Повторное «Одобрить» — не ошибка и не переписывает, кто и когда
  // проверил первым (дедуп по verifiedAt, П-14).
  if (body.action === "approve" && claim.verificationStatus === "approved") {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }
  if (claim.status !== "completed") {
    return NextResponse.json(
      { error: "Задача не в статусе completed" },
      { status: 409 }
    );
  }

  if (body.action === "approve") {
    await db.journalTaskClaim.update({
      where: { id },
      data: {
        verificationStatus: "approved",
        verifiedById: session.user.id,
        verifiedAt: new Date(),
        verifierComment: body.comment ?? null,
      },
    });

    // Уведомляем сотрудника в TG.
    if (claim.user.telegramChatId) {
      await notifyEmployee(
        claim.user.id,
        `✅ <b>${claim.scopeLabel}</b> — проверено и одобрено${body.comment ? `\n\n${escape(body.comment)}` : ""}`
      ).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }

  // Reject: возвращаем claim в active, чтобы сотрудник мог переделать.
  await db.journalTaskClaim.update({
    where: { id },
    data: {
      status: "active",
      verificationStatus: "rejected",
      verifiedById: session.user.id,
      verifiedAt: new Date(),
      verifierComment: body.comment ?? null,
      completedAt: null,
    },
  });

  if (claim.user.telegramChatId) {
    await notifyEmployee(
      claim.user.id,
      `↩️ <b>${claim.scopeLabel}</b> — нужно переделать${body.comment ? `\n\n<b>Комментарий:</b> ${escape(body.comment)}` : ""}`
    ).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
