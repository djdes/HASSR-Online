import { NextResponse } from "next/server";

import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { recordAuditLog } from "@/lib/audit-log";
import {
  createAccountMasterCabinet,
  listAccountMasterCabinetObjects,
  MasterCabinetError,
} from "@/lib/master-cabinet";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

/**
 * Мастер-кабинеты аккаунта — пункт «Создать мастер-кабинет» в меню профиля
 * (раздел «Кабинет»). Только владелец аккаунта, как и создание организаций.
 *   GET                            — объекты аккаунта и кабинет, из которого
 *                                    каждый сейчас получает меню и сырьё;
 *   POST { name, organizationIds } — новый кабинет со своим кодом справочника,
 *                                    отмеченные объекты подключаются к нему.
 */
async function guard() {
  const auth = await requireApiAuth();
  if (!auth.ok) return { error: auth.response } as const;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return { error: NextResponse.json({ error: "Это настройка руководителя" }, { status: 403 }) } as const;
  }
  return { session: auth.session } as const;
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({ objects: await listAccountMasterCabinetObjects(auth.session.user.id) });
  } catch (err) {
    if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[master-cabinets] list failed", { userId: auth.session.user.id }, err);
    return NextResponse.json({ error: "Не удалось загрузить объекты" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  if (!attempts.consume(`master-cabinets:${auth.session.user.id}`)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { name?: unknown; organizationIds?: unknown } | null;

  let result;
  try {
    result = await createAccountMasterCabinet({
      ownerUserId: auth.session.user.id,
      name: body?.name,
      organizationIds: body?.organizationIds,
    });
  } catch (err) {
    if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[master-cabinets] create failed", { userId: auth.session.user.id }, err);
    return NextResponse.json({ error: "Не удалось создать мастер-кабинет" }, { status: 500 });
  }

  const details = {
    name: result.name,
    code: result.code,
    via: "profile-menu",
    organizationIds: result.organizationIds,
    moved: result.summary.moving,
  };
  const activeOrgId = getActiveOrgId(auth.session);
  for (const organizationId of new Set([activeOrgId, result.id])) {
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId,
      action: "master_cabinet.created",
      entity: "Organization",
      entityId: result.id,
      details,
    });
  }
  console.info("[master-cabinets] created", { userId: auth.session.user.id, masterOrganizationId: result.id, ...details });

  return NextResponse.json({
    cabinet: { id: result.id, name: result.name, code: result.code },
    summary: result.summary,
  });
}
