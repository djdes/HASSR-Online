import { BILLING_TEST_MODE, FREE_MAX_USERS, isFreePlan } from "@/lib/plan-limits";
import { db } from "@/lib/db";
import {
  billingPhase,
  formatMskDay,
  isAutoUpgradeAllowed,
  lastFreeDay,
} from "@/lib/billing-period";
import {
  SEAT_USER_WHERE,
  loadAccountBilling,
  readFreePeriodSettings,
} from "@/lib/billing.server";
import { employeesLabel } from "@/lib/plan-catalog";

/**
 * Серверная часть тарифных лимитов.
 *
 * Отделена от `plan-limits.ts` намеренно: константы и подписи читает и
 * шапка кабинета — клиентский компонент. Если в том же модуле лежит
 * `db`, webpack тянет `pg` в браузерный бандл и сборка падает на `fs`.
 */

/**
 * Платный ли тариф у организации — для платных возможностей (автоввод
 * температуры с фото). Тариф живёт на аккаунте (legacy-зеркало — в
 * организации), как в шапке кабинета; приостановленная или отменённая
 * организация — без платных возможностей, даже если аккаунт платный.
 *
 * С бесплатным периодом (2026-10): в периоде возможности включены у
 * всех, после — только у реально оплативших (`billing-period.ts`).
 */
export async function hasPaidPlan(organizationId: string): Promise<boolean> {
  const loaded = await loadAccountBilling(organizationId);
  return loaded?.state.paidFeatures ?? false;
}

export type EnsurePlanResult = {
  /** Перевели ли организацию на платный прямо сейчас. */
  upgraded: boolean;
  /** Тариф после проверки. */
  plan: string;
  /** Сколько активных сотрудников насчитали. */
  activeUsers: number;
  /**
   * Бесплатный период закончился и переход на оплату включён: платный
   * тариф теперь только после оплаты, тихого перевода нет.
   */
  paymentRequired?: boolean;
};

/**
 * Пересчитывает численность и, если бесплатный лимит превышен, переводит
 * на платный тариф — но только пока не закончился бесплатный период
 * (или пока переход на оплату выключен в ROOT). После — платный тариф
 * только после оплаты, а лимит бесплатного проверяет
 * `checkSeatsForActivation` ДО создания сотрудника.
 *
 * Считаем по аккаунту, а не по организации: у сети из трёх кафе один
 * договор, и бесплатные места (`FREE_MAX_USERS`) — общие. Пока организация не привязана
 * к аккаунту (миграция scripts/migrate-multi-org.ts ещё не прогонялась),
 * работаем по-старому — по одной организации.
 *
 * Вызывается после КАЖДОГО создания пользователя. Идемпотентна:
 * повторный вызов на уже платном тарифе ничего не делает.
 *
 * @param options.force — перевести на платный независимо от численности
 *   (ручное «Улучшить тариф» со страницы `/settings/subscription`).
 */
export async function ensurePlanForHeadcount(
  organizationId: string,
  options: { force?: boolean } = {}
): Promise<EnsurePlanResult> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      subscriptionPlan: true,
      accountId: true,
      isDemo: true,
      account: { select: { id: true, subscriptionPlan: true } },
    },
  });

  if (!org) {
    return { upgraded: false, plan: "free", activeUsers: 0 };
  }

  // Организации аккаунта. Человек, работающий в двух точках, живёт в
  // одной из них как «домашней» — поэтому двойного счёта нет.
  // Демо-организация в тариф не входит: её тестовые сотрудники не должны
  // переводить аккаунт на платный.
  const scopeOrgIds = org.accountId
    ? (
        await db.organization.findMany({
          // Мастер-кабинет справочников — служебный кабинет бэк-офиса, в тариф не входит.
          where: { accountId: org.accountId, isDemo: false, kind: { not: "directory" } },
          select: { id: true },
        })
      ).map((row) => row.id)
    : org.isDemo
      ? []
      : [org.id];

  const activeUsers = await db.user.count({
    // Сторонние члены бракеражной комиссии, архив и ROOT в тариф не входят
    // (владелец, 2026-09-21) — тот же счёт, что у перехода на оплату.
    where: { ...SEAT_USER_WHERE, organizationId: { in: scopeOrgIds } },
  });

  const currentPlan = org.account?.subscriptionPlan ?? org.subscriptionPlan;

  const overLimit = activeUsers > FREE_MAX_USERS;
  const shouldUpgrade =
    isFreePlan(currentPlan) && (options.force === true || overLimit);

  if (!shouldUpgrade) {
    return { upgraded: false, plan: currentPlan, activeUsers };
  }

  // После конца бесплатного периода (и с включённым переходом) платный
  // тариф — только после оплаты. Тихий перевод на «платный» без денег
  // стал бы бесплатной подпиской навсегда.
  const settings = await readFreePeriodSettings();
  const now = new Date();
  if (!isAutoUpgradeAllowed(settings, now)) {
    console.info("[billing] auto-upgrade skipped: payment required", {
      organizationId,
      activeUsers,
      force: options.force === true,
    });
    return { upgraded: false, plan: currentPlan, activeUsers, paymentRequired: true };
  }
  const inFreePeriod = billingPhase(settings, now) === "free_period";

  const upgradedAt = new Date();
  // Тариф живёт на аккаунте, но пишем и в организации: часть кода ещё
  // читает legacy-зеркало, и разъехавшиеся значения выглядели бы как
  // «на одной странице платный, на другой бесплатный».
  await db.$transaction(async (tx) => {
    if (org.accountId) {
      await tx.account.update({
        where: { id: org.accountId },
        data: {
          subscriptionPlan: "paid",
          subscriptionEnd: null,
          planAutoUpgradedAt: upgradedAt,
        },
      });
    }
    await tx.organization.updateMany({
      where: org.accountId ? { accountId: org.accountId } : { id: org.id },
      data: {
        subscriptionPlan: "paid",
        // Платный тариф без даты окончания: в тестовом режиме нечего
        // продлевать, а «просроченная» дата ломала бы read-only-логику.
        subscriptionEnd: null,
        planAutoUpgradedAt: upgradedAt,
      },
    });
  });

  console.info("[billing] auto-upgrade → paid without payment", {
    organizationId,
    activeUsers,
    reason: options.force ? "manual" : "headcount",
    freePeriod: inFreePeriod,
  });

  // Аудит — best-effort, ошибка записи не должна валить создание сотрудника.
  try {
    await db.auditLog.create({
      data: {
        organizationId,
        action: "plan.auto_upgraded",
        entity: "organization",
        entityId: organizationId,
        details: {
          activeUsers,
          freeLimit: FREE_MAX_USERS,
          reason: options.force ? "manual" : "headcount",
          billingTestMode: BILLING_TEST_MODE,
          freePeriod: inFreePeriod,
        },
      },
    });
  } catch (err) {
    console.error("[plan-limits] audit write failed", err);
  }

  // Уведомление владельцу: переход тарифа — не то, о чём стоит узнавать
  // из счёта. Прямо пишем, почему оплата сейчас не требуется: идёт
  // бесплатный период или сайт в тестовом режиме.
  try {
    const { notifyOrganization } = await import("@/lib/telegram");
    await notifyOrganization(
      organizationId,
      [
        inFreePeriod || BILLING_TEST_MODE ? "🧪" : "💳",
        ` Организация «${org.name}» перешла на подписку.`,
        `\nСотрудников: ${activeUsers} (бесплатный тариф — ${employeesLabel(FREE_MAX_USERS)}).`,
        inFreePeriod
          ? `\nПодписка бесплатна для всех по ${formatMskDay(lastFreeDay(settings))} включительно — оплата сейчас не требуется.`
          : BILLING_TEST_MODE
            ? "\nСайт в тестовом режиме — оплата не требуется."
            : "",
      ].join(""),
      ["owner"]
    );
  } catch (err) {
    console.error("[plan-limits] telegram notify failed", err);
  }

  return { upgraded: true, plan: "paid", activeUsers };
}
