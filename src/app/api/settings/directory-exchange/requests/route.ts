import { NextResponse, after } from "next/server";
import { z } from "zod";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { exchangeErrorResponse, requireExchangeOwner } from "@/lib/directory-exchange/access.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_KINDS } from "@/lib/directory-exchange/kinds";
import { REQUEST_MODES } from "@/lib/directory-exchange/requests";
import { createExchangeRequest, loadExchangeRequests } from "@/lib/directory-exchange/requests.server";
import { isPointScoped } from "@/lib/point-scope";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Окно и карточка читают список при каждом открытии.
const readLimiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });
// Создание запроса — три разных счёта, и отказ не тратит чужой:
//   • любые обращения — 30 в минуту, чтобы маршрут нельзя было долбить;
//   • неверные коды — 10 за десять минут: попытка возвращается, если код
//     оказался настоящим или до поиска кода дело не дошло (не тот тариф, не
//     заполнено). Перебирать коды так не получится, а опечатка в списках или
//     отказ по тарифу попыток не отнимают;
//   • созданные запросы — 5 в сутки на аккаунт, считаются по базе
//     (`decideRequestCreation`): отказ их не расходует вовсе.
const attemptLimiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60_000 });
const wrongCodeLimiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 10 * 60_000 });
const TOO_MANY = "Слишком много запросов. Подождите минуту.";
const TOO_MANY_CODES = "Слишком много неверных кодов. Проверьте код мастер-кабинета и попробуйте через десять минут.";

const createSchema = z.object({
  code: z.string().trim().min(1, "Введите код мастер-кабинета").max(64, "Проверьте код мастер-кабинета"),
  mode: z.enum(REQUEST_MODES, "Выберите: связь или разовый перенос"),
  kinds: z
    .array(z.enum(EXCHANGE_KINDS))
    .min(1, "Выберите хотя бы один список")
    .max(EXCHANGE_KINDS.length * 2),
  // Связь: ещё и меню и сырьё кабинета (серия C1); у переноса не учитывается.
  withPool: z.boolean().optional().default(false),
});

/**
 * GET /api/settings/directory-exchange/requests — запросы и связи с чужими
 * аккаунтами: `{ outgoing, foreignLinks, incoming, foreignMembers }`.
 * `outgoing` (ждущие запросы) и `foreignLinks` — активной организации;
 * `incoming` (ждущие запросы) и `foreignMembers` — мастер-кабинетов аккаунта.
 * Всё это видит только владелец аккаунта: руководителю без прав владельца и
 * в режиме «войти как» — пустые списки; сотруднику — 403.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  if (!readLimiter.consume(`directory-exchange:requests:read:${session.user.id}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  try {
    const state = await loadExchangeRequests(session.user.id, getActiveOrgId(session), {
      sessionAllows: !isImpersonating(session) && !isPointScoped(session.user),
    });
    return NextResponse.json(state);
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}

/**
 * POST /api/settings/directory-exchange/requests `{ code, mode, kinds, withPool? }` —
 * запрос в мастер-кабинет другого аккаунта по его коду → `{ ok: true,
 * request }`, где `request = { id, cabinetName, mode, kinds, status,
 * expiresAt, createdAt }`. Владельцу аккаунта кабинета уходит письмо со
 * ссылкой на подтверждение. Отказы: 400 — не заполнено, 402 — аккаунт не на
 * платном тарифе, 404 — кабинет с таким кодом не найден (и для строки, не
 * похожей на код, и для демо — один и тот же ответ), 409 — свой кабинет, уже
 * участник, уже есть открытый запрос, организация закрыта; 429 — лимит.
 */
export async function POST(request: Request) {
  const owner = await requireExchangeOwner();
  if (!owner.ok) return owner.response;
  const { organizationId, actor } = owner.context;
  const limitKey = `directory-exchange:requests:create:${actor.userId}`;
  if (!attemptLimiter.consume(limitKey)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
  }

  if (!wrongCodeLimiter.consume(limitKey)) {
    return NextResponse.json({ error: TOO_MANY_CODES }, { status: 429 });
  }
  try {
    const created = await createExchangeRequest({ organizationId, actor, ...parsed.data });
    wrongCodeLimiter.refund(limitKey);
    // Письмо владельцу кабинета — после ответа; сбой почты запрос не ломает.
    after(created.notify);
    return NextResponse.json({ ok: true, request: created.request });
  } catch (error) {
    // Попытка остаётся потраченной только на «кабинет не найден».
    if (!(error instanceof DirectoryExchangeError && error.status === 404)) wrongCodeLimiter.refund(limitKey);
    return exchangeErrorResponse(error);
  }
}
