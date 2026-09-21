import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveClaimForUser } from "@/lib/journal-task-claims";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/journal-task-claims/my — моя текущая взятая задача, если есть.
 *
 * Используется UI: пока возвращает claim, кнопки «Взять» в других
 * журналах disabled с tooltip «Сначала заверши <parentHint>».
 *
 * Отдаём и решение заведующей. Без `verificationStatus` /
 * `verifierComment` отказ «Переделать» не доходил до сотрудника вовсе:
 * на экране была обычная активная задача. Сам экран задачи с этой правки
 * читает `GET /api/journal-task-claims/[id]` — там ещё и прошлые
 * значения полей.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const claim = await getActiveClaimForUser(
    session.user.id,
    getActiveOrgId(session)
  );
  if (!claim) return NextResponse.json({ claim: null });

  const verification = await db.journalTaskClaim.findUnique({
    where: { id: claim.id },
    select: {
      verificationStatus: true,
      verifierComment: true,
      completionData: true,
      verifiedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    claim: {
      ...claim,
      verificationStatus: verification?.verificationStatus ?? null,
      verifierComment: verification?.verifierComment ?? null,
      verifiedByName: verification?.verifiedBy?.name ?? null,
      completionData:
        (verification?.completionData as Record<string, unknown> | null) ?? null,
    },
  });
}
