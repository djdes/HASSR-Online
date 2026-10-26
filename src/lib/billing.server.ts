import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { TOPUP_TARIFF_KEY } from "@/lib/balance/topup-core";
import {
  BILLING_LIMIT_CODE,
  BILLING_PAY_HREF,
  DEFAULT_TRIAL_SETTINGS,
  FEATURE_LOCKED_CODE,
  FEATURE_LOCKED_MESSAGE,
  FREE_LIMIT_MESSAGE,
  seatLimitMessage,
  JOURNAL_LIMIT_CODE,
  LEGACY_FREE_PERIOD_SETTING_KEY,
  POINT_LIMIT_CODE,
  STORAGE_LIMIT_CODE,
  TRIAL_REMINDER_DAYS,
  TRIAL_SETTING_KEY,
  checkJournals,
  checkPoints,
  checkSeats,
  checkStorage,
  computeAccountBilling,
  daysLabel,
  decideTransitionAction,
  formatMskDay,
  journalsLabel,
  lastDayBefore,
  normalizeTrialSettings,
  paidPlansHint,
  pickKeeper,
  pickKeeperJournal,
  serializeTrialSettings,
  voluntaryDowngradeCheck,
  type AccountBillingKind,
  type AccountBillingState,
  type LimitCheck,
  type TransitionAction,
  type TransitionReason,
  type TrialSettings,
} from "@/lib/billing-period";
import { COMMISSION_CATEGORY_KEY, NOT_COMMISSION_WHERE } from "@/lib/journal-roster";
import { masterCabinetSeatsByOrg, NOT_MASTER_CABINET_STAFF_WHERE } from "@/lib/master-cabinet-seats";
import { FREE_MAX_USERS, isFreePlan, isInactivePlan } from "@/lib/plan-limits";
import { employeesLabel } from "@/lib/plan-catalog";
import { forgetSessionVersions } from "@/lib/session-version";
import {
  FREE_MAX_JOURNALS,
  countPointsInUse,
  parseScheduledPlan,
  planMonthlyRub,
  seatUpgradeTarget,
  type PaidTier,
  type PlanFeature,
  type ScheduledPlan,
} from "@/lib/tariff-plans";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Серверная часть тарифов 2026-10: настройки пробного периода из
 * `PlatformSetting`, загрузка тарифа аккаунта, проверки лимитов до создания
 * (сотрудники, точки, журналы, хранилище, возможности Премиума), переход на
 * бесплатный (руководитель, грейс, тихий) и ежедневная задача. Решения — в
 * чистом `billing-period.ts`, цены и лимиты — в `tariff-plans.ts`.
 *
 * Логи — `console.info("[billing] …")` на каждом переходе; аудит — в
 * журнал действий каждой затронутой организации.
 */

const PLATFORM_ORG_ID = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

const APP_URL = (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(
  /\/+$/,
  ""
);

const DAY_MS = 24 * 60 * 60 * 1000;

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
  voluntary: "billing.transition.voluntary_free",
  silent: "billing.transition.silent_free",
  reminder: "billing.transition.reminder",
  trialReminder: "billing.trial.reminder",
  settings: "billing.trial.updated",
  scheduled: "billing.plan.scheduled",
  scheduleCancelled: "billing.plan.schedule_cancelled",
} as const;

// ---------------------------------------------------------------- settings

/**
 * Настройки пробного периода. Первое чтение после выкладки тарифов 2026-10
 * записывает дату запуска (с этой минуты старые аккаунты получают свои
 * 14 дней) и переносит грейс и флаг из прежних настроек «бесплатного
 * периода для всех». `update: {}` — второй сервер, успевший первым, не
 * перезаписывается.
 */
export async function readTrialSettings(): Promise<TrialSettings> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: TRIAL_SETTING_KEY } });
    if (row) return normalizeTrialSettings(JSON.parse(row.value));

    const legacy = await db.platformSetting.findUnique({ where: { key: LEGACY_FREE_PERIOD_SETTING_KEY } });
    const legacyValue = legacy ? (JSON.parse(legacy.value) as Record<string, unknown>) : {};
    const initial = normalizeTrialSettings({
      ...legacyValue,
      trialDays: DEFAULT_TRIAL_SETTINGS.trialDays,
      launchedAt: new Date().toISOString(),
    });
    await db.platformSetting.upsert({
      where: { key: TRIAL_SETTING_KEY },
      create: { key: TRIAL_SETTING_KEY, value: serializeTrialSettings(initial) },
      update: {},
    });
    const stored = await db.platformSetting.findUnique({ where: { key: TRIAL_SETTING_KEY } });
    const settings = stored ? normalizeTrialSettings(JSON.parse(stored.value)) : initial;
    console.info("[billing] trial settings initialized", JSON.parse(serializeTrialSettings(settings)));
    return settings;
  } catch (error) {
    console.error("[billing] trial settings read failed — using defaults", error);
    return DEFAULT_TRIAL_SETTINGS;
  }
}

export async function writeTrialSettings(
  next: TrialSettings,
  actor: { userId: string; userName: string | null; organizationId: string; ipAddress?: string | null }
): Promise<TrialSettings> {
  const before = await readTrialSettings();
  const value = serializeTrialSettings(next);
  await db.platformSetting.upsert({
    where: { key: TRIAL_SETTING_KEY },
    create: { key: TRIAL_SETTING_KEY, value },
    update: { value },
  });
  console.info("[billing] trial settings updated", {
    by: actor.userId,
    before: JSON.parse(serializeTrialSettings(before)),
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
        entityId: TRIAL_SETTING_KEY,
        details: {
          before: JSON.parse(serializeTrialSettings(before)),
          after: JSON.parse(value),
        },
        ipAddress: actor.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error("[billing] settings audit write failed", error);
  }
  return normalizeTrialSettings(JSON.parse(value));
}

// ------------------------------------------------------------ journals

let activeCodesCache: { at: number; codes: string[] } | null = null;

/** Коды действующих шаблонов журналов (глобальные, кешируются на 5 минут). */
export async function activeJournalCodes(): Promise<string[]> {
  if (activeCodesCache && Date.now() - activeCodesCache.at < 5 * 60 * 1000) return activeCodesCache.codes;
  const rows = await db.journalTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { code: true },
  });
  activeCodesCache = { at: Date.now(), codes: rows.map((row) => row.code) };
  return activeCodesCache.codes;
}

function parseCodes(raw: unknown): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && v.length > 0) : []);
}

/** Сколько журналов включено в организации: действующие минус выключенные. */
export function enabledJournalCount(activeCodes: readonly string[], disabledRaw: unknown): number {
  const disabled = parseCodes(disabledRaw);
  return activeCodes.filter((code) => !disabled.has(code)).length;
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
  /** Начало пробного: создание аккаунта (или организации без аккаунта). */
  createdAt: Date;
  trialEndsAt: Date | null;
  planCycle: string | null;
  planPoints: number;
  scheduledPlan: ScheduledPlan | null;
  /** Включённых журналов — наибольшее по организациям тарифа. */
  enabledJournals: number;
  /** Точек в работе: Σ max(1, зданий). */
  pointsInUse: number;
};

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

const ACCOUNT_SELECT = {
  id: true,
  ownerUserId: true,
  subscriptionPlan: true,
  subscriptionEnd: true,
  planCycle: true,
  planPoints: true,
  trialEndsAt: true,
  scheduledPlanJson: true,
  createdAt: true,
} as const;

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
      createdAt: true,
      account: { select: ACCOUNT_SELECT },
    },
  });
  if (!org) return null;

  const exempt = org.id === PLATFORM_ORG_ID() || org.isDemo || org.kind === "directory";
  const scopeOrgs = exempt
    ? []
    : await db.organization.findMany({
        where: org.accountId
          ? {
              accountId: org.accountId,
              isDemo: false,
              kind: { not: "directory" },
              id: { not: PLATFORM_ORG_ID() },
            }
          : { id: org.id },
        select: { id: true, subscriptionEnd: true, disabledJournalCodes: true, _count: { select: { buildings: true } } },
      });
  const scopeOrgIds = scopeOrgs.map((o) => o.id);

  const [peopleSeats, cabinetSeats, codes] = scopeOrgIds.length
    ? await Promise.all([
        db.user.count({ where: { ...SEAT_USER_WHERE, organizationId: { in: scopeOrgIds } } }),
        masterCabinetSeatsByOrg(scopeOrgIds),
        activeJournalCodes(),
      ])
    : [0, new Map<string, number>(), [] as string[]];
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
    createdAt: org.account?.createdAt ?? org.createdAt,
    trialEndsAt: org.account?.trialEndsAt ?? null,
    planCycle: org.account?.planCycle ?? null,
    planPoints: org.account?.planPoints ?? 1,
    scheduledPlan: parseScheduledPlan(org.account?.scheduledPlanJson),
    enabledJournals: Math.max(0, ...scopeOrgs.map((o) => enabledJournalCount(codes, o.disabledJournalCodes))),
    pointsInUse: countPointsInUse(scopeOrgs.map((o) => o._count.buildings)),
  };
}

export function stateForUnit(
  unit: BillingUnit,
  settings: TrialSettings,
  now: Date
): AccountBillingState {
  return computeAccountBilling(
    {
      plan: unit.plan,
      subscriptionEnd: unit.subscriptionEnd,
      planCycle: unit.planCycle,
      planPoints: unit.planPoints,
      createdAt: unit.createdAt,
      trialEndsAt: unit.trialEndsAt,
      activeUsers: unit.activeUsers,
      enabledJournals: unit.enabledJournals,
      pointsInUse: unit.pointsInUse,
      exempt: unit.exempt,
      inactive: unit.inactive,
    },
    settings,
    now
  );
}

export type LoadedBilling = {
  unit: BillingUnit;
  settings: TrialSettings;
  state: AccountBillingState;
};

/** Тариф и состояние для организации (с учётом всего аккаунта). */
export async function loadAccountBilling(
  organizationId: string,
  now: Date = new Date()
): Promise<LoadedBilling | null> {
  const [unit, settings] = await Promise.all([loadBillingUnit(organizationId), readTrialSettings()]);
  if (!unit) return null;
  return { unit, settings, state: stateForUnit(unit, settings, now) };
}

// -------------------------------------------------------------- guards

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
      /** Тариф, на котором кончились места, и следующий (null — больше по согласованию). */
      tier: string;
      nextTier: PaidTier | null;
    };

/** Загрузка тарифа для проверки; сбой БД — не блокируем работу. */
async function loadForGuard(organizationId: string, source: string): Promise<LoadedBilling | null> {
  return loadAccountBilling(organizationId).catch((error) => {
    console.error("[billing] limit check failed to load — allowing", { organizationId, source, error });
    return null;
  });
}

/**
 * Можно ли сделать активными ещё `adding` сотрудников организации.
 * Вызывается ДО создания или возврата из архива на каждом пути. В пробном
 * периоде, на прежней «Подписке» и вне тарифа — всегда да.
 */
export async function checkSeatsForActivation(
  organizationId: string,
  adding: number,
  options: { source: string; audience?: "manager" | "invitee" }
): Promise<SeatGuard> {
  if (!(adding > 0)) return { ok: true };
  const loaded = await loadForGuard(organizationId, options.source);
  if (!loaded) return { ok: true };
  const check = checkSeats(loaded.state, adding);
  if (check.ok) return { ok: true };
  console.info("[billing] seat limit: blocked", {
    organizationId,
    source: options.source,
    kind: loaded.state.kind,
    tier: loaded.state.tier,
    activeUsers: check.activeUsers,
    adding,
    limit: check.limit,
  });
  return {
    ok: false,
    status: 402,
    error: options.audience === "invitee" ? seatLimitMessage(loaded.state, "invitee") : check.message,
    code: BILLING_LIMIT_CODE,
    payUrl: BILLING_PAY_HREF,
    limit: check.limit,
    activeUsers: check.activeUsers,
    tier: check.tier,
    nextTier: check.nextTier,
  };
}

/**
 * Сколько ещё активных можно добавить — для импорта списком, где строки
 * проверяются по одной ДО создания каждой. Infinity — без ограничения.
 */
export async function seatAllowance(
  organizationId: string
): Promise<{ left: number; limit: number | null; message: string; nextTier: PaidTier | null }> {
  const loaded = await loadForGuard(organizationId, "seat-allowance");
  const limit = loaded?.state.seatLimit ?? null;
  if (!loaded || limit === null) {
    return { left: Number.POSITIVE_INFINITY, limit: null, message: FREE_LIMIT_MESSAGE, nextTier: null };
  }
  const { state } = loaded;
  // Текст отказа — по тарифу: лимит текущего и следующий тариф.
  return {
    left: Math.max(0, limit - state.activeUsers),
    limit,
    message: seatLimitMessage(state),
    nextTier: seatUpgradeTarget(state.tier),
  };
}

/** Итог импорта списком, если часть строк упёрлась в лимит тарифа. */
export function seatLimitSummary(
  blocked: number,
  source: string,
  organizationId: string,
  seats?: { limit: number | null; message: string; nextTier?: PaidTier | null }
) {
  if (blocked <= 0) return null;
  console.info("[billing] seat limit: import rows blocked", { organizationId, source, blocked });
  return {
    code: BILLING_LIMIT_CODE,
    error: seats?.message ?? FREE_LIMIT_MESSAGE,
    payUrl: BILLING_PAY_HREF,
    blocked,
    ...(typeof seats?.limit === "number" ? { limit: seats.limit } : {}),
    ...(seats && seats.nextTier !== undefined ? { nextTier: seats.nextTier } : {}),
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
      tier: guard.tier,
      nextTier: guard.nextTier,
    },
    { status: guard.status }
  );
}

/** Отказ по лимиту тарифа (точки, журналы, хранилище, возможность Премиума). */
export type LimitGuard =
  | { ok: true }
  | { ok: false; status: 402; error: string; code: string; payUrl: string; limit: number | null; current: number | null };

export function limitResponse(guard: Extract<LimitGuard, { ok: false }>): NextResponse {
  return NextResponse.json(
    { error: guard.error, code: guard.code, payUrl: guard.payUrl, limit: guard.limit, current: guard.current },
    { status: guard.status }
  );
}

function refusal(check: Extract<LimitCheck, { ok: false }>, code: string): Extract<LimitGuard, { ok: false }> {
  return { ok: false, status: 402, error: check.message, code, payUrl: BILLING_PAY_HREF, limit: check.limit, current: check.current };
}

/**
 * Можно ли завести ещё точку: новое здание в организации, где здания уже
 * есть, или новую организацию аккаунта. Первое здание организации места
 * не добавляет — организация уже считалась одной точкой.
 */
export async function checkPointsForCreation(
  organizationId: string,
  adding: number,
  options: { source: string }
): Promise<LimitGuard> {
  if (!(adding > 0)) return { ok: true };
  const loaded = await loadForGuard(organizationId, options.source);
  if (!loaded) return { ok: true };
  const check = checkPoints(loaded.state, adding);
  if (check.ok) return { ok: true };
  console.info("[billing] point limit: blocked", {
    organizationId,
    source: options.source,
    tier: loaded.state.tier,
    pointsInUse: check.current,
    limit: check.limit,
  });
  return refusal(check, POINT_LIMIT_CODE);
}

/**
 * Можно ли записать организации такой список выключенных журналов. На
 * бесплатном после пробного включённым может остаться один журнал;
 * выключать можно всегда.
 */
export async function checkJournalLimit(
  organizationId: string,
  nextDisabledCodes: readonly string[],
  options: { source: string }
): Promise<LimitGuard> {
  const loaded = await loadForGuard(organizationId, options.source);
  if (!loaded || loaded.state.entitlements.journalLimit === null) return { ok: true };
  const [codes, org] = await Promise.all([
    activeJournalCodes(),
    db.organization.findUnique({ where: { id: organizationId }, select: { disabledJournalCodes: true } }),
  ]);
  const current = enabledJournalCount(codes, org?.disabledJournalCodes);
  const next = enabledJournalCount(codes, [...nextDisabledCodes]);
  const check = checkJournals(loaded.state, next, current);
  if (check.ok) return { ok: true };
  console.info("[billing] journal limit: blocked", { organizationId, source: options.source, current, next });
  return refusal(check, JOURNAL_LIMIT_CODE);
}

/** Занято байт документами (база знаний, ППК, сканы приказов) по организациям. */
export async function storageUsedBytes(scopeOrgIds: readonly string[]): Promise<number> {
  if (scopeOrgIds.length === 0) return 0;
  const [docs, scans] = await Promise.all([
    db.knowledgeDocument.aggregate({ where: { organizationId: { in: [...scopeOrgIds] } }, _sum: { sizeBytes: true } }),
    db.journalOrderScan.aggregate({ where: { organizationId: { in: [...scopeOrgIds] } }, _sum: { sizeBytes: true } }),
  ]);
  return (docs._sum.sizeBytes ?? 0) + (scans._sum.sizeBytes ?? 0);
}

export type StorageSummary = { usedBytes: number; limitBytes: number | null };

/** Хранилище тарифа для страницы тарифа и раздела документов. */
export async function loadStorageSummary(loaded: LoadedBilling): Promise<StorageSummary> {
  const usedBytes = await storageUsedBytes(loaded.unit.scopeOrgIds);
  return { usedBytes, limitBytes: loaded.state.entitlements.storageBytes };
}

/**
 * Хватит ли места тарифа на загрузку. `replacingBytes` — файл, который
 * заменяется (документ ППК на своём месте).
 */
export async function checkStorageForUpload(
  organizationId: string,
  addingBytes: number,
  options: { source: string; replacingBytes?: number }
): Promise<LimitGuard> {
  const loaded = await loadForGuard(organizationId, options.source);
  if (!loaded || loaded.state.entitlements.storageBytes === null) return { ok: true };
  const used = await storageUsedBytes(loaded.unit.scopeOrgIds);
  const check = checkStorage(loaded.state.entitlements, used, addingBytes, options.replacingBytes ?? 0);
  if (check.ok) return { ok: true };
  console.info("[billing] storage limit: blocked", {
    organizationId,
    source: options.source,
    tier: loaded.state.tier,
    usedBytes: used,
    addingBytes,
    limit: check.limit,
  });
  return refusal(check, STORAGE_LIMIT_CODE);
}

/** Есть ли у организации возможность тарифа; сбой БД — нет (возможность платная). */
export async function hasPlanFeature(organizationId: string, feature: PlanFeature): Promise<boolean> {
  const loaded = await loadAccountBilling(organizationId).catch((error) => {
    console.error("[billing] feature check failed", { organizationId, feature, error });
    return null;
  });
  return loaded?.state.entitlements.features[feature] === true;
}

/** Отказ закрытой возможности — 402 со ссылкой на тариф. */
export async function checkPlanFeature(organizationId: string, feature: PlanFeature, source: string): Promise<LimitGuard> {
  if (await hasPlanFeature(organizationId, feature)) return { ok: true };
  console.info("[billing] feature locked", { organizationId, feature, source });
  return {
    ok: false,
    status: 402,
    error: FEATURE_LOCKED_MESSAGE[feature],
    code: FEATURE_LOCKED_CODE,
    payUrl: BILLING_PAY_HREF,
    limit: null,
    current: null,
  };
}

/**
 * Выставлен счёт по безналу, срок оплаты не прошёл: решение «платим»
 * уже принято, деньги идут днями — окно не давит, автопереход ждёт.
 * Так же — оплата, которая ждёт ручного разбора (`heldAt`): деньги уже
 * получены, переводить аккаунт на бесплатный до разбора нельзя.
 */
export async function hasPendingInvoice(orgIds: string[], now: Date = new Date()): Promise<boolean> {
  if (orgIds.length === 0) return false;
  const count = await db.paymentOrder.count({
    where: {
      organizationId: { in: orgIds },
      // Счёт на пополнение баланса — не решение «платим за подписку».
      tariffKey: { not: TOPUP_TARIFF_KEY },
      OR: [
        {
          paymentMethod: "invoice",
          status: "pending",
          OR: [{ invoiceDueAt: null }, { invoiceDueAt: { gt: now } }],
        },
        { status: "paid", heldAt: { not: null }, refundedAt: null },
      ],
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

export type TransitionJournal = {
  code: string;
  name: string;
  /** Записей за 30 дней по организациям тарифа. */
  entries30d: number;
};

/** Записей за период по журналам: обычные записи и клетки документов. */
export async function journalUsage(scopeOrgIds: readonly string[], since: Date): Promise<Map<string, number>> {
  const usage = new Map<string, number>();
  if (scopeOrgIds.length === 0) return usage;
  const orgIds = [...scopeOrgIds];
  const [entries, documents] = await Promise.all([
    db.journalEntry.groupBy({
      by: ["templateId"],
      where: { organizationId: { in: orgIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.journalDocument.findMany({
      where: { organizationId: { in: orgIds }, entries: { some: { createdAt: { gte: since } } } },
      select: { id: true, templateId: true },
    }),
  ]);
  const cells = documents.length
    ? await db.journalDocumentEntry.groupBy({
        by: ["documentId"],
        where: { documentId: { in: documents.map((d) => d.id) }, createdAt: { gte: since } },
        _count: { _all: true },
      })
    : [];
  const templateIds = new Set([...entries.map((e) => e.templateId), ...documents.map((d) => d.templateId)]);
  const templates = templateIds.size
    ? await db.journalTemplate.findMany({ where: { id: { in: [...templateIds] } }, select: { id: true, code: true } })
    : [];
  const codeById = new Map(templates.map((t) => [t.id, t.code]));
  const add = (templateId: string, n: number) => {
    const code = codeById.get(templateId);
    if (code) usage.set(code, (usage.get(code) ?? 0) + n);
  };
  for (const row of entries) add(row.templateId, row._count._all);
  const docTemplate = new Map(documents.map((d) => [d.id, d.templateId]));
  for (const row of cells) {
    const templateId = docTemplate.get(row.documentId);
    if (templateId) add(templateId, row._count._all);
  }
  return usage;
}

/**
 * Журналы для шага «какой журнал остаётся»: включённые хотя бы в одной
 * организации тарифа, самые заполняемые — первыми.
 */
export async function listTransitionJournals(unit: BillingUnit, now: Date = new Date()): Promise<TransitionJournal[]> {
  if (unit.scopeOrgIds.length === 0) return [];
  const [orgs, templates, usage] = await Promise.all([
    db.organization.findMany({ where: { id: { in: unit.scopeOrgIds } }, select: { disabledJournalCodes: true } }),
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, name: true },
    }),
    journalUsage(unit.scopeOrgIds, new Date(now.getTime() - 30 * DAY_MS)),
  ]);
  const disabledEverywhere = (code: string) => orgs.every((org) => parseCodes(org.disabledJournalCodes).has(code));
  return templates
    .filter((t) => !disabledEverywhere(t.code))
    .map((t) => ({ code: t.code, name: t.name, entries30d: usage.get(t.code) ?? 0 }))
    .sort((a, b) => b.entries30d - a.entries30d);
}

/**
 * Сколько включённых журналов выключит переход (наибольшее по организациям):
 * все включённые, кроме оставленного.
 */
function journalsTurnedOff(
  orgs: ReadonlyArray<{ disabledJournalCodes: unknown }>,
  activeCodes: readonly string[],
  keptCode: string
): number {
  return orgs.reduce((max, org) => {
    const disabled = parseCodes(org.disabledJournalCodes);
    const off = activeCodes.filter((code) => code !== keptCode && !disabled.has(code)).length;
    return Math.max(max, off);
  }, 0);
}

/**
 * manual — решение руководителя после пробного периода; voluntary — сам
 * перешёл на бесплатный с подписки (кнопка на странице тарифа); auto и
 * silent — ежедневная задача.
 */
export type TransitionMode = "manual" | "voluntary" | "auto" | "silent";

export type TransitionResult =
  | {
      ok: true;
      noop: boolean;
      keptUserId: string | null;
      keptUserName: string | null;
      keptJournalCode: string | null;
      keptJournalName: string | null;
      archivedCount: number;
      archivedNames: string[];
      archivedUserIds: string[];
      disabledJournalsCount: number;
      /** Что закончилось перед переходом: пробный или оплаченная подписка. */
      reason?: TransitionReason | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Переход аккаунта на бесплатный тариф: один сотрудник и один журнал
 * остаются, остальные сотрудники — в архив (`isActive=false`,
 * `archivedAt`, сессии завершаются), остальные журналы выключаются во
 * всех организациях тарифа; тариф `free` на аккаунте и зеркалах
 * организаций (паузу не снимаем — только `pausedFromPlan`), аудит в каждую
 * затронутую организацию. Записи журналов не удаляются.
 *
 * Состояние перепроверяется под advisory-lock аккаунта: два руководителя
 * или руководитель и ночная задача не выполнят переход дважды.
 */
export async function transitionToFree(args: {
  organizationId: string;
  mode: TransitionMode;
  /** Кого оставить (manual, voluntary). Для auto/silent — владелец аккаунта. */
  keepUserId?: string | null;
  /** Какой журнал оставить (manual, voluntary). Для auto — самый заполняемый. */
  keepJournalCode?: string | null;
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
      const settings = await readTrialSettings();
      const state = stateForUnit(unit, settings, now);
      const voluntary = args.mode === "voluntary";
      const chooses = args.mode === "manual" || voluntary;

      if (voluntary) {
        // Сам переходит с подписки или из пробного: те же права (проверяет
        // маршрут), но состояние «нужно решение» не требуется.
        const check = voluntaryDowngradeCheck(state);
        if (!check.ok) return check;
      } else {
        if (state.kind === "paid") {
          return { ok: false, status: 409, error: "Подписка уже оплачена — переходить на бесплатный не нужно" };
        }
        if (state.kind === "exempt") {
          return { ok: false, status: 409, error: "У этой организации нет тарифа" };
        }
        if (!state.enforcement) {
          return { ok: false, status: 409, error: "Пробный период ещё идёт — выбирать тариф пока не нужно" };
        }
      }
      // Оплаченный срок при добровольном переходе не сохраняется (окно
      // предупреждает; неиспользованную часть возвращают по заявлению, п. 6.2
      // оферты), автопродление выключается — списаний на бесплатном нет.
      const paidUntilBefore = state.kind === "paid" ? state.paidUntil : null;
      // Добровольный переход из пробного заканчивает пробный период: иначе
      // аккаунт оставался бы «пробным» — без ограничений бесплатного.
      const endsTrial = voluntary && state.kind === "free_period" && Boolean(unit.accountId);

      const [candidates, journals, codes, orgRows] = await Promise.all([
        listTransitionCandidates(unit),
        listTransitionJournals(unit, now),
        activeJournalCodes(),
        db.organization.findMany({ where: { id: { in: unit.scopeOrgIds } }, select: { id: true, disabledJournalCodes: true } }),
      ]);

      let keeper: TransitionCandidate | null = null;
      if (chooses) {
        keeper = candidates.find((c) => c.id === args.keepUserId) ?? null;
        if (!keeper) {
          return { ok: false, status: 400, error: "Выберите, кто останется, из активных сотрудников" };
        }
      } else {
        const keeperId = pickKeeper(candidates, unit.ownerUserId);
        keeper = candidates.find((c) => c.id === keeperId) ?? null;
      }

      let keptJournal: TransitionJournal | null = null;
      if (journals.length > 0) {
        if (chooses) {
          keptJournal = journals.find((j) => j.code === args.keepJournalCode) ?? null;
          if (!keptJournal) {
            return { ok: false, status: 400, error: "Отметьте журнал, который останется" };
          }
        } else {
          const usage = new Map(journals.map((j) => [j.code, j.entries30d]));
          const code = pickKeeperJournal(journals.map((j) => j.code), usage);
          keptJournal = journals.find((j) => j.code === code) ?? null;
        }
      }

      const toArchive = candidates.filter((c) => c.id !== keeper?.id);
      // Выключаются все действующие журналы, кроме оставленного.
      const keptCode = keptJournal?.code ?? null;
      const nextDisabled = keptCode ? codes.filter((code) => code !== keptCode) : null;
      const journalsToDisable = keptCode ? journalsTurnedOff(orgRows, codes, keptCode) : 0;
      if (args.mode === "silent" && (toArchive.length > 0 || journalsToDisable > 0)) {
        // Тихий переход — только когда архивировать и выключать нечего.
        return { ok: false, status: 409, error: "Сверх бесплатного — нужно решение руководителя" };
      }
      const planBefore = unit.plan;
      if (toArchive.length === 0 && journalsToDisable === 0 && isFreePlan(planBefore) && !paidUntilBefore && !endsTrial) {
        return {
          ok: true,
          noop: true,
          keptUserId: keeper?.id ?? null,
          keptUserName: keeper?.name ?? null,
          keptJournalCode: keptJournal?.code ?? null,
          keptJournalName: keptJournal?.name ?? null,
          archivedCount: 0,
          archivedNames: [],
          archivedUserIds: [],
          disabledJournalsCount: 0,
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
        if (nextDisabled) {
          // Один журнал — во всех организациях тарифа. Записи не удаляются:
          // после оплаты журналы включают обратно в «Настройки → Журналы».
          await tx.organization.updateMany({
            where: { id: { in: unit.scopeOrgIds } },
            data: { disabledJournalCodes: nextDisabled },
          });
        }
        if (unit.accountId) {
          await tx.account.update({
            where: { id: unit.accountId },
            data: {
              subscriptionPlan: "free",
              scheduledPlanJson: Prisma.DbNull,
              ...(paidUntilBefore ? { subscriptionEnd: now } : {}),
              ...(endsTrial ? { trialEndsAt: now } : {}),
            },
          });
        }
        if (voluntary) {
          if (paidUntilBefore) {
            await tx.organization.updateMany({
              where: { id: { in: unit.scopeOrgIds }, subscriptionEnd: { gt: now } },
              data: { subscriptionEnd: now },
            });
          }
          await tx.organization.updateMany({
            where: { id: { in: unit.scopeOrgIds }, recurringActive: true },
            data: { recurringActive: false, recurringDisabledAt: now, recurringFailedAttempts: 0 },
          });
        }
        // Зеркала: пауза и отмена остаются как есть, но «Возобновить»
        // вернёт уже на бесплатный.
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
              userName: args.actor.userName ?? (chooses ? null : "WeSetup"),
              action: AUDIT_ACTIONS[args.mode],
              entity: unit.accountId ? "account" : "organization",
              entityId: unit.accountId ?? unit.organizationId,
              details: {
                mode: args.mode,
                reason: state.reason,
                keptUserName: keeper?.name ?? null,
                keptUserId: keeper?.id ?? null,
                keptJournalCode: keptJournal?.code ?? null,
                keptJournalName: keptJournal?.name ?? null,
                disabledJournalsCount: journalsToDisable,
                archivedCount: archiveIds.length,
                archived: toArchive.slice(0, 50).map((c) => c.name),
                archivedUserIds: archiveIds,
                activeUsersBefore: candidates.length,
                enabledJournalsBefore: unit.enabledJournals,
                planBefore,
                stateBefore: state.kind,
                paidUntilBefore: paidUntilBefore?.toISOString() ?? null,
                ...(endsTrial ? { trialEndsAtBefore: state.trialEndsAt?.toISOString() ?? null } : {}),
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
        stateBefore: state.kind,
        kept: keeper?.id ?? null,
        keptJournal: keptJournal?.code ?? null,
        archived: archiveIds.length,
        disabledJournals: journalsToDisable,
        planBefore,
        paidUntilBefore: paidUntilBefore?.toISOString() ?? null,
        actor: args.actor.userId,
      });

      return {
        ok: true,
        noop: false,
        keptUserId: keeper?.id ?? null,
        keptUserName: keeper?.name ?? null,
        keptJournalCode: keptJournal?.code ?? null,
        keptJournalName: keptJournal?.name ?? null,
        archivedCount: archiveIds.length,
        archivedNames: toArchive.map((c) => c.name),
        archivedUserIds: archiveIds,
        disabledJournalsCount: journalsToDisable,
        reason: state.reason,
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

// ------------------------------------------------------ scheduled change

/** Запомнить понижение тарифа с конца оплаченного срока. */
export async function scheduleDowngrade(args: {
  organizationId: string;
  target: ScheduledPlan;
  actor: { userId: string; userName: string | null; ipAddress?: string | null };
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const unit = await loadBillingUnit(args.organizationId);
  if (!unit?.accountId) return { ok: false, status: 409, error: "Тариф этой организации меняет владелец аккаунта" };
  await db.account.update({
    where: { id: unit.accountId },
    data: { scheduledPlanJson: args.target as unknown as Prisma.InputJsonValue },
  });
  await db.auditLog.create({
    data: {
      organizationId: args.organizationId,
      userId: args.actor.userId,
      userName: args.actor.userName,
      action: AUDIT_ACTIONS.scheduled,
      entity: "account",
      entityId: unit.accountId,
      details: { ...args.target, planBefore: unit.plan, planCycleBefore: unit.planCycle, planPointsBefore: unit.planPoints },
      ipAddress: args.actor.ipAddress ?? null,
    },
  });
  console.info("[billing] downgrade scheduled", { organizationId: args.organizationId, ...args.target });
  return { ok: true };
}

export async function cancelScheduledPlan(args: {
  organizationId: string;
  actor: { userId: string; userName: string | null; ipAddress?: string | null };
}): Promise<void> {
  const unit = await loadBillingUnit(args.organizationId);
  if (!unit?.accountId || !unit.scheduledPlan) return;
  await db.account.update({ where: { id: unit.accountId }, data: { scheduledPlanJson: Prisma.DbNull } });
  await db.auditLog.create({
    data: {
      organizationId: args.organizationId,
      userId: args.actor.userId,
      userName: args.actor.userName,
      action: AUDIT_ACTIONS.scheduleCancelled,
      entity: "account",
      entityId: unit.accountId,
      details: { ...unit.scheduledPlan },
      ipAddress: args.actor.ipAddress ?? null,
    },
  });
  console.info("[billing] scheduled downgrade cancelled", { organizationId: args.organizationId });
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

/** Что остаётся бесплатно: «1 сотрудник и 1 журнал». */
const FREE_LIMITS = `${employeesLabel(FREE_MAX_USERS)} и ${journalsLabel(FREE_MAX_JOURNALS)}`;

async function notifyTransition(args: {
  organizationId: string;
  mode: TransitionMode;
  result: Extract<TransitionResult, { ok: true }>;
}): Promise<void> {
  const { escapeHtml } = await import("@/lib/html-escape");
  const unit = await loadBillingUnit(args.organizationId);
  const orgName = unit?.organizationName ?? "Организация";
  const kept = args.result.keptUserName ?? "владелец";
  const keptJournal = args.result.keptJournalName ? `«${args.result.keptJournalName}»` : "один журнал";
  const archived = args.result.archivedCount;
  const payUrl = `${APP_URL}${BILLING_PAY_HREF}`;

  if (args.mode === "silent") {
    await sendOwnerNotice({
      organizationId: args.organizationId,
      kind: "billing.silent_free",
      telegramText:
        `ℹ️ «${escapeHtml(orgName)}» теперь на бесплатном тарифе — ${FREE_LIMITS}, как у вас и есть. ` +
        "Ничего делать не нужно. Когда понадобится команда или все журналы, тариф «Стандарт» или «Премиум» подключается в «Настройки → Тариф».",
      email: {
        subject: `«${orgName}»: вы на бесплатном тарифе`,
        title: "Вы на бесплатном тарифе",
        html: `<p ${P}>Здравствуйте!</p><p ${P}>Организация <strong>${escapeHtml(orgName)}</strong> теперь на бесплатном тарифе — ${FREE_LIMITS}, как у вас и есть. Ничего делать не нужно.</p><p ${P}>Когда понадобится команда или все журналы, тариф «Стандарт» или «Премиум» подключается в разделе «Настройки → Тариф».</p><a href="${payUrl}" ${BUTTON}>Открыть тариф</a>`,
      },
      // «Одно информационное уведомление»: Telegram, а без него — письмо.
      emailOnlyWithoutTelegram: true,
    });
    return;
  }

  const archivedLabel = employeesLabel(archived);
  const journalsOff = args.result.disabledJournalsCount > 0 ? `, выключено журналов: ${args.result.disabledJournalsCount}` : "";
  if (args.mode === "manual" || args.mode === "voluntary") {
    await sendOwnerNotice({
      organizationId: args.organizationId,
      kind: "billing.manual_free",
      telegramText:
        `✅ «${escapeHtml(orgName)}» перешла на бесплатный тариф (${FREE_LIMITS}). В работе: ${escapeHtml(kept)} и журнал ${escapeHtml(keptJournal)}. ` +
        `В архиве: ${archivedLabel}${journalsOff}. Вернуть всё можно после подключения тарифа — записи сохранены.`,
    });
    return;
  }

  await sendOwnerNotice({
    organizationId: args.organizationId,
    kind: "billing.auto_free",
    telegramText:
      `ℹ️ Тариф не выбрали, и «${escapeHtml(orgName)}» переведена на бесплатный тариф (${FREE_LIMITS}). ` +
      `В работе остались ${escapeHtml(kept)} и журнал ${escapeHtml(keptJournal)}; в архиве — ${archivedLabel}${journalsOff}. Вернуть всё можно после подключения тарифа.`,
    email: {
      subject: `«${orgName}» переведена на бесплатный тариф`,
      title: "Организация на бесплатном тарифе",
      html:
        `<p ${P}>Здравствуйте!</p>` +
        `<p ${P}>${args.result.reason === "subscription_expired" ? "Оплаченная подписка закончилась" : "Пробный период закончился"}, а тариф выбран не был. Организация <strong>${escapeHtml(orgName)}</strong> переведена на бесплатный тариф — ${FREE_LIMITS}.</p>` +
        `<div ${BOX}>В работе: <strong>${escapeHtml(kept)}</strong> и журнал <strong>${escapeHtml(keptJournal)}</strong>.<br>В архив перешли: ${archivedLabel}${journalsOff}. Записи в журналах сохранены.</div>` +
        `<p ${P}>Вернуть сотрудников и журналы можно после подключения тарифа «Стандарт» или «Премиум».</p>` +
        `<a href="${payUrl}" ${BUTTON}>Выбрать тариф</a>`,
    },
  });
}

async function sendDecisionReminder(
  unit: BillingUnit,
  state: AccountBillingState,
  prices: { standardFromRub: number; premiumFromRub: number }
): Promise<boolean> {
  const { escapeHtml } = await import("@/lib/html-escape");
  if (!state.graceEndsAt) return false;
  const deadline = formatMskDay(lastDayBefore(state.graceEndsAt));
  const orgName = unit.organizationName;
  const title = state.reason === "subscription_expired" ? "Подписка закончилась" : "Пробный период закончился";
  const payUrl = `${APP_URL}${BILLING_PAY_HREF}`;
  const now = `${employeesLabel(state.activeUsers)} и ${journalsLabel(state.enabledJournals)}`;
  await sendOwnerNotice({
    organizationId: unit.organizationId,
    kind: "billing.reminder",
    telegramText:
      `⏳ ${title}. В «${escapeHtml(orgName)}» ${now}, а на бесплатном тарифе — ${FREE_LIMITS}. ` +
      `До ${deadline} включительно выберите: подключить тариф (${paidPlansHint(prices)}) или остаться на бесплатном. ` +
      "Если ничего не выбрать, в работе останутся владелец аккаунта и самый заполняемый журнал.",
    email: {
      subject: `«${orgName}»: выберите тариф до ${deadline}`,
      title,
      html:
        `<p ${P}>Здравствуйте!</p>` +
        `<p ${P}>${escapeHtml(title)}. В организации <strong>${escapeHtml(orgName)}</strong> сейчас ${now}, а на бесплатном тарифе — ${FREE_LIMITS}.</p>` +
        `<div ${BOX}>До <strong>${deadline}</strong> включительно выберите: подключить тариф — ${escapeHtml(paidPlansHint(prices))} — или остаться на бесплатном.</div>` +
        `<p ${P}>Если ничего не выбрать, в работе останутся владелец аккаунта и самый заполняемый журнал. Остальное можно вернуть после оплаты — записи сохранятся.</p>` +
        `<a href="${payUrl}" ${BUTTON}>Выбрать тариф</a>`,
    },
  });
  return true;
}

async function sendTrialEndingReminder(
  unit: BillingUnit,
  state: AccountBillingState,
  prices: { standardFromRub: number; premiumFromRub: number }
): Promise<boolean> {
  const { escapeHtml } = await import("@/lib/html-escape");
  if (!state.trialEndsAt || state.trialDaysLeft === null) return false;
  const last = formatMskDay(lastDayBefore(state.trialEndsAt));
  const left = daysLabel(state.trialDaysLeft);
  const payUrl = `${APP_URL}${BILLING_PAY_HREF}`;
  await sendOwnerNotice({
    organizationId: unit.organizationId,
    kind: "billing.trial_reminder",
    telegramText:
      `⏳ Пробный период «${escapeHtml(unit.organizationName)}» заканчивается через ${left} — по ${last} включительно. ` +
      `Подключите тариф, чтобы всё осталось как есть: ${paidPlansHint(prices)} На бесплатном останутся ${FREE_LIMITS}.`,
    email: {
      subject: `Пробный период заканчивается ${last}`,
      title: "Пробный период заканчивается",
      html:
        `<p ${P}>Здравствуйте!</p>` +
        `<p ${P}>Пробный период организации <strong>${escapeHtml(unit.organizationName)}</strong> заканчивается через ${left} — по ${last} включительно.</p>` +
        `<div ${BOX}>${escapeHtml(paidPlansHint(prices))}</div>` +
        `<p ${P}>Если тариф не подключить, на бесплатном останутся ${FREE_LIMITS} — вы сами отметите, какие.</p>` +
        `<a href="${payUrl}" ${BUTTON}>Выбрать тариф</a>`,
    },
    emailOnlyWithoutTelegram: true,
  });
  return true;
}

// ------------------------------------------------------------ daily job

type UnitRow = BillingUnit & { orgIds: string[] };

/**
 * Все единицы биллинга платформы разом: организации, аккаунты, занятые
 * места, здания и журналы — несколько запросов вместо нескольких на
 * каждую организацию.
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
      createdAt: true,
      disabledJournalCodes: true,
      account: { select: ACCOUNT_SELECT },
    },
  });
  const [seats, buildings, codes] = await Promise.all([
    db.user.groupBy({ by: ["organizationId"], where: SEAT_USER_WHERE, _count: { _all: true } }),
    db.building.groupBy({ by: ["organizationId"], _count: { _all: true } }),
    activeJournalCodes(),
  ]);
  const seatsByOrg = new Map(seats.map((row) => [row.organizationId, row._count._all]));
  const buildingsByOrg = new Map(buildings.map((row) => [row.organizationId, row._count._all]));
  const cabinetSeats = await masterCabinetSeatsByOrg(orgs.map((org) => org.id));

  const units = new Map<string, UnitRow>();
  for (const org of orgs) {
    const key = org.accountId ?? `org:${org.id}`;
    const existing = units.get(key);
    const seatsHere = (seatsByOrg.get(org.id) ?? 0) + (cabinetSeats.get(org.id) ?? 0);
    const pointsHere = countPointsInUse([buildingsByOrg.get(org.id) ?? 0]);
    const journalsHere = enabledJournalCount(codes, org.disabledJournalCodes);
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
        createdAt: org.account?.createdAt ?? org.createdAt,
        trialEndsAt: org.account?.trialEndsAt ?? null,
        planCycle: org.account?.planCycle ?? null,
        planPoints: org.account?.planPoints ?? 1,
        scheduledPlan: parseScheduledPlan(org.account?.scheduledPlanJson),
        enabledJournals: journalsHere,
        pointsInUse: pointsHere,
      });
      continue;
    }
    existing.scopeOrgIds.push(org.id);
    existing.orgIds.push(org.id);
    existing.subscriptionEnd = maxDate([existing.subscriptionEnd, org.subscriptionEnd]);
    existing.activeUsers += seatsHere;
    existing.pointsInUse += pointsHere;
    existing.enabledJournals = Math.max(existing.enabledJournals, journalsHere);
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
  trialReminded: number;
  silentFree: number;
  reminded: number;
  autoFree: number;
  failed: number;
  results: Array<{ unit: string; organizationId: string; action: TransitionAction; activeUsers: number; outcome: string }>;
};

/** Цены «от» для писем: месячная цена при оплате за год, одна точка. */
async function pricesFrom(): Promise<{ standardFromRub: number; premiumFromRub: number }> {
  const { readPlanPricing } = await import("@/lib/tariffs");
  const { rates } = await readPlanPricing();
  return { standardFromRub: planMonthlyRub(rates, "standard", "year"), premiumFromRub: planMonthlyRub(rates, "premium", "year") };
}

/**
 * Ежедневная задача: напоминание за 3 дня до конца пробного, тихий `free`
 * для аккаунтов в пределах бесплатного, одно предупреждение «выберите
 * до …» сверх него, автопереход по истечении грейса. Идемпотентна:
 * повторный запуск ничего не меняет.
 */
export async function runBillingTransitionJob(options: { now?: Date; dryRun?: boolean } = {}): Promise<BillingJobReport> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const settings = await readTrialSettings();
  const report: BillingJobReport = {
    ok: true,
    dryRun,
    enforced: settings.transitionEnabled,
    now: now.toISOString(),
    scanned: 0,
    trialReminded: 0,
    silentFree: 0,
    reminded: 0,
    autoFree: 0,
    failed: 0,
    results: [],
  };

  const prices = await pricesFrom();
  const units = await listBillingUnits();
  report.scanned = units.length;
  for (const unit of units) {
    const state = stateForUnit(unit, settings, now);
    const action = decideTransitionAction(state, unit.plan);
    if (action === "none") continue;
    let outcome = "planned";
    try {
      if (action === "remind_trial_end") {
        const since = state.trialEndsAt ? new Date(state.trialEndsAt.getTime() - (TRIAL_REMINDER_DAYS + 1) * DAY_MS) : now;
        const already = await db.auditLog.findFirst({
          where: { organizationId: { in: unit.scopeOrgIds }, action: AUDIT_ACTIONS.trialReminder, createdAt: { gte: since } },
          select: { id: true },
        });
        if (already) {
          outcome = "trial reminder already sent";
          continue;
        }
        if (!dryRun) {
          await sendTrialEndingReminder(unit, state, prices);
          await db.auditLog.create({
            data: {
              organizationId: unit.organizationId,
              userName: "WeSetup",
              action: AUDIT_ACTIONS.trialReminder,
              entity: unit.accountId ? "account" : "organization",
              entityId: unit.accountId ?? unit.organizationId,
              details: { trialEndsAt: state.trialEndsAt?.toISOString() ?? null, daysLeft: state.trialDaysLeft },
            },
          });
          outcome = "trial reminder sent";
        }
        report.trialReminded += 1;
      } else if (action === "silent_free") {
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
          outcome = r.ok
            ? r.noop
              ? "noop"
              : `done: archived ${r.archivedCount}, journals off ${r.disabledJournalsCount}, kept ${r.keptJournalCode ?? "—"}`
            : `refused: ${r.error}`;
        }
        if (outcome.startsWith("done") || dryRun) report.autoFree += 1;
      } else if (action === "await_decision") {
        const since =
          state.reason === "subscription_expired" && unit.subscriptionEnd ? unit.subscriptionEnd : (state.trialEndsAt ?? now);
        const already = await db.auditLog.findFirst({
          where: { organizationId: { in: unit.scopeOrgIds }, action: AUDIT_ACTIONS.reminder, createdAt: { gte: since } },
          select: { id: true },
        });
        if (already) {
          outcome = "reminder already sent";
        } else if (!dryRun) {
          await sendDecisionReminder(unit, state, prices);
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
                enabledJournals: state.enabledJournals,
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
    trialReminded: report.trialReminded,
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
  /** Оплачено по тарифам. */
  paidByTier: { standard: number; premium: number; legacy: number };
  /** Пробный кончается в ближайшие 3 дня. */
  trialEndingSoon: number;
  /** Переведены задачей по грейсу и сейчас на бесплатном. */
  autoTransitioned: number;
};

function emptyCounts(): Record<AccountBillingKind, number> {
  return { exempt: 0, paid: 0, legacy: 0, free_period: 0, free: 0, needs_decision: 0 };
}

export async function collectBillingOverview(now: Date = new Date()): Promise<BillingOverview> {
  const settings = await readTrialSettings();
  const units = await listBillingUnits();
  const counts = emptyCounts();
  const paidByTier = { standard: 0, premium: 0, legacy: 0 };
  let trialEndingSoon = 0;
  const unitByOrg = new Map<string, UnitRow>();
  const stateByUnit = new Map<string, AccountBillingState>();
  for (const unit of units) {
    const state = stateForUnit(unit, settings, now);
    counts[state.kind] += 1;
    if (state.paidTier) paidByTier[state.paidTier] += 1;
    if (state.kind === "free_period" && state.trialDaysLeft !== null && state.trialDaysLeft <= TRIAL_REMINDER_DAYS) {
      trialEndingSoon += 1;
    }
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
  return { total: units.length, counts, paidByTier, trialEndingSoon, autoTransitioned: autoUnits.size };
}
