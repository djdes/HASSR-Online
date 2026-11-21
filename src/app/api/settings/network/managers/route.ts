import { NextResponse } from "next/server";
import { z } from "zod";

import {
  NetworkManagerError,
  appointNetworkManager,
  loadNetworkManagers,
  networkOwnerForSession,
  removeNetworkManager,
} from "@/lib/account-roles.server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { clientIp } from "@/lib/client-ip";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readLimiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });
const writeLimiter = createRateLimiter({ tokensPerInterval: 20, intervalMs: 60_000 });
const TOO_MANY = "Слишком много запросов. Подождите минуту.";

const bodySchema = z.object({ userId: z.string().trim().min(1, "Выберите руководителя").max(64) });

type Owner = Extract<Awaited<ReturnType<typeof networkOwnerForSession>>, { ok: true }>;

async function owner(): Promise<{ ok: true; owner: Owner } | { ok: false; response: NextResponse }> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const access = await networkOwnerForSession(auth.session);
  if (!access.ok) return { ok: false, response: NextResponse.json({ error: access.error }, { status: access.status }) };
  return { ok: true, owner: access };
}

function failure(error: unknown): NextResponse {
  if (error instanceof NetworkManagerError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  throw error;
}

/**
 * GET /api/settings/network/managers — «Управляющие сетью» (серия E, Р5):
 * `{ managers: [{ userId, name, email, organizations, active, createdAt }],
 * candidates: [{ userId, name, email, organizations }] }`. Только владелец
 * аккаунта активной организации; управляющему сетью и остальным — 403.
 */
export async function GET() {
  const access = await owner();
  if (!access.ok) return access.response;
  if (!readLimiter.consume(`network-managers:read:${access.owner.ownerUserId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  return NextResponse.json(await loadNetworkManagers(access.owner.accountId));
}

/**
 * POST /api/settings/network/managers `{ userId }` — назначить управляющего
 * из руководителей организаций аккаунта с полным доступом → `{ ok: true,
 * manager, ...view }`. Не кандидат — 404; владелец, уже назначен, предел — 409.
 */
export async function POST(request: Request) {
  const access = await owner();
  if (!access.ok) return access.response;
  if (!writeLimiter.consume(`network-managers:write:${access.owner.ownerUserId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
  }
  try {
    const manager = await appointNetworkManager({ ...access.owner, ipAddress: clientIp(request) }, parsed.data.userId);
    return NextResponse.json({ ok: true, manager, ...(await loadNetworkManagers(access.owner.accountId)) });
  } catch (error) {
    return failure(error);
  }
}

/**
 * DELETE /api/settings/network/managers `{ userId }` — снять управляющего:
 * права пропадают сразу → `{ ok: true, ...view }`. Не назначен — 404.
 */
export async function DELETE(request: Request) {
  const access = await owner();
  if (!access.ok) return access.response;
  if (!writeLimiter.consume(`network-managers:write:${access.owner.ownerUserId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
  }
  try {
    await removeNetworkManager({ ...access.owner, ipAddress: clientIp(request) }, parsed.data.userId);
    return NextResponse.json({ ok: true, ...(await loadNetworkManagers(access.owner.accountId)) });
  } catch (error) {
    return failure(error);
  }
}
