import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { orgJournalBonusKopecks } from "@/lib/org-journal-settings";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { canWriteJournal } from "@/lib/journal-acl";

/**
 * POST /api/journals/[id]/claim-bonus
 *
 * Phase 3 → шаг 3.3. Транзакционный claim премиального обязательства.
 *
 * Гонка:
 *   UPDATE journal_obligations
 *   SET claimed_by_id = $user, claimed_at = now()
 *   WHERE id = $id AND status = 'pending' AND claimed_by_id IS NULL
 *
 * Кто первый прошёл WHERE — тому BonusEntry со status="pending"
 * создаётся в той же транзакции. Остальные получают 409 + кто и
 * когда забрал, чтобы UI мог показать «уже взято Иваном в 12:34».
 *
 * Сумма (`amountKopecks`) фиксируется в момент claim — последующее
 * редактирование `template.bonusAmountKopecks` не меняет ретроактивно
 * уже начисленные премии.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const session = auth.session;
  const orgId = getActiveOrgId(session);
  const userId = session.user.id;

  const obligation = await db.journalObligation.findUnique({
    where: { id },
    include: {
      template: {
        select: {
          id: true,
          code: true,
          bonusAmountKopecks: true,
        },
      },
    },
  });

  if (!obligation || obligation.organizationId !== orgId) {
    return NextResponse.json(
      { error: "Обязательство не найдено" },
      { status: 404 }
    );
  }
  // Бонус — настройка организации (`OrganizationJournalSetting`), шаблон — дефолт.
  obligation.template.bonusAmountKopecks = await orgJournalBonusKopecks(orgId, obligation.template);

  if (obligation.template.bonusAmountKopecks <= 0) {
    return NextResponse.json(
      { error: "Это не премиальный журнал" },
      { status: 400 }
    );
  }

  // ACL: премию может забрать только тот, кому позволено вести журнал.
  // Иначе сотрудник без access мог race-claim'ать премии чужих журналов,
  // забирая деньги «коллег».
  const aclActor = {
    id: userId,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (!(await canWriteJournal(aclActor, obligation.template.code))) {
    return NextResponse.json(
      { error: "Нет доступа к этому журналу" },
      { status: 403 }
    );
  }

  if (obligation.status !== "pending") {
    return NextResponse.json(
      { error: "Обязательство уже выполнено" },
      { status: 409 }
    );
  }

  const amountKopecks = obligation.template.bonusAmountKopecks;
  const now = new Date();

  try {
    const bonus = await db.$transaction(async (tx) => {
      const update = await tx.journalObligation.updateMany({
        where: {
          id,
          status: "pending",
          claimedById: null,
        },
        data: {
          claimedById: userId,
          claimedAt: now,
        },
      });

      if (update.count === 0) {
        return null;
      }

      return tx.bonusEntry.create({
        data: {
          organizationId: orgId,
          obligationId: id,
          templateId: obligation.template.id,
          userId,
          amountKopecks,
          status: "pending",
        },
      });
    });

    if (bonus === null) {
      const claimed = await db.journalObligation.findUnique({
        where: { id },
        select: {
          claimedById: true,
          claimedAt: true,
          status: true,
        },
      });
      const claimer = claimed?.claimedById
        ? await db.user.findUnique({
            where: { id: claimed.claimedById },
            select: { id: true, name: true },
          })
        : null;
      return NextResponse.json(
        {
          error:
            claimed?.status === "pending"
              ? "Премию уже забрал другой сотрудник"
              : "Обязательство уже выполнено",
          claimedBy: claimer
            ? { id: claimer.id, name: claimer.name }
            : null,
          claimedAt: claimed?.claimedAt?.toISOString() ?? null,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      bonus: {
        id: bonus.id,
        status: bonus.status,
        amountKopecks: bonus.amountKopecks,
        templateId: bonus.templateId,
        obligationId: bonus.obligationId,
      },
      claimedAt: now.toISOString(),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Премия уже создана для этого обязательства" },
        { status: 409 }
      );
    }
    throw error;
  }
}
