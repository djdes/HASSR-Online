import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { checkSeatsForActivation } from "@/lib/billing.server";
import { recordAuditLog } from "@/lib/audit-log";
import { sendInviteTokenEmail } from "@/lib/email";
import {
  createOrInviteMasterCabinet,
  getMasterCabinetStatus,
  MasterCabinetError,
  renameMasterCabinet,
} from "@/lib/master-cabinet";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Как у dish-pool: 10 попыток в минуту на организацию. */
const attempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

const createSchema = z.object({
  name: z.string().trim().min(2, "Укажите ФИО сотрудника бэк-офиса").max(120),
  email: z.string().trim().email("Введите корректный email"),
});

/**
 * Мастер-кабинет справочников пула служебного кода (у пищеблока).
 *   GET                    — код пула, объекты пула, кабинет и его сотрудники;
 *   POST { name, email }   — создать кабинет (если его нет) и пригласить
 *                            сотрудника бэк-офиса; в ответе — ссылка приглашения.
 */
async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) } as const;
  if (!hasFullWorkspaceAccess(session.user)) {
    return { error: NextResponse.json({ error: "Это настройка руководителя" }, { status: 403 }) } as const;
  }
  return { session, organizationId: getActiveOrgId(session) } as const;
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  return NextResponse.json(await getMasterCabinetStatus(auth.organizationId, auth.session.user.id));
}

/** PATCH { name } — переименовать мастер-кабинет пула (владелец / руководитель пищеблока). */
export async function PATCH(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const status = await getMasterCabinetStatus(auth.organizationId, auth.session.user.id);
  if (!status.master) {
    return NextResponse.json({ error: "Мастер-кабинета в вашем пуле пока нет" }, { status: 404 });
  }
  try {
    const result = await renameMasterCabinet(status.master.organizationId, body?.name);
    if (result.changed) {
      const details = { from: result.previousName, to: result.name, via: "settings", masterOrganizationId: status.master.organizationId };
      await recordAuditLog({
        request,
        session: auth.session,
        organizationId: auth.organizationId,
        action: "master_cabinet.renamed",
        entity: "Organization",
        entityId: status.master.organizationId,
        details,
      });
      await recordAuditLog({
        request,
        session: auth.session,
        organizationId: status.master.organizationId,
        action: "master_cabinet.renamed",
        entity: "Organization",
        entityId: status.master.organizationId,
        details,
      });
      console.info("[master-cabinet] renamed", { organizationId: auth.organizationId, ...details });
    }
    return NextResponse.json({
      name: result.name,
      changed: result.changed,
      status: await getMasterCabinetStatus(auth.organizationId, auth.session.user.id),
    });
  } catch (err) {
    if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[master-cabinet] rename failed", { organizationId: auth.organizationId }, err);
    return NextResponse.json({ error: "Не удалось переименовать кабинет" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  if (!attempts.consume(`master-cabinet:${auth.organizationId}`)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте ФИО и email" }, { status: 400 });
  }

  let result;
  try {
    result = await createOrInviteMasterCabinet({
      organizationId: auth.organizationId,
      actorUserId: auth.session.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      // Приглашённый — сотрудник этой организации: места тарифа как у обычного приглашения.
      beforeCreate: async (organizationId) => {
        const seats = await checkSeatsForActivation(organizationId, 1, { source: "master-cabinet.invite" });
        if (!seats.ok) throw new MasterCabinetError(seats.error, 402);
      },
    });
  } catch (err) {
    if (err instanceof MasterCabinetError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[master-cabinet] create failed", { organizationId: auth.organizationId }, err);
    return NextResponse.json({ error: "Не удалось создать мастер-кабинет" }, { status: 500 });
  }

  // Письмо — best-effort: ссылка приглашения есть и в ответе.
  let emailSent = true;
  try {
    await sendInviteTokenEmail({
      to: result.user.email,
      name: result.user.name,
      organizationName: result.masterName,
      inviteUrl: result.inviteUrl,
      organizationId: result.masterOrganizationId,
      subject: "Мастер-кабинет справочников WeSetup: установите пароль",
      intro:
        "Вы будете вести справочники для пищеблоков: загружаете меню и сырьё (из Excel, CSV или списком), а пищеблоки, подключённые по коду справочника, сразу получают их в журналы бракеража готовой продукции и скоропортящейся продукции. В «Сотрудниках» организации вы в группе «Мастер-кабинет»; после входа сразу окажетесь в кабинете.",
    });
  } catch (err) {
    emailSent = false;
    console.error("[master-cabinet] invite email failed", { userId: result.user.id }, err);
  }

  if (result.created) {
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: auth.organizationId,
      action: "master_cabinet.created",
      entity: "Organization",
      entityId: result.masterOrganizationId,
      details: { name: result.masterName, code: result.code },
    });
  }
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "master_cabinet.invited",
    entity: "User",
    entityId: result.user.id,
    details: { email: result.user.email, masterOrganizationId: result.masterOrganizationId, reinvited: result.reinvited },
  });

  return NextResponse.json({
    created: result.created,
    master: { organizationId: result.masterOrganizationId, name: result.masterName },
    code: result.code,
    user: result.user,
    inviteUrl: result.inviteUrl,
    emailSent,
    status: await getMasterCabinetStatus(auth.organizationId, auth.session.user.id),
  });
}
