import { NextResponse, after } from "next/server";
import { z } from "zod";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { exchangeErrorResponse, requireExchangeManager } from "@/lib/directory-exchange/access.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_KINDS } from "@/lib/directory-exchange/kinds";
import { EXCHANGE_BUSY_CODE, runDirectoryExchangeWithin } from "@/lib/directory-exchange/run.server";
import { loadExchangeState, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { emptySummary } from "@/lib/directory-exchange/summary";
import { isPointScoped } from "@/lib/point-scope";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Окно и карточка читают состояние при каждом открытии; сохранение запускает
// обмен целиком — десяти раз в минуту человеку хватит с запасом.
const readLimiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });
const saveLimiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const TOO_MANY = "Слишком много запросов. Подождите минуту.";

const saveSchema = z.object({
  members: z
    .array(
      z.object({
        organizationId: z.string().trim().min(1).max(64),
        // Список списков; пустой — организация выходит из обмена.
        kinds: z.array(z.enum(EXCHANGE_KINDS)).max(EXCHANGE_KINDS.length * 2),
      }),
    )
    .min(1, "Выберите организации для обмена")
    .max(100),
});

/**
 * GET /api/settings/directory-exchange — состояние обмена справочниками для
 * окна «Связать или перенести данные» и карточки «Обмен справочниками»:
 * `{ canManage, organization, locked, counts, siblings, cabinet, members,
 * lastSync, isAccountOwner }`. Руководителю, который не владелец аккаунта и
 * не управляющий сетью, — `canManage: false` без соседних организаций;
 * сотруднику — 403.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  if (!readLimiter.consume(`directory-exchange:read:${session.user.id}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  try {
    const state = await loadExchangeState(session.user.id, getActiveOrgId(session), {
      sessionAllows: !isImpersonating(session) && !isPointScoped(session.user),
    });
    return NextResponse.json(state);
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}

/**
 * PUT /api/settings/directory-exchange `{ members: [{ organizationId, kinds }] }`
 * — сохранить участников (пустые `kinds` — выход из обмена), при
 * необходимости создать мастер-кабинет и сразу запустить обмен →
 * `{ ok: true, summary }`; обмен дольше 8 секунд — `{ ok: true, running:
 * true, summary }` (пустой), он доходит в фоне, итог — в карточке. Владелец
 * аккаунта или управляющий сетью и только организации аккаунта (чужая — 404).
 */
export async function PUT(request: Request) {
  const owner = await requireExchangeManager();
  if (!owner.ok) return owner.response;
  const { organizationId, actor } = owner.context;
  if (!saveLimiter.consume(`directory-exchange:save:${actor.userId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
  }

  try {
    const saved = await saveExchangeMembers({
      ownerUserId: actor.userId,
      ownerName: actor.userName,
      organizationId,
      members: parsed.data.members,
    });
    if (!saved.cabinet) return NextResponse.json({ ok: true, summary: emptySummary() });
    try {
      const outcome = await runDirectoryExchangeWithin(saved.cabinet.id, { actor, trigger: "save" });
      if (outcome.running) {
        after(outcome.done);
        return NextResponse.json({ ok: true, running: true, summary: emptySummary() });
      }
      return NextResponse.json({ ok: true, summary: outcome.summary });
    } catch (error) {
      // Настройки уже сохранены; кабинет занят другим обменом — не ошибка сохранения.
      if (error instanceof DirectoryExchangeError && error.code === EXCHANGE_BUSY_CODE) {
        return NextResponse.json({
          ok: true,
          summary: { ...emptySummary(), notes: [`Настройки сохранены. ${error.message}`] },
        });
      }
      throw error;
    }
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
