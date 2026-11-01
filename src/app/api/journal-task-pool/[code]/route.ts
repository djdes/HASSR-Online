import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getPoolBuildings } from "@/lib/active-building";
import { generatePoolForPoints } from "@/lib/journal-task-pool";
import {
  getActiveClaimForUser,
  listClaimsForJournal,
} from "@/lib/journal-task-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/journal-task-pool/[code]?date=YYYY-MM-DD
 *
 * Returns:
 *   {
 *     code,
 *     date,
 *     pool: boolean,                    // false для master-data журналов
 *     scopes: [
 *       {
 *         scopeKey, scopeLabel, sublabel?, journalDocumentId?,
 *         claim: null | { id, userId, userName, status, claimedAt },
 *         availability: 'available' | 'mine' | 'taken' | 'completed'
 *       }
 *     ],
 *     myActive: { id, scopeKey, scopeLabel, parentHint } | null
 *   }
 *
 * Это «one-shot» endpoint для UI — мини-апп / дашборд получают всё
 * необходимое одним вызовом: список scope'ов + чужие/свои claim'ы +
 * флаг «у меня уже есть active task» для one-active-task lockout.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { code } = await ctx.params;
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam
    ? new Date(`${dateParam}T00:00:00.000Z`)
    : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Невалидная дата" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  const userId = session.user.id;
  // Точки задач дня — как «Сегодня» (getPoolBuildings): в «Вся организация»
  // руководству — все точки, на точке — только её (аудит 2026-11-01).
  const points = await getPoolBuildings(session);

  const [pool, claims, myActive] = await Promise.all([
    generatePoolForPoints({ organizationId, journalCode: code, date, points }),
    listClaimsForJournal({
      organizationId,
      journalCode: code,
      dateKey: date,
    }),
    getActiveClaimForUser(userId, organizationId),
  ]);

  // Группируем claims по scopeKey: один active + возможные completed/released.
  const claimsByScope = new Map<
    string,
    { active?: typeof claims[number]; completed?: typeof claims[number] }
  >();
  for (const c of claims) {
    const bucket = claimsByScope.get(c.scopeKey) ?? {};
    if (c.status === "active") bucket.active = c;
    if (c.status === "completed") bucket.completed = c;
    claimsByScope.set(c.scopeKey, bucket);
  }

  const scopes = pool.scopes.map((scope) => {
    const bucket = claimsByScope.get(scope.scopeKey) ?? {};
    let availability: "available" | "mine" | "taken" | "completed" = "available";
    let claim: {
      id: string;
      userId: string;
      userName?: string | null;
      status: string;
      claimedAt: Date;
    } | null = null;
    if (bucket.completed) {
      availability = "completed";
      claim = {
        id: bucket.completed.id,
        userId: bucket.completed.userId,
        userName: bucket.completed.userName,
        status: bucket.completed.status,
        claimedAt: bucket.completed.claimedAt,
      };
    } else if (bucket.active) {
      availability = bucket.active.userId === userId ? "mine" : "taken";
      claim = {
        id: bucket.active.id,
        userId: bucket.active.userId,
        userName: bucket.active.userName,
        status: bucket.active.status,
        claimedAt: bucket.active.claimedAt,
      };
    }
    return { ...scope, availability, claim };
  });

  return NextResponse.json({
    code,
    date: date.toISOString().slice(0, 10),
    pool: pool.pool,
    scopes,
    myActive: myActive
      ? {
          id: myActive.id,
          journalCode: myActive.journalCode,
          scopeKey: myActive.scopeKey,
          scopeLabel: myActive.scopeLabel,
          parentHint: myActive.parentHint,
        }
      : null,
  });
}
