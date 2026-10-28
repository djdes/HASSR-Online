import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { ensureBuildingServiceCode, ensureServiceCode } from "@/lib/dish-pool";
import { MasterCorrectionError } from "@/lib/master-brakerage-correction";
import { poolObjectId } from "@/lib/master-directory";
import { connectPoolObjectByCode, disconnectPoolObject, type PoolActor } from "@/lib/master-pool-connect";
import { loadOrgMasterCabinets } from "@/lib/org-master-cabinets";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Точки организации в мастер-кабинете — со страницы «Моя компания →
 * Мастер-кабинет» (скан 99 от 2026-10-28: «возможность добавить торговую
 * точку»). Та же логика, что у вкладки «Подключённые объекты» кабинета
 * (`master-pool-connect.ts`), только код журнала точки подставляет сервер.
 *   POST   { cabinetId, buildingId } — подключить точку (null — организацию);
 *   DELETE { cabinetId, buildingId } — отключить.
 * Кабинет — из списка страницы: кабинет аккаунта организации или тот, к
 * которому она уже подключена.
 */

const attempts = createRateLimiter({ tokensPerInterval: 20, intervalMs: 60_000 });
const schema = z
  .object({ cabinetId: z.string().min(1).max(200), buildingId: z.string().min(1).max(200).nullable().default(null) })
  .strict();

async function prepare(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) } as const;
  if (!hasFullWorkspaceAccess(session.user) || session.user.partnerAccess?.level === "view") {
    return { error: NextResponse.json({ error: "Это настройка руководителя" }, { status: 403 }) } as const;
  }
  const organizationId = getActiveOrgId(session);
  if (!attempts.consume(`master-objects:${organizationId}`)) {
    return { error: NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 }) } as const;
  }
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return { error: NextResponse.json({ error: "Не выбраны кабинет и точка" }, { status: 400 }) } as const;
  const view = await loadOrgMasterCabinets(organizationId, session.user.id);
  const cabinet = view.cabinets.find((item) => item.id === body.data.cabinetId);
  if (!cabinet) return { error: NextResponse.json({ error: "Мастер-кабинет не найден" }, { status: 404 }) } as const;
  // Точка — из подключаемых объектов организации (без офиса; null — организация без точек).
  const target = view.connectable.find((item) => item.buildingId === body.data.buildingId);
  if (!target) return { error: NextResponse.json({ error: "Точка не найдена" }, { status: 404 }) } as const;
  const actor: PoolActor = { userId: session.user.id, userName: session.user.name ?? "" };
  return { session, organizationId, cabinet, target, actor } as const;
}

export async function POST(request: Request) {
  const ctx = await prepare(request);
  if ("error" in ctx) return ctx.error;
  const { session, organizationId, cabinet, target, actor } = ctx;
  if (target.cabinetId === cabinet.id) {
    return NextResponse.json({ ok: true, name: target.name, view: await loadOrgMasterCabinets(organizationId, session.user.id) });
  }
  if (target.cabinetId) {
    return NextResponse.json(
      { error: `«${target.name}» уже получает меню и сырьё из кабинета «${target.cabinetName}». Сначала отключите её там.` },
      { status: 409 }
    );
  }
  try {
    const code = target.buildingId ? await ensureBuildingServiceCode(target.buildingId) : await ensureServiceCode(organizationId);
    const preview = await connectPoolObjectByCode({ masterOrgId: cabinet.id, code, confirm: true, actor });
    console.info("[master-cabinet] object connected", { organizationId, cabinetId: cabinet.id, buildingId: target.buildingId });
    return NextResponse.json({ ok: true, name: preview.organizationName, view: await loadOrgMasterCabinets(organizationId, session.user.id) });
  } catch (error) {
    if (error instanceof MasterCorrectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const ctx = await prepare(request);
  if ("error" in ctx) return ctx.error;
  const { session, organizationId, cabinet, target, actor } = ctx;
  try {
    const result = await disconnectPoolObject({ masterOrgId: cabinet.id, objectId: poolObjectId(organizationId, target.buildingId), actor });
    if (!result) return NextResponse.json({ error: "Точка уже отключена" }, { status: 404 });
    console.info("[master-cabinet] object disconnected", { organizationId, cabinetId: cabinet.id, buildingId: target.buildingId });
    return NextResponse.json({ ok: true, name: result.name, view: await loadOrgMasterCabinets(organizationId, session.user.id) });
  } catch (error) {
    if (error instanceof MasterCorrectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
