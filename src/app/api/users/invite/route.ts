import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendInviteTokenEmail } from "@/lib/email";
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from "@/lib/invite-tokens";
import {
  isManagementRole,
  toCanonicalUserRole,
  USER_ROLE_VALUES,
} from "@/lib/user-roles";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";
import { ensurePlanForHeadcount } from "@/lib/plan-limits.server";
import { checkSeatsForActivation, seatLimitResponse } from "@/lib/billing.server";

const inviteUserSchema = z.object({
  name: z.string().min(2, "Имя должно содержать минимум 2 символа"),
  email: z.string().email("Введите корректный email"),
  role: z.enum(USER_ROLE_VALUES, { message: "Выберите роль" }),
  phone: z.string().optional(),
  // Опциональная привязка к должности — заполняет UserJournalAccess
  // сразу, без legacy back-compat «видишь всё».
  jobPositionId: z.string().min(1).optional(),
});

/**
 * POST /api/users/invite
 *
 * Creates a placeholder User (isActive=false, empty passwordHash) plus a
 * one-shot InviteToken. Emails a /invite/<raw> URL to the new employee —
 * no raw password is ever persisted or transmitted. The employee clicks
 * the link, sets their password via POST /api/invite/[token]/accept, and
 * the user is activated.
 *
 * Breaking change vs the old flow: the `password` field is no longer
 * accepted. Callers must migrate to the invite-link flow.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    // head_chef нанимает поваров напрямую — должен мочь рассылать
    // email-приглашения. Раньше: только manager (плюс isRoot).
    // Согласовано с /api/staff/[id]/invite-tg (commit ab1d96dd).
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }

    const body = await request.json();
    const data = inviteUserSchema.parse(body);

    const existingUser = await db.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      return NextResponse.json(
        { error: "Пользователь с таким email уже существует" },
        { status: 409 }
      );
    }

    const raw = generateInviteToken();
    const tokenHash = hashInviteToken(raw);
    const expiresAt = inviteExpiresAt();
    const organizationId = getActiveOrgId(session);

    // Position-based ACL pre-population. Mirror /api/staff и /api/users/invite/tg.
    let positionTemplates: Array<{ template: { code: string } }> = [];
    let positionTitle: string | null = null;
    if (data.jobPositionId) {
      const position = await db.jobPosition.findFirst({
        where: { id: data.jobPositionId, organizationId },
        select: { id: true, name: true },
      });
      if (!position) {
        return NextResponse.json(
          { error: "Должность не найдена в организации" },
          { status: 404 }
        );
      }
      positionTitle = position.name;
      positionTemplates = await db.jobPositionJournalAccess.findMany({
        where: { organizationId, jobPositionId: position.id },
        include: { template: { select: { code: true } } },
      });
    }
    const useStrictAcl = positionTemplates.length > 0;

    // Приглашённый станет активным, когда примет приглашение, — место
    // проверяем уже сейчас, чтобы руководитель узнал о лимите сразу, а не
    // сотрудник у двери (при принятии проверка повторяется).
    const seats = await checkSeatsForActivation(organizationId, 1, { source: "users.invite" });
    if (!seats.ok) return seatLimitResponse(seats);

    const { user } = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash: "",
          role: toCanonicalUserRole(data.role),
          phone: data.phone || null,
          organizationId,
          isActive: false,
          jobPositionId: data.jobPositionId ?? null,
          positionTitle,
          journalAccessMigrated: useStrictAcl,
        },
      });
      if (useStrictAcl) {
        await tx.userJournalAccess.createMany({
          data: positionTemplates.map((t) => ({
            userId: user.id,
            templateCode: t.template.code,
            canRead: true,
            canWrite: true,
            canFinalize: false,
          })),
          skipDuplicates: true,
        });
      }
      await tx.inviteToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
      return { user };
    });

    // До конца бесплатного периода при превышении лимита организация тихо
    // переходит на подписку (как раньше).
    const planCheck = await ensurePlanForHeadcount(organizationId);

    const inviteUrl = buildInviteUrl(raw);
    sendInviteTokenEmail({
      to: user.email,
      name: user.name,
      organizationName: session.user.organizationName,
      inviteUrl,
      organizationId,
    }).catch((err) => console.error("sendInviteTokenEmail failed", err));

    // Auto-link с TasksFlow по номеру (П-8 спека 2026-05-09).
    // Если phone указан И в TF есть юзер с таким же phone → INSERT
    // TasksFlowUserLink. Если в TF нет — TF user будет создан.
    // Best-effort: ошибки сети/disabled integration не валят invite.
    if (data.phone) {
      tryAutolinkTasksflowByPhone({
        organizationId,
        weSetupUserId: user.id,
        phone: data.phone,
        name: user.name,
      }).catch((err) =>
        console.error("[invite] tryAutolinkTasksflowByPhone failed", err),
      );
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        planUpgraded: planCheck.upgraded,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Некорректные данные",
          details: error.issues,
        },
        { status: 400 }
      );
    }
    console.error("User invite error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
