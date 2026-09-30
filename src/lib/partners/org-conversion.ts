/**
 * Перевод своей организации в клиенты своего партнёрского кабинета и
 * обратно — работа с базой. Решения принимает чистое ядро
 * (`org-conversion-core.ts`): здесь собирается снимок, ядро возвращает
 * план, и его операции применяются одной транзакцией со строкой
 * организации под `FOR UPDATE` — два нажатия подряд или перевод
 * одновременно с оплатой не проскочат между проверкой и записью.
 *
 * Логи — `[partners] org converted …` / `org returned …` на каждом
 * переходе, отказы — `… blocked`. Аудит — в журнал организации и в
 * домашнюю организацию человека. Логику начислений не трогаем: после
 * перевода их считает существующий `accrueForPaidOrder` по привязке.
 */

import { Prisma } from "@prisma/client";

import { attachAccountForNewOrganization } from "@/lib/create-organization";
import { SEAT_USER_WHERE, readFreePeriodSettings } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { notifyManagement, upsertNotification } from "@/lib/notifications";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { PAID_ORDER_STATUSES } from "@/lib/promo/service";
import { OFFER_REVISION } from "@/lib/recurring-consent";
import { bumpSessionVersion } from "@/lib/session-version";
import { escapeTelegramHtml } from "@/lib/telegram";

import { NEUTRAL_SUPPORT_NAME, invalidateOrgBranding, isPartnerHiddenForOrg } from "./branding";
import {
  CONVERTED_SOURCE,
  PENDING_CARD_ORDER_WINDOW_MS,
  RECENT_PAYMENT_WINDOW_MS,
  formatMskDate,
  isConversionOffered,
  isReturnOffered,
  planConversion,
  planReturn,
  type Blocker,
  type ConversionPlan,
  type ConversionSnapshot,
  type HomeMove,
  type ReturnPlan,
  type ReturnSnapshot,
} from "./org-conversion-core";
import type { RewardRule } from "./rewards";
import { ensurePartnerSchemaExtras, getCurrentRewardRule } from "./schema-extras";

type Client = Prisma.TransactionClient;

const PLATFORM_ORG_ID = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

/** Организации аккаунта, которые входят в тариф, — как в `loadBillingUnit`. */
function tariffScopeWhere(accountId: string): Prisma.OrganizationWhereInput {
  return { accountId, isDemo: false, kind: { not: "directory" }, id: { not: PLATFORM_ORG_ID() } };
}

class ConversionConflict extends Error {
  constructor(
    message: string,
    readonly status: number = 409,
  ) {
    super(message);
  }
}

// ======================================================================
// Перевод
// ======================================================================

async function loadConversionSnapshot(
  client: Client,
  input: {
    userId: string;
    organizationId: string;
    inForeignMode: boolean;
    now: Date;
    rule: RewardRule;
    settings: ConversionSnapshot["settings"];
  },
): Promise<ConversionSnapshot | null> {
  const { userId, organizationId, now } = input;
  // Запросы — по одному, не `Promise.all`: снимок читается и внутри
  // транзакции, а у неё одно соединение — параллельные запросы на нём
  // pg уже объявил устаревшими.
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organizationId: true,
      partnerMembership: {
        select: {
          partner: {
            select: {
              id: true,
              status: true,
              inn: true,
              companyName: true,
              applicantOrganizationId: true,
              branding: { select: { brandName: true } },
              members: { select: { userId: true } },
            },
          },
        },
      },
    },
  });
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      inn: true,
      isDemo: true,
      kind: true,
      deletionRequestedAt: true,
      accountId: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      recurringActive: true,
      balanceRub: true,
      members: { where: { userId }, select: { role: true } },
      account: {
        select: {
          id: true,
          ownerUserId: true,
          subscriptionPlan: true,
          subscriptionEnd: true,
          lifetimeDiscount: { select: { code: true, kind: true, value: true, revokedAt: true } },
          organizations: {
            select: {
              id: true,
              name: true,
              isDemo: true,
              kind: true,
              subscriptionEnd: true,
              createdAt: true,
              members: { where: { userId, role: "owner" }, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!user || !org) return null;

  const partnerRow = user.partnerMembership?.partner ?? null;
  const teamIds = (partnerRow?.members ?? []).map((m) => m.userId).filter((id) => id !== userId);

  const orgActive = await client.user.count({ where: { ...SEAT_USER_WHERE, organizationId } });
  let accountActive = 0;
  if (org.account) {
    const scope = await client.organization.findMany({ where: tariffScopeWhere(org.account.id), select: { id: true } });
    if (scope.length) {
      accountActive = await client.user.count({
        where: { ...SEAT_USER_WHERE, organizationId: { in: scope.map((r) => r.id) } },
      });
    }
  }
  const teamRows = teamIds.length
    ? await client.user.findMany({
        where: {
          id: { in: teamIds },
          OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }],
        },
        select: {
          id: true,
          name: true,
          organizationId: true,
          organizationMemberships: { where: { organizationId }, select: { id: true } },
        },
      })
    : [];
  const link = await client.partnerClient.findFirst({
    where: { organizationId, detachedAt: null },
    select: {
      partnerId: true,
      partner: { select: { companyName: true, branding: { select: { brandName: true } } } },
    },
  });
  const orders = await client.paymentOrder.findMany({
    where: {
      organizationId,
      OR: [
        { status: "pending", paymentMethod: "invoice" },
        { status: "pending", createdAt: { gte: new Date(now.getTime() - PENDING_CARD_ORDER_WINDOW_MS) } },
        { paidAt: { gte: new Date(now.getTime() - RECENT_PAYMENT_WINDOW_MS) } },
      ],
    },
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      amountRub: true,
      createdAt: true,
      paidAt: true,
      invoiceDueAt: true,
    },
    orderBy: { id: "desc" },
    take: 50,
  });

  const discount = org.account?.lifetimeDiscount;
  return {
    now,
    actor: { userId, homeOrganizationId: user.organizationId, inForeignMode: input.inForeignMode },
    partner: partnerRow
      ? {
          id: partnerRow.id,
          status: partnerRow.status,
          brandName: partnerRow.branding?.brandName ?? partnerRow.companyName,
          inn: partnerRow.inn,
          applicantOrganizationId: partnerRow.applicantOrganizationId,
        }
      : null,
    teamInOrganization: teamRows.map((m) => ({
      userId: m.id,
      name: m.name,
      livesHere: m.organizationId === organizationId,
      isMember: m.organizationMemberships.length > 0,
    })),
    organization: {
      id: org.id,
      name: org.name,
      inn: org.inn,
      isDemo: org.isDemo,
      kind: org.kind,
      isPlatform: org.id === PLATFORM_ORG_ID(),
      deletionRequested: Boolean(org.deletionRequestedAt),
      accountId: org.accountId,
      subscriptionPlan: org.subscriptionPlan,
      subscriptionEnd: org.subscriptionEnd,
      recurringActive: org.recurringActive,
      balanceRub: org.balanceRub,
      activeUsers: orgActive,
      actorMemberRole: org.members[0]?.role ?? null,
    },
    account: org.account
      ? {
          id: org.account.id,
          ownerUserId: org.account.ownerUserId,
          subscriptionPlan: org.account.subscriptionPlan,
          subscriptionEnd: org.account.subscriptionEnd,
          lifetimeDiscount:
            discount && !discount.revokedAt
              ? { code: discount.code, kind: discount.kind === "fixed" ? "fixed" : "percent", value: discount.value }
              : null,
          organizations: org.account.organizations.map((o) => ({
            id: o.id,
            name: o.name,
            isDemo: o.isDemo,
            kind: o.kind,
            subscriptionEnd: o.subscriptionEnd,
            createdAt: o.createdAt,
            actorIsOwnerMember: o.members.length > 0,
          })),
          activeUsers: accountActive,
        }
      : null,
    activeLink: link
      ? { partnerId: link.partnerId, brandName: link.partner.branding?.brandName ?? link.partner.companyName }
      : null,
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      paymentMethod: o.paymentMethod,
      amountRub: Number(o.amountRub),
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      invoiceDueAt: o.invoiceDueAt,
    })),
    rule: input.rule,
    settings: input.settings,
  };
}

export type ConversionPreview = {
  organizationId: string;
  organizationName: string;
  partnerBrandName: string;
  plan: ConversionPlan;
};

/**
 * Блок «Перевести в партнёрский кабинет» на `/settings/organization`.
 * null — блок не показывается: нет действующего партнёрского кабинета
 * или человек не владелец организации.
 */
export async function loadConversionPreview(input: {
  userId: string;
  organizationId: string;
  inForeignMode: boolean;
}): Promise<ConversionPreview | null> {
  // Дешёвый отсев: без партнёрского членства снимок не нужен вовсе.
  const membership = await db.partnerUser.findUnique({ where: { userId: input.userId }, select: { id: true } });
  if (!membership) return null;
  const [rule, settings] = await Promise.all([getCurrentRewardRule(), readFreePeriodSettings()]);
  const snapshot = await loadConversionSnapshot(db, { ...input, now: new Date(), rule, settings });
  if (!snapshot || !isConversionOffered(snapshot) || !snapshot.partner) return null;
  return {
    organizationId: snapshot.organization.id,
    organizationName: snapshot.organization.name,
    partnerBrandName: snapshot.partner.brandName,
    plan: planConversion(snapshot),
  };
}

export type ConversionResult =
  | {
      ok: true;
      organizationId: string;
      organizationName: string;
      partnerClientId: string;
      /** Куда переключить сессию: домашняя (возможно, новая) организация. */
      activeOrganizationId: string;
      homeMove: HomeMove | null;
      /** Новая версия сессий, если профиль переехал (текущую сессию переписать с ней). */
      sessionVersion: number | null;
    }
  | { ok: false; status: number; error: string; blockers: Blocker[] };

const RECURRING_REVOKE_STATEMENT =
  "Автопродление выключено: владелец перевёл организацию в свой партнёрский кабинет, дальше подписку оплачивает организация";

export async function convertOrganizationToPartnerClient(input: {
  userId: string;
  userEmail: string;
  actorName: string;
  organizationId: string;
  inForeignMode: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ConversionResult> {
  const { userId, organizationId } = input;
  await ensurePartnerSchemaExtras();
  const [rule, settings] = await Promise.all([getCurrentRewardRule(), readFreePeriodSettings()]);
  const now = new Date();

  let outcome:
    | { blocked: Blocker[] }
    | {
        plan: Extract<ConversionPlan, { ok: true }>;
        snapshot: ConversionSnapshot;
        partnerClientId: string;
      };
  try {
    outcome = await db.$transaction(
      async (tx) => {
        // Строка организации под замком: второй перевод, возврат или
        // оплата, меняющая срок, ждут окончания этой транзакции.
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
        const snapshot = await loadConversionSnapshot(tx, {
          userId,
          organizationId,
          inForeignMode: input.inForeignMode,
          now,
          rule,
          settings,
        });
        if (!snapshot) throw new ConversionConflict("Организация не найдена", 404);
        const plan = planConversion(snapshot);
        if (!plan.ok) return { blocked: plan.blockers };
        const { ops } = plan;

        await tx.organization.update({
          where: { id: organizationId },
          data: {
            accountId: null,
            subscriptionPlan: ops.organizationBilling.subscriptionPlan,
            subscriptionEnd: ops.organizationBilling.subscriptionEnd,
            ...(ops.disableRecurring
              ? { recurringActive: false, recurringDisabledAt: now, recurringFailedAttempts: 0 }
              : {}),
          },
        });
        if (ops.fromAccountId && ops.accountEndRaiseTo) {
          await tx.account.update({
            where: { id: ops.fromAccountId },
            data: { subscriptionEnd: ops.accountEndRaiseTo },
          });
        }
        if (ops.removeMemberUserIds.length > 0) {
          await tx.organizationMember.deleteMany({
            where: { organizationId, userId: { in: ops.removeMemberUserIds } },
          });
        }
        if (ops.homeMove) {
          // Должность и здания принадлежат старой организации — в новой
          // они были бы ссылками в чужие данные.
          await tx.user.update({
            where: { id: userId },
            data: {
              organizationId: ops.homeMove.toOrganizationId,
              jobPositionId: null,
              buildingIds: [],
              lastActiveBuildingId: null,
              lastActiveOrganizationId: ops.homeMove.toOrganizationId,
            },
          });
        } else {
          await tx.user.updateMany({
            where: { id: userId, lastActiveOrganizationId: organizationId },
            data: { lastActiveOrganizationId: snapshot.actor.homeOrganizationId },
          });
        }
        const link = await tx.partnerClient.create({
          data: {
            partnerId: ops.partnerId,
            organizationId,
            accessLevel: ops.link.accessLevel,
            source: ops.link.source,
            convertedByUserId: ops.link.convertedByUserId,
          },
          select: { id: true },
        });
        if (ops.disableRecurring) {
          // История согласий только пополняется — отзыв это новая строка.
          await tx.paymentConsent.create({
            data: {
              email: input.userEmail,
              organizationId,
              granted: false,
              statementText: RECURRING_REVOKE_STATEMENT,
              offerRevision: OFFER_REVISION,
              ipAddress: input.ipAddress ?? null,
              userAgent: input.userAgent?.slice(0, 500) ?? null,
            },
          });
        }
        return { plan, snapshot, partnerClientId: link.id };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof ConversionConflict) {
      return { ok: false, status: error.status, error: error.message, blockers: [] };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      console.info(`[partners] org convert conflict org=${organizationId} by=${userId}: already attached`);
      return {
        ok: false,
        status: 409,
        error: "У организации уже есть консультант",
        blockers: [{ code: "other_partner", message: "У организации уже есть консультант — обновите страницу." }],
      };
    }
    console.error(`[partners] org convert failed org=${organizationId} by=${userId}`, error);
    throw error;
  }

  if ("blocked" in outcome) {
    console.info(
      `[partners] org convert blocked org=${organizationId} by=${userId} reasons=${outcome.blocked.map((b) => b.code).join(",")}`,
    );
    return {
      ok: false,
      status: 409,
      error: outcome.blocked[0]?.message ?? "Перевод сейчас недоступен",
      blockers: outcome.blocked,
    };
  }

  const { plan, snapshot, partnerClientId } = outcome;
  const { ops } = plan;
  const organizationName = snapshot.organization.name;
  const brandName = snapshot.partner?.brandName ?? "партнёр";
  const activeOrganizationId = ops.homeMove?.toOrganizationId ?? snapshot.actor.homeOrganizationId;

  // Профиль переехал: токены на других устройствах всё ещё считают
  // домашней переведённую организацию — их нужно погасить.
  const sessionVersion = ops.homeMove ? await bumpSessionVersion(userId) : null;

  invalidateOrgBranding(organizationId);

  console.info(
    `[partners] org converted org=${organizationId} partner=${ops.partnerId} by=${userId} ` +
      `fromAccount=${ops.fromAccountId ?? "-"} plan=${ops.organizationBilling.subscriptionPlan} ` +
      `end=${ops.organizationBilling.subscriptionEnd?.toISOString() ?? "-"} ` +
      `accountEndRaised=${ops.accountEndRaiseTo?.toISOString() ?? "-"} recurringOff=${ops.disableRecurring} ` +
      `members-=${ops.removeMemberUserIds.length} homeMoved=${ops.homeMove?.toOrganizationId ?? "-"} link=${partnerClientId}`,
  );

  const details = {
    partnerId: ops.partnerId,
    partnerClientId,
    fromAccountId: ops.fromAccountId,
    subscriptionPlan: ops.organizationBilling.subscriptionPlan,
    subscriptionEnd: ops.organizationBilling.subscriptionEnd?.toISOString() ?? null,
    accountEndRaisedTo: ops.accountEndRaiseTo?.toISOString() ?? null,
    recurringDisabled: ops.disableRecurring,
    removedMemberUserIds: ops.removeMemberUserIds,
    homeMovedTo: ops.homeMove?.toOrganizationId ?? null,
    activeUsers: snapshot.organization.activeUsers,
  };
  await writeAudit([
    {
      organizationId,
      userId,
      userName: input.actorName,
      action: "partner.org_converted",
      entity: "organization",
      entityId: organizationId,
      details,
    },
    {
      organizationId: activeOrganizationId,
      userId,
      userName: input.actorName,
      action: "partner.org_converted",
      entity: "organization",
      entityId: organizationId,
      details: { ...details, organizationName },
    },
    ...(ops.homeMove
      ? [
          {
            organizationId: ops.homeMove.toOrganizationId,
            userId,
            userName: input.actorName,
            action: "user.home_moved",
            entity: "User",
            entityId: userId,
            details: { from: organizationId, to: ops.homeMove.toOrganizationId, reason: "partner.org_converted" },
          },
        ]
      : []),
  ]);

  await notifyAboutConversion({
    userId,
    actorName: input.actorName,
    organizationId,
    organizationName,
    brandName,
    partnerClientId,
    activeOrganizationId,
    snapshot,
    ops,
  });

  return {
    ok: true,
    organizationId,
    organizationName,
    partnerClientId,
    activeOrganizationId,
    homeMove: ops.homeMove,
    sessionVersion,
  };
}

async function writeAudit(
  rows: Array<{
    organizationId: string;
    userId: string;
    userName: string;
    action: string;
    entity: string;
    entityId: string;
    details: Record<string, unknown>;
  }>,
): Promise<void> {
  for (const row of rows) {
    try {
      await db.auditLog.create({ data: { ...row, details: row.details as Prisma.InputJsonValue } });
    } catch (error) {
      // Перевод уже случился — аудит не должен его откатывать, только лог.
      console.error(`[partners] audit write failed action=${row.action} org=${row.organizationId}`, error);
    }
  }
}

/**
 * Три адресата, все best-effort: сам человек (колокольчик — что дальше),
 * руководство организации (кто теперь платит) и платформа (перевод меняет,
 * кому идёт комиссия, — это видно сразу).
 */
async function notifyAboutConversion(input: {
  userId: string;
  actorName: string;
  organizationId: string;
  organizationName: string;
  brandName: string;
  partnerClientId: string;
  activeOrganizationId: string;
  snapshot: ConversionSnapshot;
  ops: Extract<ConversionPlan, { ok: true }>["ops"];
}): Promise<void> {
  const { organizationId, organizationName, partnerClientId } = input;
  const end = input.ops.organizationBilling.subscriptionEnd;
  const hidden = await isPartnerHiddenForOrg(organizationId).catch(() => false);
  const results = await Promise.allSettled([
    upsertNotification({
      organizationId: input.activeOrganizationId,
      userId: input.userId,
      kind: "partner_org_converted",
      dedupeKey: `partner-org-converted-${partnerClientId}`,
      title: `«${organizationName}» — теперь клиент вашего партнёрского кабинета`,
      linkHref: `/partner/clients/${organizationId}`,
      linkLabel: "Карточка клиента",
      items: [
        {
          id: partnerClientId,
          label: "Передайте организацию владельцу",
          hint: "«Передать клиенту» в карточке",
        },
      ],
    }),
    notifyManagement({
      organizationId,
      kind: "partner_org_converted",
      dedupeKey: `partner-org-converted-${partnerClientId}`,
      title: hidden
        ? `Организацию сопровождает ${NEUTRAL_SUPPORT_NAME}`
        : `Организацию сопровождает консультант ${input.brandName}`,
      linkHref: "/settings/consultant",
      linkLabel: "Консультант",
      items: [
        {
          id: partnerClientId,
          label: "Подписку организации дальше оплачивает сама организация",
          hint: end ? `оплачено до ${formatMskDate(end)}` : undefined,
        },
      ],
    }),
    notifyPlatformAdmin(
      `🔁 Партнёр <b>${escapeTelegramHtml(input.brandName)}</b>: владелец перевёл свою организацию ` +
        `<b>${escapeTelegramHtml(organizationName)}</b> в клиенты\n` +
        `Кто: ${escapeTelegramHtml(input.actorName)}\n` +
        `Тариф: ${escapeTelegramHtml(input.ops.organizationBilling.subscriptionPlan)}` +
        (end ? `, оплачено до ${formatMskDate(end)}` : "") +
        (input.ops.homeMove ? `\nПрофиль переехал в «${escapeTelegramHtml(input.ops.homeMove.toOrganizationName)}»` : ""),
      { kind: "partner-org-converted", dedupeKey: `partner-org-converted-${partnerClientId}` },
    ),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[partners] org converted notify failed org=${organizationId}`, result.reason);
    }
  }
}

// ======================================================================
// Возврат
// ======================================================================

async function loadReturnSnapshot(
  client: Client,
  input: {
    partnerId: string;
    userId: string;
    organizationId: string;
    now: Date;
    settings: ReturnSnapshot["settings"];
  },
): Promise<ReturnSnapshot | null> {
  const { partnerId, userId, organizationId, now } = input;
  // По одному запросу — снимок читается и внутри транзакции (см. перевод).
  const link = await client.partnerClient.findFirst({
    where: { partnerId, organizationId },
    orderBy: { attachedAt: "desc" },
    select: { id: true, source: true, convertedByUserId: true, attachedAt: true, detachedAt: true },
  });
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      accountId: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      members: {
        where: { role: "owner" },
        take: 1,
        select: {
          user: {
            select: {
              id: true,
              email: true,
              isActive: true,
              passwordHash: true,
              lastLoginAt: true,
              inviteToken: { select: { usedAt: true } },
              ownedAccount: { select: { id: true, _count: { select: { organizations: true } } } },
            },
          },
        },
      },
    },
  });
  const account = await client.account.findUnique({
    where: { ownerUserId: userId },
    select: {
      id: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      organizations: {
        where: { isDemo: false, kind: { not: "directory" }, id: { not: organizationId } },
        select: { id: true, subscriptionEnd: true },
      },
    },
  });
  if (!org) return null;

  const orgActive = await client.user.count({ where: { ...SEAT_USER_WHERE, organizationId } });
  const accountActive =
    account && account.organizations.length
      ? await client.user.count({
          where: { ...SEAT_USER_WHERE, organizationId: { in: account.organizations.map((o) => o.id) } },
        })
      : 0;
  // Оплаты после перевода: с этого момента организацию оплачивает клиент.
  const paidAfter = link
    ? await client.paymentOrder.count({
        where: {
          organizationId,
          status: { in: [...PAID_ORDER_STATUSES] },
          refundedAt: null,
          paidAt: { gte: link.attachedAt },
        },
      })
    : 0;

  const ownerUser = org.members[0]?.user ?? null;
  return {
    now,
    actor: { userId },
    partnerId,
    link: link
      ? {
          id: link.id,
          source: link.source,
          convertedByUserId: link.convertedByUserId,
          attachedAt: link.attachedAt,
          detachedAt: link.detachedAt,
        }
      : null,
    organization: {
      id: org.id,
      name: org.name,
      accountId: org.accountId,
      subscriptionPlan: org.subscriptionPlan,
      subscriptionEnd: org.subscriptionEnd,
      activeUsers: orgActive,
    },
    owner: ownerUser
      ? {
          userId: ownerUser.id,
          email: ownerUser.email,
          isActive: ownerUser.isActive,
          // Заглушка приглашения: не входил, пароля нет, ссылкой не воспользовался.
          isPendingInvite:
            !ownerUser.isActive &&
            ownerUser.passwordHash === "" &&
            !ownerUser.lastLoginAt &&
            Boolean(ownerUser.inviteToken) &&
            !ownerUser.inviteToken?.usedAt,
          accountId: ownerUser.ownedAccount?.id ?? null,
          accountOrganizations: ownerUser.ownedAccount?._count.organizations ?? 0,
        }
      : null,
    paidOrdersAfterConversion: paidAfter,
    account: account
      ? {
          id: account.id,
          subscriptionPlan: account.subscriptionPlan,
          subscriptionEnd: account.subscriptionEnd,
          organizationEnds: account.organizations.map((o) => o.subscriptionEnd),
          activeUsers: accountActive,
        }
      : null,
    settings: input.settings,
  };
}

export type ReturnPreview = { offered: boolean; plan: ReturnPlan };

/** Карточка клиента: предлагать ли «Сделать моей организацией» и что будет. */
export async function loadReturnPreview(input: {
  partnerId: string;
  userId: string;
  organizationId: string;
}): Promise<ReturnPreview | null> {
  const settings = await readFreePeriodSettings();
  const snapshot = await loadReturnSnapshot(db, { ...input, now: new Date(), settings });
  if (!snapshot) return null;
  return { offered: isReturnOffered(snapshot), plan: planReturn(snapshot) };
}

export type ReturnResult =
  | { ok: true; organizationId: string; organizationName: string; accountId: string; inviteRevoked: boolean }
  | { ok: false; status: number; error: string; blockers: Blocker[] };

export async function returnClientToOwnAccount(input: {
  partnerId: string;
  brandName: string;
  userId: string;
  actorName: string;
  organizationId: string;
}): Promise<ReturnResult> {
  const { partnerId, userId, organizationId } = input;
  const settings = await readFreePeriodSettings();
  const now = new Date();

  let outcome:
    | { blocked: Blocker[] }
    | { plan: Extract<ReturnPlan, { ok: true }>; snapshot: ReturnSnapshot; accountId: string };
  try {
    outcome = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
        const snapshot = await loadReturnSnapshot(tx, { partnerId, userId, organizationId, now, settings });
        if (!snapshot) throw new ConversionConflict("Организация не найдена", 404);
        const plan = planReturn(snapshot);
        if (!plan.ok) return { blocked: plan.blockers };
        const { ops } = plan;

        if (ops.revokeOwner) {
          // Заглушка приглашения: удаляем вместе с её пустым аккаунтом
          // (каскад), ссылка из письма перестаёт работать. Условия —
          // ещё раз в самом запросе: принявший приглашение не удалится.
          const removed = await tx.user.deleteMany({
            where: { id: ops.revokeOwner.userId, isActive: false, passwordHash: "", lastLoginAt: null },
          });
          if (removed.count !== 1) {
            throw new ConversionConflict("Клиент только что принял приглашение — обновите страницу");
          }
        }
        const { accountId } = await attachAccountForNewOrganization(tx, {
          ownerUserId: userId,
          organizationId,
          subscriptionPlan: ops.attach.subscriptionPlan,
          subscriptionEnd: ops.attach.subscriptionEnd,
        });
        await tx.partnerClient.update({
          where: { id: ops.linkId },
          data: { detachedAt: now, detachedBy: "partner" },
        });
        return { plan, snapshot, accountId };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof ConversionConflict) {
      return { ok: false, status: error.status, error: error.message, blockers: [] };
    }
    console.error(`[partners] org return failed org=${organizationId} by=${userId}`, error);
    throw error;
  }

  if ("blocked" in outcome) {
    console.info(
      `[partners] org return blocked org=${organizationId} partner=${partnerId} by=${userId} reasons=${outcome.blocked.map((b) => b.code).join(",")}`,
    );
    return {
      ok: false,
      status: 409,
      error: outcome.blocked[0]?.message ?? "Вернуть организацию сейчас нельзя",
      blockers: outcome.blocked,
    };
  }

  const { plan, snapshot, accountId } = outcome;
  const { ops } = plan;
  invalidateOrgBranding(organizationId);

  console.info(
    `[partners] org returned org=${organizationId} partner=${partnerId} by=${userId} account=${accountId} ` +
      `plan=${snapshot.organization.subscriptionPlan} end=${snapshot.organization.subscriptionEnd?.toISOString() ?? "-"} ` +
      `inviteRevoked=${ops.revokeOwner ? ops.revokeOwner.email : "-"} link=${ops.linkId}`,
  );

  const home = await db.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  const details = {
    partnerId,
    partnerClientId: ops.linkId,
    accountId,
    subscriptionPlan: snapshot.organization.subscriptionPlan,
    subscriptionEnd: snapshot.organization.subscriptionEnd?.toISOString() ?? null,
    revokedInviteEmail: ops.revokeOwner?.email ?? null,
    activeUsers: snapshot.organization.activeUsers,
  };
  await writeAudit([
    {
      organizationId,
      userId,
      userName: input.actorName,
      action: "partner.org_returned",
      entity: "organization",
      entityId: organizationId,
      details,
    },
    ...(home && home.organizationId !== organizationId
      ? [
          {
            organizationId: home.organizationId,
            userId,
            userName: input.actorName,
            action: "partner.org_returned",
            entity: "organization",
            entityId: organizationId,
            details: { ...details, organizationName: snapshot.organization.name },
          },
        ]
      : []),
  ]);

  await notifyPlatformAdmin(
    `↩️ Партнёр <b>${escapeTelegramHtml(input.brandName)}</b>: организация <b>${escapeTelegramHtml(snapshot.organization.name)}</b> ` +
      `возвращена в личный аккаунт, сопровождение завершено\nКто: ${escapeTelegramHtml(input.actorName)}` +
      (ops.revokeOwner ? `\nОтменено приглашение владельцу: ${escapeTelegramHtml(ops.revokeOwner.email)}` : ""),
    { kind: "partner-org-returned", dedupeKey: `partner-org-returned-${ops.linkId}` },
  ).catch((error) => console.error(`[partners] org returned notify failed org=${organizationId}`, error));

  return {
    ok: true,
    organizationId,
    organizationName: snapshot.organization.name,
    accountId,
    inviteRevoked: Boolean(ops.revokeOwner),
  };
}

/** Для карточки клиента: переведена ли организация самим партнёром. */
export function isConvertedSource(source: string): boolean {
  return source === CONVERTED_SOURCE;
}
