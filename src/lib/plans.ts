/**
 * Single source of truth for subscription plans.
 * Used in: payments/create, payments/webhook, subscription-manager UI, landing page.
 */

import { JOURNAL_TARIFFS, formatJournalPreview, journalsCountLabel } from "./journal-catalog";

export type PlanId = "starter" | "standard" | "pro";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceRub: number;
  durationDays: number;
  maxUsers: number | null;
  features: string[];
}

const basicTariff = JOURNAL_TARIFFS.basic;
const extendedTariff = JOURNAL_TARIFFS.extended;
const extendedExtraJournals = extendedTariff.extraJournals ?? [];

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Стартовый",
    priceRub: 3000,
    durationDays: 30,
    maxUsers: 3,
    features: [
      "До 3 пользователей",
      `Тариф "${basicTariff.name}": ${journalsCountLabel(basicTariff.journals.length)}`,
      formatJournalPreview(basicTariff.journals),
      "PDF-отчёты",
      "Email-уведомления",
    ],
  },
  standard: {
    id: "standard",
    name: "Стандарт",
    priceRub: 5000,
    durationDays: 30,
    maxUsers: 10,
    features: [
      "До 10 пользователей",
      `Тариф "${extendedTariff.name}": ${journalsCountLabel(extendedTariff.journals.length)} (${extendedTariff.subtitle})`,
      `Дополнительно: ${formatJournalPreview(extendedExtraJournals)}`,
      "IoT-мониторинг",
      "Telegram-уведомления",
      "Excel-экспорт",
      "Сканер штрих-кодов",
    ],
  },
  pro: {
    id: "pro",
    name: "Про",
    priceRub: 8000,
    durationDays: 30,
    maxUsers: null,
    features: [
      "Безлимит пользователей",
      'Всё из тарифа "Стандарт"',
      "Приоритетная поддержка",
      "API-доступ",
      "White-label",
      "ФГИС Меркурий",
    ],
  },
};

export function isValidPlanId(id: unknown): id is PlanId {
  return typeof id === "string" && id in PLANS;
}
