import { db } from "@/lib/db";
import { SEAT_USER_WHERE, hasPlanFeature } from "@/lib/billing.server";

/**
 * Серверная часть тарифных лимитов.
 *
 * Отделена от `plan-limits.ts` намеренно: константы и подписи читает и
 * шапка кабинета — клиентский компонент. Если в том же модуле лежит
 * `db`, webpack тянет `pg` в браузерный бандл и сборка падает на `fs`.
 */

/**
 * Автоввод показаний с фото датчика (`/api/ocr/reading`, QR-формы
 * оборудования и помещений) — возможность «Премиума» и пробного периода
 * (тарифы 2026-10). Имя функции осталось с тех времён, когда платный тариф
 * был один.
 */
export async function hasPaidPlan(organizationId: string): Promise<boolean> {
  return hasPlanFeature(organizationId, "photoAutofill");
}

export type EnsurePlanResult = {
  /** Перевели ли организацию на платный прямо сейчас — с тарифов 2026-10 никогда. */
  upgraded: boolean;
  /** Тариф после проверки. */
  plan: string;
  /** Сколько активных сотрудников насчитали. */
  activeUsers: number;
  /** Платный тариф подключается только оплатой. */
  paymentRequired?: boolean;
};

/**
 * Пересчёт численности после создания сотрудника.
 *
 * До тарифов 2026-10 здесь был тихий перевод на «платный» без оплаты при
 * превышении бесплатного лимита. Теперь его нет: 14 дней пробного лимитов
 * нет вовсе, после — тариф подключается только оплатой, а лимит проверяет
 * `checkSeatsForActivation` ДО создания. Функция осталась, потому что её
 * зовут все пути создания сотрудника и отдают `planUpgraded` клиенту.
 *
 * @param options.force — ручное «Улучшить тариф»: ответ «нужна оплата».
 */
export async function ensurePlanForHeadcount(
  organizationId: string,
  options: { force?: boolean } = {}
): Promise<EnsurePlanResult> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      subscriptionPlan: true,
      accountId: true,
      isDemo: true,
      account: { select: { subscriptionPlan: true } },
    },
  });
  if (!org) return { upgraded: false, plan: "free", activeUsers: 0 };

  // Мастер-кабинет справочников и демо в тариф не входят.
  const scopeOrgIds = org.accountId
    ? (
        await db.organization.findMany({
          where: { accountId: org.accountId, isDemo: false, kind: { not: "directory" } },
          select: { id: true },
        })
      ).map((row) => row.id)
    : org.isDemo
      ? []
      : [organizationId];
  const activeUsers = scopeOrgIds.length
    ? await db.user.count({ where: { ...SEAT_USER_WHERE, organizationId: { in: scopeOrgIds } } })
    : 0;
  return {
    upgraded: false,
    plan: org.account?.subscriptionPlan ?? org.subscriptionPlan,
    activeUsers,
    ...(options.force ? { paymentRequired: true } : {}),
  };
}
