import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { checkSeatsForActivation, seatLimitResponse, type SeatGuard } from "@/lib/billing.server";
import { masterCabinetSeatsToAdd } from "@/lib/master-cabinet-seats";
import { recordAuditLog } from "@/lib/audit-log";
import { sendInviteTokenEmail } from "@/lib/email";
import { createOrInviteMasterCabinet, MasterCabinetError, renameMasterCabinet } from "@/lib/master-cabinet";
import { inviteMasterCabinetEmployee } from "@/lib/master-cabinet-staff";
import { loadOrgMasterCabinets } from "@/lib/org-master-cabinets";
import { createRateLimiter } from "@/lib/rate-limit";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";
import { db } from "@/lib/db";
import { resolveLocale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Как у dish-pool: 10 попыток в минуту на организацию. */
const attempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Укажите ФИО оператора").max(120),
  email: z.string().trim().email("Введите корректный email"),
  cabinetId: z.string().min(1).max(200).optional(),
});

/**
 * Мастер-кабинеты организации (страница «Моя компания → Мастер-кабинет»,
 * скан 99 от 2026-10-28).
 *   GET                              — кабинеты, точки организации в них, операторы;
 *   PATCH { cabinetId, name }        — переименовать кабинет;
 *   POST  { cabinetId, name, email } — пригласить оператора в кабинет, к
 *                                      которому подключена организация;
 *   POST  { name, email }            — кабинетов нет: создать кабинет из
 *                                      организации и пригласить оператора.
 * Подключение точек — `./objects`.
 */
async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) } as const;
  if (!hasFullWorkspaceAccess(session.user)) {
    return { error: NextResponse.json({ error: "Это настройка руководителя" }, { status: 403 }) } as const;
  }
  // Мастер-кабинет подключает точки всей компании (аудит 2026-11-01):
  // страница руководителю точки закрыта — и чтение тоже.
  if (isPointScoped(session.user)) {
    return { error: NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 }) } as const;
  }
  return { session, organizationId: getActiveOrgId(session) } as const;
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  return NextResponse.json(await loadOrgMasterCabinets(auth.organizationId, auth.session.user.id));
}

export async function PATCH(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as { name?: unknown; cabinetId?: unknown } | null;
  const view = await loadOrgMasterCabinets(auth.organizationId, auth.session.user.id);
  const cabinet = view.cabinets.find((item) => item.id === body?.cabinetId);
  if (!cabinet) return NextResponse.json({ error: "Мастер-кабинет не найден" }, { status: 404 });
  try {
    const result = await renameMasterCabinet(cabinet.id, body?.name);
    if (result.changed) {
      const details = { from: result.previousName, to: result.name, via: "settings", masterOrganizationId: cabinet.id };
      for (const organizationId of [auth.organizationId, cabinet.id]) {
        await recordAuditLog({
          request,
          session: auth.session,
          organizationId,
          action: "master_cabinet.renamed",
          entity: "Organization",
          entityId: cabinet.id,
          details,
        });
      }
      console.info("[master-cabinet] renamed", { organizationId: auth.organizationId, ...details });
    }
    return NextResponse.json({
      name: result.name,
      changed: result.changed,
      view: await loadOrgMasterCabinets(auth.organizationId, auth.session.user.id),
    });
  } catch (err) {
    if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[master-cabinet] rename failed", { organizationId: auth.organizationId }, err);
    return NextResponse.json({ error: "Не удалось переименовать кабинет" }, { status: 500 });
  }
}

/** Письмо-приглашение оператору — best-effort: ссылка есть и в ответе. */
async function sendOperatorInvite(params: {
  user: { id: string; name: string; email: string };
  cabinet: { id: string; name: string };
  inviteUrl: string;
}): Promise<boolean> {
  try {
    const [recipient, targetOrganization] = await Promise.all([
      db.user.findUnique({ where: { id: params.user.id }, select: { locale: true } }),
      db.organization.findUnique({ where: { id: params.cabinet.id }, select: { locale: true } }),
    ]);
    const locale = resolveLocale({ authenticated: true, userLocale: recipient?.locale, organizationLocale: targetOrganization?.locale });
    const t = await translatorFor(locale);
    await sendInviteTokenEmail({
      to: params.user.email,
      name: params.user.name,
      organizationName: params.cabinet.name,
      inviteUrl: params.inviteUrl,
      organizationId: params.cabinet.id,
      locale,
      subject: t("email.masterCabinet.subject", { organization: params.cabinet.name }),
      intro: t("email.masterCabinet.intro", { organization: params.cabinet.name }),
    });
    return true;
  } catch (err) {
    console.error("[master-cabinet] invite email failed", { userId: params.user.id }, err);
    return false;
  }
}

/** Кабинет = +1 сотрудник в подключённом пищеблоке: места нужны при первом человеке. */
function seatGuard(organizationId: string, onRefusal: (refusal: Extract<SeatGuard, { ok: false }>) => void) {
  return async (cabinetId: string) => {
    const adding = await masterCabinetSeatsToAdd(cabinetId);
    if (adding === 0) return;
    const seats = await checkSeatsForActivation(organizationId, adding, { source: "master-cabinet.invite" });
    if (!seats.ok) {
      onRefusal(seats);
      throw new MasterCabinetError(seats.error, 402);
    }
  };
}

async function inviteResponse(params: {
  request: Request;
  session: Session;
  organizationId: string;
  created: boolean;
  cabinet: { id: string; name: string };
  code?: string;
  user: { id: string; name: string; email: string };
  inviteUrl: string;
  reinvited: boolean;
}) {
  const emailSent = await sendOperatorInvite({ user: params.user, cabinet: params.cabinet, inviteUrl: params.inviteUrl });
  if (params.created) {
    await recordAuditLog({
      request: params.request,
      session: params.session,
      organizationId: params.organizationId,
      action: "master_cabinet.created",
      entity: "Organization",
      entityId: params.cabinet.id,
      details: { name: params.cabinet.name, code: params.code },
    });
  }
  await recordAuditLog({
    request: params.request,
    session: params.session,
    organizationId: params.organizationId,
    action: "master_cabinet.invited",
    entity: "User",
    entityId: params.user.id,
    details: { email: params.user.email, masterOrganizationId: params.cabinet.id, reinvited: params.reinvited },
  });
  return NextResponse.json({
    created: params.created,
    master: { organizationId: params.cabinet.id, name: params.cabinet.name },
    user: params.user,
    inviteUrl: params.inviteUrl,
    emailSent,
    view: await loadOrgMasterCabinets(params.organizationId, params.session.user.id),
  });
}

export async function POST(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  if (!attempts.consume(`master-cabinet:${auth.organizationId}`)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте ФИО и email" }, { status: 400 });
  }
  // Места кончились — тот же 402, что у остальных путей (лимит и следующий тариф).
  // `as`: присваивается в колбэке — без него TS сузил бы тип до null.
  let seatRefusal = null as Extract<SeatGuard, { ok: false }> | null;
  const beforeCreate = seatGuard(auth.organizationId, (refusal) => {
    seatRefusal = refusal;
  });

  // Оператор в кабинет, к которому подключена организация (или кабинет её аккаунта — владельцу).
  if (parsed.data.cabinetId) {
    const view = await loadOrgMasterCabinets(auth.organizationId, auth.session.user.id);
    const cabinet = view.cabinets.find((item) => item.id === parsed.data.cabinetId);
    if (!cabinet || (cabinet.objects.length === 0 && !(view.viewerIsOwner && cabinet.ownAccount))) {
      return NextResponse.json({ error: "Сначала подключите к этому кабинету точку организации" }, { status: 404 });
    }
    try {
      const invite = await inviteMasterCabinetEmployee({
        cabinetId: cabinet.id,
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        beforeCreate,
      });
      return inviteResponse({
        request,
        session: auth.session,
        organizationId: auth.organizationId,
        created: false,
        cabinet: { id: cabinet.id, name: cabinet.name },
        user: invite.user,
        inviteUrl: invite.inviteUrl,
        reinvited: invite.reinvited,
      });
    } catch (err) {
      if (seatRefusal) return seatLimitResponse(seatRefusal);
      if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("[master-cabinet] invite failed", { organizationId: auth.organizationId }, err);
      return NextResponse.json({ error: "Не удалось пригласить оператора" }, { status: 500 });
    }
  }

  // Кабинетов нет — создать кабинет из организации и пригласить первого оператора.
  let result;
  try {
    result = await createOrInviteMasterCabinet({
      organizationId: auth.organizationId,
      actorUserId: auth.session.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      beforeCreate,
    });
  } catch (err) {
    if (seatRefusal) return seatLimitResponse(seatRefusal);
    if (err instanceof MasterCabinetError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[master-cabinet] create failed", { organizationId: auth.organizationId }, err);
    return NextResponse.json({ error: "Не удалось создать мастер-кабинет" }, { status: 500 });
  }
  return inviteResponse({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    created: result.created,
    cabinet: { id: result.masterOrganizationId, name: result.masterName },
    code: result.code,
    user: result.user,
    inviteUrl: result.inviteUrl,
    reinvited: result.reinvited,
  });
}
