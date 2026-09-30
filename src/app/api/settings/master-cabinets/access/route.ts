import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireApiAuth } from "@/lib/auth-helpers";
import { checkSeatsForActivation, seatLimitResponse, type SeatGuard } from "@/lib/billing.server";
import { sendInviteTokenEmail } from "@/lib/email";
import { MasterCabinetError } from "@/lib/master-cabinet";
import {
  grantCabinetAccess,
  inviteToCabinet,
  listAccountCabinetsAccess,
  revokeCabinetAccess,
} from "@/lib/master-cabinet-access";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { notifyEmployee } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteAttempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

/** Мест тарифа не хватило — ответ как у обычного приглашения сотрудника. */
class SeatLimitError extends Error {
  constructor(readonly guard: Extract<SeatGuard, { ok: false }>) {
    super(guard.error);
  }
}

/**
 * «Настройки → Права доступа → Мастер-кабинеты» (только владелец аккаунта).
 *   GET                                             — кабинеты, люди с доступом, кого можно добавить;
 *   POST { action: "grant", cabinetId, userId }      — дать доступ сотруднику объекта;
 *   POST { action: "invite", cabinetId, name, email } — пригласить по почте только в кабинет;
 *   DELETE { cabinetId, userId }                      — убрать доступ.
 */
async function guard() {
  const auth = await requireApiAuth();
  if (!auth.ok) return { error: auth.response } as const;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return { error: NextResponse.json({ error: "Это настройка руководителя" }, { status: 403 }) } as const;
  }
  return { session: auth.session } as const;
}

function failure(err: unknown, what: string, userId: string) {
  if (err instanceof SeatLimitError) return seatLimitResponse(err.guard);
  if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`[master-cabinet-access] ${what} failed`, { userId }, err);
  return NextResponse.json({ error: "Не получилось. Попробуйте ещё раз." }, { status: 500 });
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json(await listAccountCabinetsAccess(auth.session.user.id));
  } catch (err) {
    return failure(err, "list", auth.session.user.id);
  }
}

export async function POST(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const ownerUserId = auth.session.user.id;
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    cabinetId?: unknown;
    userId?: unknown;
    name?: unknown;
    email?: unknown;
  } | null;

  if (body?.action === "grant") {
    try {
      const result = await grantCabinetAccess({ ownerUserId, cabinetId: body.cabinetId, userId: body.userId });
      if (result.created) {
        await recordAuditLog({
          request,
          session: auth.session,
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
        cabinetId: body.cabinetId,
        name: body.name,
        email: body.email,
        beforeCreate: async (cabinetId) => {
          const seats = await checkSeatsForActivation(cabinetId, 1, { source: "master-cabinet.invite" });
          if (!seats.ok) throw new SeatLimitError(seats);
        },
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
        organizationName: result.cabinet.name,
        inviteUrl: result.inviteUrl,
        organizationId: result.cabinet.id,
        subject: `Мастер-кабинет «${result.cabinet.name}» в WeSetup: установите пароль`,
        intro:
          "Вам открыт доступ только к этому мастер-кабинету справочников: в нём ведут меню и сырьё, а подключённые объекты получают их в журналы бракеража готовой продукции и скоропортящейся продукции. Журналы и сотрудники объектов в кабинете не показываются.",
      });
    } catch (err) {
      emailSent = false;
      console.error("[master-cabinet-access] invite email failed", { userId: result.user.id }, err);
    }
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: result.cabinet.id,
      action: "master_cabinet.invited",
      entity: "User",
      entityId: result.user.id,
      details: { email: result.user.email, reinvited: result.reinvited, via: "settings-permissions" },
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

export async function DELETE(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const ownerUserId = auth.session.user.id;
  const body = (await request.json().catch(() => null)) as { cabinetId?: unknown; userId?: unknown } | null;
  try {
    const result = await revokeCabinetAccess({ ownerUserId, cabinetId: body?.cabinetId, userId: body?.userId });
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: result.cabinet.id,
      action: "master_cabinet.access_revoked",
      entity: "User",
      entityId: result.user.id,
      details: { name: result.user.name, kind: result.kind },
    });
    return NextResponse.json({ ok: true, access: await listAccountCabinetsAccess(ownerUserId) });
  } catch (err) {
    return failure(err, "revoke", ownerUserId);
  }
}
