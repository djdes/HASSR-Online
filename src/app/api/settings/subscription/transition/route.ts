import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { clientIp } from "@/lib/client-ip";
import {
  listTransitionCandidates,
  listTransitionJournals,
  loadAccountBilling,
  transitionToFree,
} from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Решение руководителя после конца пробного периода (тарифы 2026-10).
 *
 * GET  — состояние, активные сотрудники и включённые журналы для шагов
 *        «кто остаётся» и «какой журнал остаётся».
 * POST — «Остаться на бесплатном»: `{ keepUserId, keepJournalCode }` —
 *        остальные сотрудники в архив, остальные журналы выключаются.
 *        `{ …, voluntary: true }` — сам переходит с подписки или из пробного
 *        (кнопка на странице тарифа), без состояния «нужно решение»;
 *        оплаченный срок при этом не сохраняется (окно предупреждает).
 *
 * Оплата здесь не принимается: кнопка «Оплатить» ведёт на
 * `/settings/subscription` (карта или счёт по безналу).
 *
 * Решает только тот, кто может открыть тариф (`hasFullWorkspaceAccess`),
 * и не ROOT «под видом» и не консультант партнёра — отправить сотрудников
 * клиента в архив за него нельзя.
 */

async function authorize() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Тариф выбирает руководитель" }, { status: 403 }),
    };
  }
  return auth;
}

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const orgId = getActiveOrgId(auth.session);
  const loaded = await loadAccountBilling(orgId);
  if (!loaded) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const [candidates, journals] = await Promise.all([
    listTransitionCandidates(loaded.unit),
    listTransitionJournals(loaded.unit),
  ]);
  const orgNames = new Set(candidates.map((c) => c.organizationName));
  return NextResponse.json({
    kind: loaded.state.kind,
    activeUsers: loaded.state.activeUsers,
    graceEndsAt: loaded.state.graceEndsAt?.toISOString() ?? null,
    paidUntil: loaded.state.paidUntil?.toISOString() ?? null,
    multiOrg: orgNames.size > 1,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      organizationName: c.organizationName,
      isOwner: c.isOwner,
      isSelf: c.id === auth.session.user.id,
      isManagement: c.isManagement,
      canSignIn: c.canSignIn,
    })),
    journals: journals.map((j) => ({ code: j.code, name: j.name, entries30d: j.entries30d })),
  });
}

const PostSchema = z.object({
  keepUserId: z.string().trim().min(1, "Выберите, кто останется"),
  keepJournalCode: z.string().trim().min(1).max(100).optional(),
  voluntary: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (isImpersonating(session) || session.user.partnerAccess) {
    return NextResponse.json(
      { error: "Тариф выбирает руководитель организации в своём кабинете" },
      { status: 403 }
    );
  }
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Выберите, кто останется" },
      { status: 400 }
    );
  }

  const orgId = getActiveOrgId(session);
  const voluntary = parsed.data.voluntary === true;
  console.info(voluntary ? "[billing] voluntary downgrade requested" : "[billing] manager chose free plan", {
    organizationId: orgId,
    by: session.user.id,
    keepUserId: parsed.data.keepUserId,
    keepJournalCode: parsed.data.keepJournalCode ?? null,
  });
  const result = await transitionToFree({
    organizationId: orgId,
    mode: voluntary ? "voluntary" : "manual",
    keepUserId: parsed.data.keepUserId,
    keepJournalCode: parsed.data.keepJournalCode ?? null,
    actor: {
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? null,
      ipAddress: clientIp(request),
    },
  });
  if (!result.ok) {
    console.warn("[billing] free plan refused", { organizationId: orgId, voluntary, status: result.status, error: result.error });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    keptUserName: result.keptUserName,
    keptJournalName: result.keptJournalName,
    archivedCount: result.archivedCount,
    disabledJournalsCount: result.disabledJournalsCount,
    // Руководитель оставил другого — сам ушёл в архив, сессия закончится.
    selfArchived: result.archivedUserIds.includes(session.user.id),
  });
}
