import {
  BILLING_TEST_MODE,
  FREE_MAX_USERS,
  isFreePlan,
} from "@/lib/plan-limits";
import { db } from "@/lib/db";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

/**
 * Серверная часть тарифных лимитов.
 *
 * Отделена от `plan-limits.ts` намеренно: константы и подписи читает и
 * шапка кабинета — клиентский компонент. Если в том же модуле лежит
 * `db`, webpack тянет `pg` в браузерный бандл и сборка падает на `fs`.
 */

export type EnsurePlanResult = {
  /** Перевели ли организацию на платный прямо сейчас. */
  upgraded: boolean;
  /** Тариф после проверки. */
  plan: string;
  /** Сколько активных сотрудников насчитали. */
  activeUsers: number;
};

/**
 * Пересчитывает численность и, если бесплатный лимит превышен, переводит
 * на платный тариф.
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
  // Динамический импорт: файл читают и клиентские компоненты (ради
  // FREE_MAX_USERS и planLabel), а `db`/`telegram` тянут server-only код.

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
          where: { accountId: org.accountId, isDemo: false },
          select: { id: true },
        })
      ).map((row) => row.id)
    : org.isDemo
      ? []
      : [org.id];

  const activeUsers = await db.user.count({
    // Сторонние члены бракеражной комиссии в тариф не входят (владелец, 2026-09-21).
    where: { organizationId: { in: scopeOrgIds }, isActive: true, ...NOT_COMMISSION_WHERE },
  });

  const currentPlan = org.account?.subscriptionPlan ?? org.subscriptionPlan;

  const overLimit = activeUsers > FREE_MAX_USERS;
  const shouldUpgrade =
    isFreePlan(currentPlan) && (options.force === true || overLimit);

  if (!shouldUpgrade) {
    return { upgraded: false, plan: currentPlan, activeUsers };
  }

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
        },
      },
    });
  } catch (err) {
    console.error("[plan-limits] audit write failed", err);
  }

  // Уведомление владельцу: переход тарифа — не то, о чём стоит узнавать
  // из счёта. В тестовом режиме прямо пишем, что оплата не требуется.
  try {
    const { notifyOrganization } = await import("@/lib/telegram");
    await notifyOrganization(
      organizationId,
      [
        BILLING_TEST_MODE ? "🧪" : "💳",
        ` Организация «${org.name}» перешла на платный тариф.`,
        `\nСотрудников: ${activeUsers} (бесплатно — до ${FREE_MAX_USERS}).`,
        BILLING_TEST_MODE
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
