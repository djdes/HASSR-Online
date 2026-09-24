import { NextResponse } from "next/server";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { getDishPoolInfo, linkDishPool, previewDishPoolLink, unlinkDishPool } from "@/lib/dish-pool";
import { recordAuditLog } from "@/lib/audit-log";
import { findPoolMasterOrgId } from "@/lib/master-directory";
import { pushSharedListsToOrg } from "@/lib/master-directory-push";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Попытки ввести чужой код — 10 в минуту на организацию: код не подобрать перебором. */
const codeAttempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

/**
 * Общий справочник блюд по служебному коду.
 *   GET                         — свой код, к чему привязаны, сколько организаций в пуле;
 *   POST { code, confirm? }     — без confirm: превью (чья база, сколько организаций);
 *                                  с confirm: true — привязать;
 *   DELETE                      — отвязаться (свои блюда остаются).
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
  return NextResponse.json(await getDishPoolInfo(auth.organizationId));
}

export async function POST(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  if (!codeAttempts.consume(`dish-pool:${auth.organizationId}`)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown; confirm?: unknown } | null;
  if (body?.confirm !== true) {
    const preview = await previewDishPoolLink(auth.organizationId, body?.code);
    return "error" in preview
      ? NextResponse.json(preview, { status: 400 })
      : NextResponse.json({ preview });
  }
  const linked = await linkDishPool(auth.organizationId, body?.code);
  if ("error" in linked) return NextResponse.json(linked, { status: 400 });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "settings.dish_pool_link",
    entity: "Organization",
    entityId: auth.organizationId,
    details: { code: linked.code, organizationName: linked.organizationName },
  }).catch(() => null);
  // В пуле есть мастер-кабинет справочников — его меню и сырьё сразу в
  // активные БЖГП и скоропорт подключившейся организации. Сбой раздачи не
  // отменяет подключение: следующее сохранение у мастера дошлёт списки.
  let masterDocuments = 0;
  try {
    const masterOrgId = await findPoolMasterOrgId(auth.organizationId);
    if (masterOrgId && masterOrgId !== auth.organizationId) {
      masterDocuments = (await pushSharedListsToOrg(auth.organizationId, masterOrgId)).documents;
    }
  } catch (err) {
    console.error("[dish-pool] master lists push failed", { organizationId: auth.organizationId }, err);
  }
  return NextResponse.json({ linked, masterDocuments, info: await getDishPoolInfo(auth.organizationId) });
}

export async function DELETE(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  await unlinkDishPool(auth.organizationId);
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "settings.dish_pool_unlink",
    entity: "Organization",
    entityId: auth.organizationId,
  }).catch(() => null);
  return NextResponse.json({ info: await getDishPoolInfo(auth.organizationId) });
}
