"use client";

import { toast } from "sonner";

/**
 * Единый toast «тариф изменился» — там, где API вернул `planUpgraded: true`.
 *
 * С тарифов 2026-10 сервер так больше не отвечает: тихого перевода на
 * платный без оплаты нет (14 дней пробного без лимитов, дальше — только
 * оплата, лимит проверяется до создания). Toast оставлен для старых
 * ответов и как единый текст на все точки входа.
 */
export function toastPlanUpgraded(): void {
  toast.info("Тариф изменился — подробности на странице тарифа", {
    duration: 10000,
    action: {
      label: "Подробнее",
      onClick: () => {
        window.location.href = "/settings/subscription";
      },
    },
  });
}
