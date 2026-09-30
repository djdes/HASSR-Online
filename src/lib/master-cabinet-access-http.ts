import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { recordAuditLog } from "@/lib/audit-log";
import { checkSeatsForActivation, seatLimitResponse, type SeatGuard } from "@/lib/billing.server";
import { sendInviteTokenEmail } from "@/lib/email";
import {
  grantCabinetAccess,
  inviteToCabinet,
  listAccountCabinetsAccess,
  revokeCabinetAccess,
} from "@/lib/master-cabinet-access";
import { MasterCabinetError } from "@/lib/master-cabinet-error";
import { masterCabinetSeatsToAdd } from "@/lib/master-cabinet-seats";
import { MASTER_CABINET_POSITION_NAME } from "@/lib/master-cabinet-staff";
import { createRateLimiter } from "@/lib/rate-limit";
import { notifyEmployee } from "@/lib/telegram";

/**
 * Обработчики доступа к мастер-кабинетам — общие для «Права доступа →
 * Мастер-кабинеты» (`/api/settings/master-cabinets/access`) и кнопки
 * «Доступ» в самом кабинете (`/api/master/access`, там кабинет — активная
 * организация сессии: `cabinetId` из тела не берётся).
 */

const inviteAttempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

/** Мест тарифа не хватило — ответ как у обычного приглашения сотрудника. */
class SeatLimitError extends Error {
  constructor(readonly guard: Extract<SeatGuard, { ok: false }>) {
    super(guard.error);
  }
}

type Body = {
  action?: unknown;
  cabinetId?: unknown;
  organizationId?: unknown;
  userId?: unknown;
  name?: unknown;
  email?: unknown;
};

/** Кабинет = +1 сотрудник в каждом подключённом пищеблоке: места нужны, когда в кабинете появляется первый человек. */
async function assertCabinetSeats(cabinetId: string, organizationId: string) {
  const adding = await masterCabinetSeatsToAdd(cabinetId);
  if (adding === 0) return;
  const seats = await checkSeatsForActivation(organizationId, adding, { source: "master-cabinet.access" });
  if (!seats.ok) throw new SeatLimitError(seats);
}

function failure(err: unknown, what: string, userId: string) {
  if (err instanceof SeatLimitError) return seatLimitResponse(err.guard);
  if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`[master-cabinet-access] ${what} failed`, { userId }, err);
  return NextResponse.json({ error: "Не получилось. Попробуйте ещё раз." }, { status: 500 });
}

export async function handleAccessGet(session: Session): Promise<NextResponse> {
  try {
    return NextResponse.json(await listAccountCabinetsAccess(session.user.id));
  } catch (err) {
    return failure(err, "list", session.user.id);
  }
}

export async function handleAccessPost(
  request: Request,
  session: Session,
  cabinetIdOverride?: string
): Promise<NextResponse> {
  const ownerUserId = session.user.id;
  const body = (await request.json().catch(() => null)) as Body | null;
  const cabinetId = cabinetIdOverride ?? body?.cabinetId;

  if (body?.action === "grant") {
    try {
      const result = await grantCabinetAccess({
        ownerUserId,
        cabinetId,
        userId: body.userId,
        beforeGrant: assertCabinetSeats,
      });
      if (result.created) {
        await recordAuditLog({
          request,
          session,
          organizationId: result.cabinet.id,
          action: "master_cabinet.access_granted",
          entity: "User",
          entityId: result.user.id,
          details: { name: result.user.name, cabinet: result.cabinet.name },
        });
        await notifyEmployee(
          result.user.id,
          `🔓 Вам открыт доступ к мастер-кабинету «${result.cabinet.name}».\nОткройте меню профиля → раздел «Кабинет» → «${result.cabinet.name}».`
        ).catch(() => null);
      }
      return NextResponse.json({ ok: true, created: result.created, access: await listAccountCabinetsAccess(ownerUserId) });
    } catch (err) {
      return failure(err, "grant", ownerUserId);
    }
  }

  if (body?.action === "invite") {
    if (!inviteAttempts.consume(`master-cabinet-access:${ownerUserId}`)) {
      return NextResponse.json({ error: "Слишком много приглашений подряд. Подождите минуту." }, { status: 429 });
    }
    let result;
    try {
      result = await inviteToCabinet({
        ownerUserId,
        cabinetId,
        organizationId: body.organizationId,
        name: body.name,
        email: body.email,
        beforeCreate: (organizationId) =>
          typeof cabinetId === "string" ? assertCabinetSeats(cabinetId, organizationId) : Promise.resolve(),
      });
    } catch (err) {
      return failure(err, "invite", ownerUserId);
    }
    // Письмо — best-effort: ссылка приглашения есть и в ответе.
    let emailSent = true;
    try {
      await sendInviteTokenEmail({
        to: result.user.email,
        name: result.user.name,
        organizationName: result.organization.name,
        inviteUrl: result.inviteUrl,
        organizationId: result.organization.id,
        subject: `Мастер-кабинет «${result.cabinet.name}» в WeSetup: установите пароль`,
        intro: `Вы — сотрудник «${result.organization.name}» в группе «${MASTER_CABINET_POSITION_NAME}» с доступом к мастер-кабинету справочников «${result.cabinet.name}»: в нём ведут меню и сырьё, а подключённые пищеблоки получают их в журналы бракеража готовой продукции и скоропортящейся продукции. После входа вы сразу окажетесь в кабинете.`,
      });
    } catch (err) {
      emailSent = false;
      console.error("[master-cabinet-access] invite email failed", { userId: result.user.id }, err);
    }
    await recordAuditLog({
      request,
      session,
      organizationId: result.cabinet.id,
      action: "master_cabinet.invited",
      entity: "User",
      entityId: result.user.id,
      details: {
        email: result.user.email,
        organizationId: result.organization.id,
        organization: result.organization.name,
        reinvited: result.reinvited,
        via: cabinetIdOverride ? "master-cabinet" : "settings-permissions",
      },
    });
    return NextResponse.json({
      ok: true,
      inviteUrl: result.inviteUrl,
      emailSent,
      user: result.user,
      access: await listAccountCabinetsAccess(ownerUserId),
    });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}

export async function handleAccessDelete(
  request: Request,
  session: Session,
  cabinetIdOverride?: string
): Promise<NextResponse> {
  const ownerUserId = session.user.id;
  const body = (await request.json().catch(() => null)) as Body | null;
  try {
    const result = await revokeCabinetAccess({
      ownerUserId,
      cabinetId: cabinetIdOverride ?? body?.cabinetId,
      userId: body?.userId,
    });
    await recordAuditLog({
      request,
      session,
      organizationId: result.cabinet.id,
      action: "master_cabinet.access_revoked",
      entity: "User",
      entityId: result.user.id,
      details: { name: result.user.name, kind: result.kind, archived: result.archived },
    });
    return NextResponse.json({ ok: true, archived: result.archived, access: await listAccountCabinetsAccess(ownerUserId) });
  } catch (err) {
    return failure(err, "revoke", ownerUserId);
  }
}
