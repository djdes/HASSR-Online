import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { createOrganization } from "@/lib/create-organization";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ORG_SPHERE_VALUES } from "@/lib/validators";
import { rewriteSessionClaims } from "@/lib/session-token";
import { BILLING_PAY_HREF, POINT_LIMIT_CODE } from "@/lib/billing-period";
import { orgCreationRefusalMessage } from "@/lib/org-trial";
import { claimOrgTrialGrant, planOrgCreation, releaseOrgTrialGrant } from "@/lib/org-trial.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2, "Название — минимум 2 символа").max(200),
  sphere: z.enum(ORG_SPHERE_VALUES).default("restaurant"),
  copyFrom: z.string().trim().optional(),
});

// Пять организаций в час на человека: живому владельцу сети хватит, а
// создавать и удалять их по кругу ради бесплатного периода — нет.
const createLimiter = createRateLimiter({ tokensPerInterval: 5, intervalMs: 60 * 60 * 1000 });

/**
 * POST /api/organizations — завести ещё одну точку.
 *
 * Создавать может только владелец аккаунта: организации внутри одного
 * аккаунта делят тариф и лимит сотрудников, и разрешать это
 * приглашённому руководителю значит разрешить ему тратить чужие деньги.
 * Сразу после создания переключаем человека в новую организацию — иначе
 * он остаётся в старой и не понимает, сработало ли.
 *
 * Новая организация — новая точка тарифа. Сверх оплаченных точек аккаунт
 * получает для неё свои 14 дней (две выдачи за всё время, `org-trial.ts`);
 * на бесплатном тарифе, без выдач или с закрытой организацией — 402 со
 * ссылкой на тариф. Условия заранее показывает окно создания
 * (`GET /api/organizations/creation-preview`).
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const account = await db.account.findUnique({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Создавать организации может только владелец аккаунта" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Проверьте поля" },
      { status: 400 },
    );
  }

  if (!createLimiter.consume(`org-create:${session.user.id}`)) {
    return NextResponse.json(
      { error: "Слишком много новых организаций подряд. Попробуйте через час" },
      { status: 429 },
    );
  }

  // Тариф считает аккаунт: условия — одни на окно создания и на сам запрос.
  const plan = await planOrgCreation(account.id);
  const refuse = (reason: "free_plan" | "trials_used" | "locked_org", limit: number | null, current: number | null) => {
    console.info("[billing] organization creation refused", { accountId: account.id, reason, limit, current });
    return NextResponse.json(
      { error: orgCreationRefusalMessage(reason, limit), code: POINT_LIMIT_CODE, reason, payUrl: BILLING_PAY_HREF, limit, current },
      { status: 402 },
    );
  };
  const decision = plan.decision;
  if (!decision.ok) return refuse(decision.reason, decision.limit, decision.current);

  // Свои 14 дней — выдача из двух на аккаунт, занимается атомарно. Гонку за
  // последнюю выдачу проигравший на оплаченном аккаунте получает отказом, а
  // в пробном периоде аккаунта — отметкой до его конца, без выдачи.
  let trialEndsAt: Date | null = null;
  let granted = false;
  if (decision.mode === "org_trial" || (decision.mode === "account_trial" && decision.grant)) {
    granted = await claimOrgTrialGrant(account.id);
    if (granted) trialEndsAt = decision.trialEndsAt;
    else if (decision.mode === "org_trial") return refuse("trials_used", null, null);
    else trialEndsAt = plan.accountTrialEndsAt ?? decision.trialEndsAt;
  } else if (decision.mode === "account_trial") {
    trialEndsAt = decision.trialEndsAt;
  }

  let organizationId: string;
  try {
    ({ organizationId } = await createOrganization({
      name: parsed.data.name,
      sphere: parsed.data.sphere,
      accountId: account.id,
      ownerUserId: session.user.id,
      // Клиент присылает "current" — какая именно организация активна,
      // он знать не обязан, а подставлять чужой id ему нельзя.
      copyFromOrganizationId:
        parsed.data.copyFrom === "current" ? getActiveOrgId(session) : null,
      trialEndsAt,
    }));
  } catch (error) {
    if (granted) await releaseOrgTrialGrant(account.id).catch(() => undefined);
    throw error;
  }

  await db.auditLog.create({
    data: {
      organizationId,
      userId: session.user.id,
      userName: session.user.name ?? null,
      action: "org.created",
      entity: "organization",
      entityId: organizationId,
      details: {
        name: parsed.data.name,
        sphere: parsed.data.sphere,
        billing: decision.mode,
        trialEndsAt: trialEndsAt?.toISOString() ?? null,
      },
    },
  });
  if (granted) {
    await db.auditLog.create({
      data: {
        organizationId,
        userId: session.user.id,
        userName: session.user.name ?? null,
        action: "org.trial_granted",
        entity: "organization",
        entityId: organizationId,
        details: { trialEndsAt: trialEndsAt?.toISOString() ?? null, grantsLeft: Math.max(0, plan.grantsLeft - 1) },
      },
    });
  }

  await rewriteSessionClaims({ activeOrganizationId: organizationId });
  await db.user.update({
    where: { id: session.user.id },
    data: { lastActiveOrganizationId: organizationId },
  });

  return NextResponse.json({
    ok: true,
    organizationId,
    billing: decision.mode,
    trialEndsAt: trialEndsAt?.toISOString() ?? null,
  });
}

/**
 * GET — организации, доступные текущему человеку. `canCreateMasterCabinet` —
 * владелец аккаунта: в мини-приложении у него в «Кабинете» есть «Создать
 * мастер-кабинет» (как в меню профиля сайта).
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { listAccessibleOrganizations } = await import(
    "@/lib/organization-access"
  );
  const [organizations, ownedAccount] = await Promise.all([
    listAccessibleOrganizations(auth.session.user.id),
    db.account.findUnique({
      where: { ownerUserId: auth.session.user.id },
      select: { id: true },
    }),
  ]);
  return NextResponse.json({
    organizations,
    canCreateMasterCabinet:
      Boolean(ownedAccount) && hasFullWorkspaceAccess(auth.session.user),
  });
}
