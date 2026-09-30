import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { TOPUP_TARIFF_KEY } from "@/lib/balance/topup-core";
import {
  BILLING_LIMIT_CODE,
  BILLING_PAY_HREF,
  DEFAULT_FREE_PERIOD,
  FREE_LIMIT_INVITEE_MESSAGE,
  FREE_LIMIT_MESSAGE,
  FREE_PERIOD_SETTING_KEY,
  checkSeats,
  computeAccountBilling,
  decideTransitionAction,
  formatMskDay,
  formatPriceRub,
  isBillingEnforced,
  normalizeFreePeriodSettings,
  pickKeeper,
  serializeFreePeriodSettings,
  type AccountBillingKind,
  type AccountBillingState,
  type FreePeriodSettings,
  type TransitionAction,
} from "@/lib/billing-period";
import { COMMISSION_CATEGORY_KEY, NOT_COMMISSION_WHERE } from "@/lib/journal-roster";
import { masterCabinetSeatsByOrg, NOT_MASTER_CABINET_STAFF_WHERE } from "@/lib/master-cabinet-seats";
import { FREE_MAX_USERS, isFreePlan, isInactivePlan } from "@/lib/plan-limits";
import { employeesLabel } from "@/lib/plan-catalog";
import { forgetSessionVersions } from "@/lib/session-version";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Серверная часть перехода на оплату (2026-10): настройки периода из
 * `PlatformSetting`, загрузка тарифа аккаунта, проверка мест до создания
 * или возврата сотрудника, переход на бесплатный (руководитель, грейс,
 * тихий) и ежедневная задача. Решения — в чистом `billing-period.ts`.
 *
 * Логи — `console.info("[billing] …")` на каждом переходе; аудит — в
 * журнал действий каждой затронутой организации.
 */

const PLATFORM_ORG_ID = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

const APP_URL = (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(
  /\/+$/,
  ""
);

/**
 * Кто занимает место в тарифе: активный, не в архиве, не ROOT, не член
 * сторонней бракеражной комиссии (владелец, 2026-09-21).
 */
export const SEAT_USER_WHERE: Prisma.UserWhereInput = {
  isActive: true,
  archivedAt: null,
  isRoot: false,
  ...NOT_COMMISSION_WHERE,
  // Люди мастер-кабинета мест не занимают: сам кабинет — +1 сотрудник в
  // каждом подключённом пищеблоке (`master-cabinet-seats.ts`).
  ...NOT_MASTER_CABINET_STAFF_WHERE,
};

export const AUDIT_ACTIONS = {
  manual: "billing.transition.manual_free",
  auto: "billing.transition.auto_free",
  silent: "billing.transition.silent_free",
  reminder: "billing.transition.reminder",
  settings: "billing.free_period.updated",
} as const;

// ---------------------------------------------------------------- settings

export async function readFreePeriodSettings(): Promise<FreePeriodSettings> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: FREE_PERIOD_SETTING_KEY } });
    if (!row) return DEFAULT_FREE_PERIOD;
    return normalizeFreePeriodSettings(JSON.parse(row.value));
  } catch (error) {
    console.error("[billing] free-period settings read failed — using defaults", error);
    return DEFAULT_FREE_PERIOD;
  }
}

export async function writeFreePeriodSettings(
  next: FreePeriodSettings,
  actor: { userId: string; userName: string | null; organizationId: string; ipAddress?: string | null }
): Promise<FreePeriodSettings> {
  const before = await readFreePeriodSettings();
  const value = serializeFreePeriodSettings(next);
  await db.platformSetting.upsert({
    where: { key: FREE_PERIOD_SETTING_KEY },
    create: { key: FREE_PERIOD_SETTING_KEY, value },
    update: { value },
  });
  console.info("[billing] free-period settings updated", {
    by: actor.userId,
    before: JSON.parse(serializeFreePeriodSettings(before)),
    after: JSON.parse(value),
  });
  try {
    await db.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        userName: actor.userName,
        action: AUDIT_ACTIONS.settings,
        entity: "platform_setting",
        entityId: FREE_PERIOD_SETTING_KEY,
        details: {
          before: JSON.parse(serializeFreePeriodSettings(before)),
          after: JSON.parse(value),
        },
        ipAddress: actor.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error("[billing] settings audit write failed", error);
  }
  return normalizeFreePeriodSettings(JSON.parse(value));
}

// ------------------------------------------------------------ billing unit

/**
 * Единица биллинга — аккаунт (сеть из нескольких точек платит один раз),
 * а для организаций без аккаунта (до миграции) — сама организация.
 */
export type BillingUnit = {
  key: string;
  accountId: string | null;
  ownerUserId: string | null;
  /** Организация, из которой смотрим (для окна и аудита). */
  organizationId: string;
  organizationName: string;
  /** Организации, которые входят в тариф (без демо и мастер-кабинета). */
  scopeOrgIds: string[];
  plan: string;
  /** Самый поздний срок подписки по аккаунту и его организациям. */
  subscriptionEnd: Date | null;
  activeUsers: number;
  exempt: boolean;
  /** Пауза/отмена: для окна — у текущей организации, для задачи — у всех. */
  inactive: boolean;
};

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

export async function loadBillingUnit(organizationId: string): Promise<BillingUnit | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      accountId: true,
      isDemo: true,
      kind: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      account: {
        select: { id: true, ownerUserId: true, subscriptionPlan: true, subscriptionEnd: true },
      },
    },
  });
  if (!org) return null;

  const exempt = org.id === PLATFORM_ORG_ID() || org.isDemo || org.kind === "directory";
  const scopeOrgs = exempt
    ? []
    : org.accountId
      ? await db.organization.findMany({
          where: {
            accountId: org.accountId,
            isDemo: false,
            kind: { not: "directory" },
            id: { not: PLATFORM_ORG_ID() },
          },
          select: { id: true, subscriptionEnd: true },
        })
      : [{ id: org.id, subscriptionEnd: org.subscriptionEnd }];
  const scopeOrgIds = scopeOrgs.map((o) => o.id);

  const [peopleSeats, cabinetSeats] = scopeOrgIds.length
    ? await Promise.all([
        db.user.count({ where: { ...SEAT_USER_WHERE, organizationId: { in: scopeOrgIds } } }),
        masterCabinetSeatsByOrg(scopeOrgIds),
      ])
    : [0, new Map<string, number>()];
  const activeUsers = peopleSeats + [...cabinetSeats.values()].reduce((sum, n) => sum + n, 0);

  return {
    key: org.accountId ?? `org:${org.id}`,
    accountId: org.accountId,
    ownerUserId: org.account?.ownerUserId ?? null,
    organizationId: org.id,
    organizationName: org.name,
    scopeOrgIds,
    plan: org.account?.subscriptionPlan ?? org.subscriptionPlan,
    subscriptionEnd: maxDate([org.account?.subscriptionEnd, ...scopeOrgs.map((o) => o.subscriptionEnd)]),
    activeUsers,
    exempt,
    inactive: isInactivePlan(org.subscriptionPlan),
  };
}

export function stateForUnit(
  unit: BillingUnit,
  settings: FreePeriodSettings,
  now: Date
): AccountBillingState {
  return computeAccountBilling(
    {
      plan: unit.plan,
      subscriptionEnd: unit.subscriptionEnd,
      activeUsers: unit.activeUsers,
      exempt: unit.exempt,
      inactive: unit.inactive,
    },
    settings,
    now
  );
}

export type LoadedBilling = {
  unit: BillingUnit;
  settings: FreePeriodSettings;
  state: AccountBillingState;
};

/** Тариф и состояние перехода для организации (с учётом всего аккаунта). */
export async function loadAccountBilling(
  organizationId: string,
  now: Date = new Date()
): Promise<LoadedBilling | null> {
  const [unit, settings] = await Promise.all([
    loadBillingUnit(organizationId),
    readFreePeriodSettings(),
  ]);
  if (!unit) return null;
  return { unit, settings, state: stateForUnit(unit, settings, now) };
}

// -------------------------------------------------------------- seat guard

export type SeatGuard =
  | { ok: true }
  | {
      ok: false;
      status: 402;
      error: string;
      code: typeof BILLING_LIMIT_CODE;
      payUrl: string;
      limit: number;
      activeUsers: number;
    };

/**
 * Можно ли сделать активными ещё `adding` сотрудников организации.
 * Вызывается ДО создания или возврата из архива на каждом пути. До конца
 * бесплатного периода, на оплаченной подписке и вне тарифа — всегда да.
 */
export async function checkSeatsForActivation(
  organizationId: string,
  adding: number,
  options: { source: string; audience?: "manager" | "invitee" }
): Promise<SeatGuard> {
  if (!(adding > 0)) return { ok: true };
  const loaded = await loadAccountBilling(organizationId).catch((error) => {
    // База легла — не блокируем работу из-за проверки тарифа.
    console.error("[billing] seat check failed to load — allowing", { organizationId, error });
    return null;
  });
  if (!loaded) return { ok: true };
  const check = checkSeats(loaded.state, adding);
  if (check.ok) return { ok: true };
  console.info("[billing] seat limit: blocked", {
    organizationId,
    source: options.source,
    kind: loaded.state.kind,
    activeUsers: check.activeUsers,
    adding,
    limit: check.limit,
  });
  return {
    ok: false,
    status: 402,
    error: options.audience === "invitee" ? FREE_LIMIT_INVITEE_MESSAGE : check.message,
    code: BILLING_LIMIT_CODE,
    payUrl: BILLING_PAY_HREF,
    limit: check.limit,
    activeUsers: check.activeUsers,
  };
}

/**
 * Сколько ещё активных можно добавить — для импорта списком, где строки
 * проверяются по одной ДО создания каждой. Infinity — без ограничения.
 */
export async function seatAllowance(
  organizationId: string
): Promise<{ left: number; limit: number | null }> {
  const loaded = await loadAccountBilling(organizationId).catch((error) => {
    console.error("[billing] seat allowance failed to load — allowing", { organizationId, error });
    return null;
  });
  const limit = loaded?.state.seatLimit ?? null;
  if (!loaded || limit === null) return { left: Number.POSITIVE_INFINITY, limit: null };
  return { left: Math.max(0, limit - loaded.state.activeUsers), limit };
}

/** Итог импорта списком, если часть строк упёрлась в лимит тарифа. */
export function seatLimitSummary(blocked: number, source: string, organizationId: string) {
  if (blocked <= 0) return null;
  console.info("[billing] seat limit: import rows blocked", { organizationId, source, blocked });
  return {
    code: BILLING_LIMIT_CODE,
    error: FREE_LIMIT_MESSAGE,
    payUrl: BILLING_PAY_HREF,
    blocked,
  };
}

/** Сотрудник уже занимает место (активен, не в архиве). */
function occupiesSeat(user: {
  isActive: boolean;
  archivedAt: Date | null;
  isRoot: boolean;
  jobPosition: { categoryKey: string } | null;
}): boolean {
  return user.isActive && !user.archivedAt && !user.isRoot && !isCommission(user);
}

function isCommission(user: { jobPosition: { categoryKey: string } | null }): boolean {
  return user.jobPosition?.categoryKey === COMMISSION_CATEGORY_KEY;
}

/**
 * Проверка перед активацией существующего пользователя (возврат из
 * архива, пароль, приглашение, привязка Telegram). Уже активный, ROOT и
 * сторонняя комиссия места не добавляют.
 */
export async function checkUserActivation(
  userId: string,
  options: { source: string; audience?: "manager" | "invitee" }
): Promise<SeatGuard> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      organizationId: true,
      isActive: true,
      archivedAt: true,
      isRoot: true,
      jobPosition: { select: { categoryKey: true } },
    },
  });
  if (!user || user.isRoot || isCommission(user) || occupiesSeat(user)) return { ok: true };
  return checkSeatsForActivation(user.organizationId, 1, options);
}

/** Ответ 402 с кодом и ссылкой на оплату — клиент покажет «Оплатить». */
export function seatLimitResponse(guard: Extract<SeatGuard, { ok: false }>): NextResponse {
  return NextResponse.json(
    {
      error: guard.error,
      code: guard.code,
      payUrl: guard.payUrl,
      limit: guard.limit,
      activeUsers: guard.activeUsers,
    },
    { status: guard.status }
  );
}

/**
 * Выставлен счёт по безналу, срок оплаты не прошёл: решение «платим»
 * уже принято, деньги идут днями — окно не давит, автопереход ждёт.
 */
export async function hasPendingInvoice(orgIds: string[], now: Date = new Date()): Promise<boolean> {
  if (orgIds.length === 0) return false;
  const count = await db.paymentOrder.count({
    where: {
      organizationId: { in: orgIds },
      paymentMethod: "invoice",
      status: "pending",
      // Счёт на пополнение баланса — не решение «платим за подписку».
      tariffKey: { not: TOPUP_TARIFF_KEY },
      OR: [{ invoiceDueAt: null }, { invoiceDueAt: { gt: now } }],
    },
  });
  return count > 0;
}

// ------------------------------------------------------------- transition

export type TransitionCandidate = {
  id: string;
  name: string;
  position: string | null;
  organizationName: string;
  isOwner: boolean;
  isManagement: boolean;
  /** Может войти в кабинет: есть пароль или привязан Telegram. */
  canSignIn: boolean;
  createdAt: Date;
};

export async function listTransitionCandidates(unit: BillingUnit): Promise<TransitionCandidate[]> {
  if (unit.scopeOrgIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { ...SEAT_USER_WHERE, organizationId: { in: unit.scopeOrgIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      canManageSettings: true,
      passwordHash: true,
      telegramChatId: true,
      createdAt: true,
      jobPosition: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    position: u.jobPosition?.name?.trim() || u.positionTitle?.trim() || null,
    organizationName: u.organization.name,
    isOwner: u.id === unit.ownerUserId,
    isManagement: isManagementRole(u.role) || u.canManageSettings,
    canSignIn: Boolean(u.passwordHash) || Boolean(u.telegramChatId),
    createdAt: u.createdAt,
  }));
}

export type TransitionMode = "manual" | "auto" | "silent";

export type TransitionResult =
  | {
      ok: true;
      noop: boolean;
      keptUserId: string | null;
      keptUserName: string | null;
      archivedCount: number;
      archivedNames: string[];
      archivedUserIds: string[];
    }
  | { ok: false; status: number; error: string };

/**
 * Переход аккаунта на бесплатный тариф: один остаётся, остальные — в
 * архив (`isActive=false`, `archivedAt`, сессии завершаются), тариф
 * `free` на аккаунте и зеркалах организаций (паузу не снимаем — только
 * `pausedFromPlan`), аудит в каждую затронутую организацию.
 *
 * Состояние перепроверяется под advisory-lock аккаунта: два руководителя
 * или руководитель и ночная задача не выполнят переход дважды.
 */
export async function transitionToFree(args: {
  organizationId: string;
  mode: TransitionMode;
  /** Кого оставить (manual). Для auto/silent — владелец аккаунта. */
  keepUserId?: string | null;
  actor: { userId: string | null; userName: string | null; ipAddress?: string | null };
  now?: Date;
}): Promise<TransitionResult> {
  const now = args.now ?? new Date();
  const first = await loadBillingUnit(args.organizationId);
  if (!first) return { ok: false, status: 404, error: "Организация не найдена" };

  const locked = await withAdvisoryTryLock(
    advisoryLockKey("billing-transition", first.key),
    async (): Promise<TransitionResult> => {
      // Перечитываем под замком: пока ждали, могли оплатить или уже перейти.
      const unit = await loadBillingUnit(args.organizationId);
      if (!unit) return { ok: false, status: 404, error: "Организация не найдена" };
      const settings = await readFreePeriodSettings();
      const state = stateForUnit(unit, settings, now);

      if (state.kind === "paid") {
        return { ok: false, status: 409, error: "Подписка уже оплачена — переходить на бесплатный не нужно" };
      }
      if (state.kind === "exempt") {
        return { ok: false, status: 409, error: "У этой организации нет тарифа" };
      }
      if (!state.enforcement) {
        return { ok: false, status: 409, error: "Бесплатный период ещё идёт — выбирать тариф пока не нужно" };
      }

      const candidates = await listTransitionCandidates(unit);
      let keeper: TransitionCandidate | null = null;
      if (args.mode === "manual") {
        keeper = candidates.find((c) => c.id === args.keepUserId) ?? null;
        if (!keeper) {
          return { ok: false, status: 400, error: "Выберите, кто останется, из активных сотрудников" };
        }
      } else {
        const keeperId = pickKeeper(candidates, unit.ownerUserId);
        keeper = candidates.find((c) => c.id === keeperId) ?? null;
      }

      const toArchive = candidates.filter((c) => c.id !== keeper?.id);
      if (args.mode === "silent" && toArchive.length > 0) {
        // Тихий переход — только когда архивировать некого.
        return { ok: false, status: 409, error: "Активных больше одного — нужно решение руководителя" };
      }
      const planBefore = unit.plan;
      if (toArchive.length === 0 && isFreePlan(planBefore)) {
        return {
          ok: true,
          noop: true,
          keptUserId: keeper?.id ?? null,
          keptUserName: keeper?.name ?? null,
          archivedCount: 0,
          archivedNames: [],
          archivedUserIds: [],
        };
      }

      const archiveIds = toArchive.map((c) => c.id);
      const archivedOrgIds = await db.user.findMany({
        where: { id: { in: archiveIds } },
        select: { organizationId: true },
        distinct: ["organizationId"],
      });

      await db.$transaction(async (tx) => {
        if (archiveIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: archiveIds }, ...SEAT_USER_WHERE },
            data: { isActive: false, archivedAt: now, sessionVersion: { increment: 1 } },
          });
        }
        if (unit.accountId) {
          await tx.account.update({
            where: { id: unit.accountId },
            data: { subscriptionPlan: "free" },
          });
        }
        // Зеркала: пауза и отмена остаются как есть, но «Возобновить»
        // вернёт уже на бесплатный, а не на тестовый «платный».
        await tx.organization.updateMany({
          where: { id: { in: unit.scopeOrgIds }, subscriptionPlan: { notIn: ["paused", "cancelled"] } },
          data: { subscriptionPlan: "free" },
        });
        await tx.organization.updateMany({
          where: { id: { in: unit.scopeOrgIds }, subscriptionPlan: "paused" },
          data: { pausedFromPlan: "free" },
        });
        const auditOrgIds = new Set([unit.organizationId, ...archivedOrgIds.map((r) => r.organizationId)]);
        for (const orgId of auditOrgIds) {
          await tx.auditLog.create({
            data: {
              organizationId: orgId,
              userId: args.actor.userId,
              userName: args.actor.userName ?? (args.mode === "manual" ? null : "WeSetup"),
              action: AUDIT_ACTIONS[args.mode],
              entity: unit.accountId ? "account" : "organization",
              entityId: unit.accountId ?? unit.organizationId,
              details: {
                mode: args.mode,
                reason: state.reason,
                keptUserName: keeper?.name ?? null,
                keptUserId: keeper?.id ?? null,
                archivedCount: archiveIds.length,
                archived: toArchive.slice(0, 50).map((c) => c.name),
                archivedUserIds: archiveIds,
                activeUsersBefore: candidates.length,
                planBefore,
                graceEndsAt: state.graceEndsAt?.toISOString() ?? null,
              },
              ipAddress: args.actor.ipAddress ?? null,
            },
          });
        }
      });
      forgetSessionVersions(archiveIds);

      console.info("[billing] transition → free", {
        unit: unit.key,
        organizationId: unit.organizationId,
        mode: args.mode,
        reason: state.reason,
        kept: keeper?.id ?? null,
        archived: archiveIds.length,
        planBefore,
        actor: args.actor.userId,
      });

      return {
        ok: true,
        noop: false,
        keptUserId: keeper?.id ?? null,
        keptUserName: keeper?.name ?? null,
        archivedCount: archiveIds.length,
        archivedNames: toArchive.map((c) => c.name),
        archivedUserIds: archiveIds,
      };
    }
  );

  if (!locked.acquired) {
    console.warn("[billing] transition lock busy", { organizationId: args.organizationId, mode: args.mode });
    return { ok: false, status: 409, error: "Тариф уже меняется — обновите страницу через минуту" };
  }
  const result = locked.value;
  if (result.ok && !result.noop) {
    await notifyTransition({ organizationId: args.organizationId, mode: args.mode, result }).catch((error) =>
      console.error("[billing] transition notify failed", error)
    );
  }
  return result;
}

// ---------------------------------------------------------- notifications

type OwnerContact = {
  userId: string;
  name: string;
  email: string | null;
  telegram: boolean;
};

async function ownerContact(organizationId: string): Promise<OwnerContact | null> {
  const unit = await loadBillingUnit(organizationId);
  const { isTechnicalEmail } = await import("@/lib/technical-email");
  const pick = (u: {
    id: string;
    name: string;
    email: string;
    contactEmail: string | null;
    telegramChatId: string | null;
  }): OwnerContact => {
    const email =
      [u.contactEmail, u.email]
        .map((v) => (v ?? "").trim())
        .find((v) => v.includes("@") && !isTechnicalEmail(v)) ?? null;
    return { userId: u.id, name: u.name, email, telegram: Boolean(u.telegramChatId) };
  };
  const select = { id: true, name: true, email: true, contactEmail: true, telegramChatId: true } as const;
  if (unit?.ownerUserId) {
    const owner = await db.user.findUnique({ where: { id: unit.ownerUserId }, select });
    if (owner) return pick(owner);
  }
  // Организация без аккаунта — самый давний руководитель.
  const manager = await db.user.findFirst({
    where: { organizationId, isActive: true, archivedAt: null, isRoot: false, role: { in: ["manager", "owner", "head_chef", "technologist"] } },
    orderBy: { createdAt: "asc" },
    select,
  });
  return manager ? pick(manager) : null;
}

async function sendOwnerNotice(args: {
  organizationId: string;
  kind: string;
  telegramText: string;
  email?: { subject: string; title: string; html: string } | null;
  /** Письмо — только если Telegram не привязан. */
  emailOnlyWithoutTelegram?: boolean;
}): Promise<{ telegram: boolean; email: boolean }> {
  const owner = await ownerContact(args.organizationId);
  if (!owner) return { telegram: false, email: false };
  let telegram = false;
  let email = false;
  if (owner.telegram) {
    try {
      const { notifyEmployee } = await import("@/lib/telegram");
      await notifyEmployee(
        owner.userId,
        args.telegramText,
        { label: "Открыть тариф", miniAppUrl: BILLING_PAY_HREF },
        { delivery: { organizationId: args.organizationId, kind: args.kind } }
      );
      telegram = true;
    } catch (error) {
      console.error("[billing] telegram notice failed", { kind: args.kind, error });
    }
  }
  if (args.email && owner.email && !(args.emailOnlyWithoutTelegram && owner.telegram)) {
    try {
      const { emailBrandForOrganization, renderEmailLayout, sendRawEmail } = await import("@/lib/email");
      const html = renderEmailLayout(
        args.email.title,
        args.email.html,
        await emailBrandForOrganization(args.organizationId)
      );
      email = await sendRawEmail(owner.email, args.email.subject, html);
    } catch (error) {
      console.error("[billing] email notice failed", { kind: args.kind, error });
    }
  }
  console.info("[billing] owner notice", {
    organizationId: args.organizationId,
    kind: args.kind,
    owner: owner.userId,
    telegram,
    email,
  });
  return { telegram, email };
}

const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
const BOX = 'style="background:#f5f6ff;border-radius:8px;padding:16px 20px;margin:0 0 24px;color:#3848c7;line-height:1.6"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

async function notifyTransition(args: {
  organizationId: string;
  mode: TransitionMode;
  result: Extract<TransitionResult, { ok: true }>;
}): Promise<void> {
  const { escapeHtml } = await import("@/lib/html-escape");
  const unit = await loadBillingUnit(args.organizationId);
  const orgName = unit?.organizationName ?? "Организация";
  const kept = args.result.keptUserName ?? "владелец";
  const archived = args.result.archivedCount;
  const payUrl = `${APP_URL}${BILLING_PAY_HREF}`;
  const free = employeesLabel(FREE_MAX_USERS);

  if (args.mode === "silent") {
    await sendOwnerNotice({
      organizationId: args.organizationId,
      kind: "billing.silent_free",
      telegramText:
        `ℹ️ Бесплатный период подписки закончился. «${escapeHtml(orgName)}» теперь на бесплатном тарифе — ${free}, как у вас и есть. ` +
        "Ничего делать не нужно. Когда понадобится команда, подписку можно оплатить в «Настройки → Тариф».",
      email: {
        subject: `«${orgName}»: бесплатный период подписки закончился`,
        title: "Вы на бесплатном тарифе",
        html: `<p ${P}>Здравствуйте!</p><p ${P}>Бесплатный период подписки закончился. Организация <strong>${escapeHtml(orgName)}</strong> теперь на бесплатном тарифе — ${free}, как у вас и есть. Ничего делать не нужно.</p><p ${P}>Когда понадобится команда, подписку можно оплатить в разделе «Настройки → Тариф».</p><a href="${payUrl}" ${BUTTON}>Открыть тариф</a>`,
      },
      // «Одно информационное уведомление»: Telegram, а без него — письмо.
      emailOnlyWithoutTelegram: true,
    });
    return;
  }

  const archivedLabel = employeesLabel(archived);
  if (args.mode === "manual") {
    await sendOwnerNotice({
      organizationId: args.organizationId,
      kind: "billing.manual_free",
      telegramText:
        `✅ «${escapeHtml(orgName)}» перешла на бесплатный тариф (${free}). В работе: ${escapeHtml(kept)}. ` +
        `В архиве: ${archivedLabel} — вернуть их можно после оплаты подписки.`,
    });
    return;
  }

  await sendOwnerNotice({
    organizationId: args.organizationId,
    kind: "billing.auto_free",
    telegramText:
      `ℹ️ Тариф не выбрали, и «${escapeHtml(orgName)}» переведена на бесплатный тариф (${free}). ` +
      `В работе остался ${escapeHtml(kept)}, в архиве — ${archivedLabel}. Вернуть сотрудников можно после оплаты подписки.`,
    email: {
      subject: `«${orgName}» переведена на бесплатный тариф`,
      title: "Организация на бесплатном тарифе",
      html:
        `<p ${P}>Здравствуйте!</p>` +
        `<p ${P}>Бесплатный период подписки закончился, а тариф выбран не был. Организация <strong>${escapeHtml(orgName)}</strong> переведена на бесплатный тариф — ${free}.</p>` +
        `<div ${BOX}>В работе остался: <strong>${escapeHtml(kept)}</strong>.<br>В архив перешли: ${archivedLabel}. Их записи в журналах сохранены.</div>` +
        `<p ${P}>Вернуть сотрудников можно после оплаты подписки — на странице «Сотрудники», блок «Архив».</p>` +
        `<a href="${payUrl}" ${BUTTON}>Оплатить подписку</a>`,
    },
  });
}

async function sendDecisionReminder(unit: BillingUnit, state: AccountBillingState, priceRub: number): Promise<boolean> {
  const { escapeHtml } = await import("@/lib/html-escape");
  if (!state.graceEndsAt) return false;
  const deadline = formatMskDay(new Date(state.graceEndsAt.getTime() - 1));
  const orgName = unit.organizationName;
  const title =
    state.reason === "subscription_expired" ? "Подписка закончилась" : "Бесплатный период подписки закончился";
  const payUrl = `${APP_URL}${BILLING_PAY_HREF}`;
  const free = employeesLabel(FREE_MAX_USERS);
  const who = employeesLabel(state.activeUsers);
  await sendOwnerNotice({
    organizationId: unit.organizationId,
    kind: "billing.reminder",
    telegramText:
      `⏳ ${title}. В «${escapeHtml(orgName)}» ${who}, а бесплатный тариф — ${free}. ` +
      `До ${deadline} включительно выберите: оплатить подписку (${formatPriceRub(priceRub)}/мес) или перейти на бесплатный. ` +
      "Если ничего не выбрать, в работе останется только владелец аккаунта, остальные перейдут в архив.",
    email: {
      subject: `«${orgName}»: выберите тариф до ${deadline}`,
      title,
      html:
        `<p ${P}>Здравствуйте!</p>` +
        `<p ${P}>${escapeHtml(title)}. В организации <strong>${escapeHtml(orgName)}</strong> сейчас ${who}, а бесплатный тариф — ${free}.</p>` +
        `<div ${BOX}>До <strong>${deadline}</strong> включительно выберите: оплатить подписку (${formatPriceRub(priceRub)}/мес, все сотрудники остаются) или перейти на бесплатный тариф.</div>` +
        `<p ${P}>Если ничего не выбрать, в работе останется только владелец аккаунта, остальные сотрудники перейдут в архив. Вернуть их можно после оплаты.</p>` +
        `<a href="${payUrl}" ${BUTTON}>Выбрать тариф</a>`,
    },
  });
  return true;
}

// ------------------------------------------------------------ daily job

type UnitRow = BillingUnit & { orgIds: string[] };

/**
 * Все единицы биллинга платформы разом: организации, аккаунты и занятые
 * места — три запроса вместо трёх на каждую организацию.
 */
export async function listBillingUnits(): Promise<UnitRow[]> {
  const orgs = await db.organization.findMany({
    where: { id: { not: PLATFORM_ORG_ID() }, isDemo: false, kind: { not: "directory" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      accountId: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      account: {
        select: { id: true, ownerUserId: true, subscriptionPlan: true, subscriptionEnd: true },
      },
    },
  });
  const seats = await db.user.groupBy({
    by: ["organizationId"],
    where: SEAT_USER_WHERE,
    _count: { _all: true },
  });
  const seatsByOrg = new Map(seats.map((row) => [row.organizationId, row._count._all]));
  const cabinetSeats = await masterCabinetSeatsByOrg(orgs.map((org) => org.id));

  const units = new Map<string, UnitRow>();
  for (const org of orgs) {
    const key = org.accountId ?? `org:${org.id}`;
    const existing = units.get(key);
    const seatsHere = (seatsByOrg.get(org.id) ?? 0) + (cabinetSeats.get(org.id) ?? 0);
    if (!existing) {
      units.set(key, {
        key,
        accountId: org.accountId,
        ownerUserId: org.account?.ownerUserId ?? null,
        organizationId: org.id,
        organizationName: org.name,
        scopeOrgIds: [org.id],
        orgIds: [org.id],
        plan: org.account?.subscriptionPlan ?? org.subscriptionPlan,
        subscriptionEnd: maxDate([org.account?.subscriptionEnd, org.subscriptionEnd]),
        activeUsers: seatsHere,
        exempt: false,
        inactive: isInactivePlan(org.subscriptionPlan),
      });
      continue;
    }
    existing.scopeOrgIds.push(org.id);
    existing.orgIds.push(org.id);
    existing.subscriptionEnd = maxDate([existing.subscriptionEnd, org.subscriptionEnd]);
    existing.activeUsers += seatsHere;
    // Для задачи «на паузе» — только если на паузе все организации аккаунта.
    existing.inactive = existing.inactive && isInactivePlan(org.subscriptionPlan);
  }
  // Окно, аудит и уведомления — от домашней организации владельца.
  const ownerIds = [...units.values()].map((u) => u.ownerUserId).filter((id): id is string => Boolean(id));
  const owners = ownerIds.length
    ? await db.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, organizationId: true, organization: { select: { name: true } } },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  for (const unit of units.values()) {
    const owner = unit.ownerUserId ? ownerById.get(unit.ownerUserId) : undefined;
    if (owner && unit.scopeOrgIds.includes(owner.organizationId)) {
      unit.organizationId = owner.organizationId;
      unit.organizationName = owner.organization.name;
    }
  }
  return [...units.values()];
}

export type BillingJobReport = {
  ok: true;
  dryRun: boolean;
  enforced: boolean;
  now: string;
  scanned: number;
  silentFree: number;
  reminded: number;
  autoFree: number;
  failed: number;
  results: Array<{ unit: string; organizationId: string; action: TransitionAction; activeUsers: number; outcome: string }>;
};

/**
 * Ежедневная задача перехода: тихий `free` для аккаунтов с ≤ 1
 * активным, одно предупреждение «выберите до …» для > 1, автопереход
 * по истечении грейса. Идемпотентна: повторный запуск ничего не меняет.
 */
export async function runBillingTransitionJob(options: { now?: Date; dryRun?: boolean } = {}): Promise<BillingJobReport> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const settings = await readFreePeriodSettings();
  const report: BillingJobReport = {
    ok: true,
    dryRun,
    enforced: isBillingEnforced(settings, now),
    now: now.toISOString(),
    scanned: 0,
    silentFree: 0,
    reminded: 0,
    autoFree: 0,
    failed: 0,
    results: [],
  };
  if (!report.enforced) {
    console.info("[billing] job: transition not active yet", {
      endsAt: settings.endsAt.toISOString(),
      transitionEnabled: settings.transitionEnabled,
    });
    return report;
  }

  const { readTariffs, fallbackTariffs, TARIFF_MONTHLY } = await import("@/lib/tariffs");
  const tariffs = await readTariffs().catch(() => fallbackTariffs());
  const priceRub = (tariffs.find((t) => t.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0]).priceRub;

  const units = await listBillingUnits();
  report.scanned = units.length;
  for (const unit of units) {
    const state = stateForUnit(unit, settings, now);
    const action = decideTransitionAction(state, unit.plan);
    if (action === "none") continue;
    let outcome = "planned";
    try {
      if (action === "silent_free") {
        if (!dryRun) {
          const r = await transitionToFree({ organizationId: unit.organizationId, mode: "silent", actor: { userId: null, userName: "WeSetup" }, now });
          outcome = r.ok ? (r.noop ? "noop" : "done") : `refused: ${r.error}`;
        }
        if (outcome === "done" || dryRun) report.silentFree += 1;
      } else if (action === "auto_free") {
        if (await hasPendingInvoice(unit.scopeOrgIds, now)) {
          outcome = "pending invoice — waiting for payment";
          report.results.push({ unit: unit.key, organizationId: unit.organizationId, action, activeUsers: state.activeUsers, outcome });
          continue;
        }
        if (!dryRun) {
          const r = await transitionToFree({ organizationId: unit.organizationId, mode: "auto", actor: { userId: null, userName: "WeSetup" }, now });
          outcome = r.ok ? (r.noop ? "noop" : `done: archived ${r.archivedCount}`) : `refused: ${r.error}`;
        }
        if (outcome.startsWith("done") || dryRun) report.autoFree += 1;
      } else if (action === "await_decision") {
        const since = state.reason === "subscription_expired" && unit.subscriptionEnd ? unit.subscriptionEnd : settings.endsAt;
        const already = await db.auditLog.findFirst({
          where: { organizationId: { in: unit.scopeOrgIds }, action: AUDIT_ACTIONS.reminder, createdAt: { gte: since } },
          select: { id: true },
        });
        if (already) {
          outcome = "reminder already sent";
        } else if (!dryRun) {
          await sendDecisionReminder(unit, state, priceRub);
          await db.auditLog.create({
            data: {
              organizationId: unit.organizationId,
              userName: "WeSetup",
              action: AUDIT_ACTIONS.reminder,
              entity: unit.accountId ? "account" : "organization",
              entityId: unit.accountId ?? unit.organizationId,
              details: {
                reason: state.reason,
                activeUsers: state.activeUsers,
                graceEndsAt: state.graceEndsAt?.toISOString() ?? null,
              },
            },
          });
          outcome = "reminder sent";
          report.reminded += 1;
        } else {
          report.reminded += 1;
        }
      }
    } catch (error) {
      report.failed += 1;
      outcome = `error: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[billing] job: unit failed", { unit: unit.key, action, error });
    }
    report.results.push({ unit: unit.key, organizationId: unit.organizationId, action, activeUsers: state.activeUsers, outcome });
  }
  console.info("[billing] job done", {
    dryRun,
    scanned: report.scanned,
    silentFree: report.silentFree,
    reminded: report.reminded,
    autoFree: report.autoFree,
    failed: report.failed,
  });
  return report;
}

// --------------------------------------------------------------- ROOT

export type BillingOverview = {
  total: number;
  counts: Record<AccountBillingKind, number>;
  /** Переведены задачей по грейсу и сейчас на бесплатном. */
  autoTransitioned: number;
  /** Как разойдутся аккаунты в момент конца периода (пока он не наступил). */
  forecast: Record<AccountBillingKind, number> | null;
};

function emptyCounts(): Record<AccountBillingKind, number> {
  return { exempt: 0, paid: 0, legacy: 0, free_period: 0, free: 0, needs_decision: 0 };
}

export async function collectBillingOverview(now: Date = new Date()): Promise<BillingOverview> {
  const settings = await readFreePeriodSettings();
  const units = await listBillingUnits();
  const counts = emptyCounts();
  const unitByOrg = new Map<string, UnitRow>();
  const stateByUnit = new Map<string, AccountBillingState>();
  for (const unit of units) {
    const state = stateForUnit(unit, settings, now);
    counts[state.kind] += 1;
    stateByUnit.set(unit.key, state);
    for (const orgId of unit.orgIds) unitByOrg.set(orgId, unit);
  }
  const autoRows = await db.auditLog.findMany({
    where: { action: AUDIT_ACTIONS.auto },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });
  const autoUnits = new Set<string>();
  for (const row of autoRows) {
    const unit = unitByOrg.get(row.organizationId);
    if (unit && stateByUnit.get(unit.key)?.kind === "free") autoUnits.add(unit.key);
  }
  let forecast: Record<AccountBillingKind, number> | null = null;
  if (settings.transitionEnabled && now.getTime() < settings.endsAt.getTime()) {
    forecast = emptyCounts();
    for (const unit of units) forecast[stateForUnit(unit, settings, settings.endsAt).kind] += 1;
  }
  return { total: units.length, counts, autoTransitioned: autoUnits.size, forecast };
}
