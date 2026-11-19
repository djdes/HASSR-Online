import { NextResponse, after } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";

import { isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { exchangeErrorResponse } from "@/lib/directory-exchange/access.server";
import { EXCHANGE_KINDS } from "@/lib/directory-exchange/kinds";
import { REQUEST_NOT_OWNER_MESSAGE } from "@/lib/directory-exchange/requests";
import { decideExchangeRequest, loadExchangeRequestByToken } from "@/lib/directory-exchange/requests.server";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Страница запроса читается при открытии; решение — одно на запрос.
const readLimiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60_000 });
const decideLimiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const TOO_MANY = "Слишком много запросов. Подождите минуту.";
const IMPERSONATION_MESSAGE =
  "В режиме «войти как» запрос открыть нельзя: решение принимает сам владелец аккаунта под своей учётной записью.";

type Ctx = { params: Promise<{ token: string }> };

const decideSchema = z.object({
  decision: z.enum(["approve", "decline"], "Выберите: подтвердить или отклонить"),
  // Что владелец разрешает; не передано — всё запрошенное. Шире запрошенного не станет.
  allowedKinds: z.array(z.enum(EXCHANGE_KINDS)).max(EXCHANGE_KINDS.length * 2).nullish(),
  // Перенос: своя организация, из которой взять данные.
  sourceOrganizationId: z.string().trim().min(1).max(64).nullish(),
});

type OwnerSession = { ok: true; session: Session } | { ok: false; response: NextResponse };

/**
 * Кто вообще может открыть запрос: вошедший руководитель с полным доступом,
 * под своей учётной записью. Владелец ли он аккаунта кабинета — решает
 * `requests.server.ts` по самому запросу.
 */
async function requireOwnerSession(): Promise<OwnerSession> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const { session } = auth;
  const refuse = (error: string): OwnerSession => ({ ok: false, response: NextResponse.json({ error }, { status: 403 }) });
  if (!hasFullWorkspaceAccess(session.user)) return refuse(REQUEST_NOT_OWNER_MESSAGE);
  if (isImpersonating(session)) return refuse(IMPERSONATION_MESSAGE);
  if (isPointScoped(session.user)) return refuse(COMPANY_ONLY_API_ERROR);
  return { ok: true, session };
}

/**
 * GET /api/exchange-requests/[token] — запрос для страницы подтверждения:
 * `{ request: { id, requesterName, requesterInn, mode, kinds, status,
 * expiresAt, createdAt, allowedKinds }, cabinet: { id, name }, sources:
 * [{ id, name }] }`. Только владельцу аккаунта мастер-кабинета: остальным —
 * 403 с пояснением, неизвестная ссылка — 404. `sources` — для переноса:
 * свои организации, из которых можно взять данные.
 */
export async function GET(_request: Request, ctx: Ctx) {
  const owner = await requireOwnerSession();
  if (!owner.ok) return owner.response;
  const userId = owner.session.user.id;
  if (!readLimiter.consume(`exchange-request:read:${userId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  const { token } = await ctx.params;
  try {
    const view = await loadExchangeRequestByToken({ token, userId });
    return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}

/**
 * POST /api/exchange-requests/[token] `{ decision: "approve" | "decline",
 * allowedKinds?, sourceOrganizationId? }` → `{ ok: true, status, summary? }`.
 * Подтверждение связи делает организацию-заявителя участником обмена кабинета
 * и сразу запускает обмен; подтверждение переноса разово переносит данные из
 * выбранной своей организации. Повторное решение, отменённый и истёкший
 * запрос — 409. Заявителю — письмо и уведомление, после ответа.
 */
export async function POST(request: Request, ctx: Ctx) {
  const owner = await requireOwnerSession();
  if (!owner.ok) return owner.response;
  const { user } = owner.session;
  if (!decideLimiter.consume(`exchange-request:decide:${user.id}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  const parsed = decideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
  }
  const { token } = await ctx.params;
  try {
    const decided = await decideExchangeRequest({
      token,
      actor: { userId: user.id, userName: user.name ?? null },
      decision: parsed.data.decision,
      allowedKinds: parsed.data.allowedKinds ?? undefined,
      sourceOrganizationId: parsed.data.sourceOrganizationId ?? null,
    });
    after(decided.notify);
    return NextResponse.json({
      ok: true,
      status: decided.status,
      ...(decided.summary ? { summary: decided.summary } : {}),
    });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
