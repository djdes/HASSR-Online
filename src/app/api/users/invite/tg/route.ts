import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { brandQrPngDataUrl } from "@/lib/brand-qr";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { ensurePlanForHeadcount } from "@/lib/plan-limits.server";
import { getServerSession } from "@/lib/server-session";
import {
  botInviteExpiresAt,
  buildBotInviteUrl,
  generateBotInviteRaw,
  hashBotInviteToken,
} from "@/lib/bot-invite-tokens";
import {
  isManagementRole,
  toCanonicalUserRole,
  USER_ROLE_VALUES,
} from "@/lib/user-roles";

/**
 * POST /api/users/invite/tg
 *
 * Sibling of POST /api/users/invite — intentionally a separate route because
 * the semantics differ significantly:
 *
 *   - No email is required and none is sent.
 *   - `passwordHash` stays empty forever (the user authenticates via the
 *     Telegram `initData` signature instead of a password).
 *   - A `BotInviteToken` row (not `InviteToken`) carries the single-use
 *     deep-link token.
 *   - The response includes a ready-to-share URL + inline QR PNG so the
 *     manager can hand it off via any channel (SMS, WhatsApp, show screen).
 *
 * A deterministic stub email (`tg-<cuid>@invite.local`) is written because
 * the User table enforces a unique email and changing that constraint for
 * this flow alone would regress existing dashboards.
 */
const schema = z.object({
  name: z.string().min(2, "Имя должно содержать минимум 2 символа"),
  role: z.enum(USER_ROLE_VALUES, { message: "Выберите роль" }),
  phone: z.string().optional(),
  // Опциональная привязка к должности при инвайте — без неё юзер
  // создаётся в legacy-режиме (journalAccessMigrated=false), и при
  // активации видит ВСЕ журналы. С jobPositionId — заполняем
  // UserJournalAccess из JobPositionJournalAccess сразу, юзер видит
  // только то что положено его должности.
  jobPositionId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    // Согласовано с /api/users/invite (a9347914): head_chef нанимает
    // поваров напрямую и должен мочь рассылать TG-QR. Раньше: только
    // manager.
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }

    if (!process.env.TELEGRAM_BOT_USERNAME) {
      return NextResponse.json(
        { error: "TELEGRAM_BOT_USERNAME не настроен на сервере" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const data = schema.parse(body);

    const raw = generateBotInviteRaw();
    const tokenHash = hashBotInviteToken(raw);
    const expiresAt = botInviteExpiresAt();
    const organizationId = getActiveOrgId(session);

    // Если передан jobPositionId — валидируем принадлежность org и
    // подтягиваем allowed templates для populate UserJournalAccess.
    // Согласовано с /api/staff и QR-join.
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

    const { user } = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          // Stub email: unique + never used for routing (no email ever sent).
          email: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@invite.local`,
          name: data.name,
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
      await tx.botInviteToken.create({
        data: {
          userId: user.id,
          organizationId,
          tokenHash,
          expiresAt,
        },
      });
      return { user };
    });

    // См. комментарий в /api/users/invite — тот же лимит бесплатного тарифа.
    const planCheck = await ensurePlanForHeadcount(organizationId);

    const inviteUrl = buildBotInviteUrl(raw);
    // Фирменный QR (`brand-qr.ts`); ×2 к размеру в окне — чётко на ретине.
    const qrPngDataUrl = await brandQrPngDataUrl(inviteUrl, { width: 480 });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
        },
        inviteUrl,
        qrPngDataUrl,
        expiresAt: expiresAt.toISOString(),
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
    console.error("TG invite error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
