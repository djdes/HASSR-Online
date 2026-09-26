import { Coins } from "lucide-react";

import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { loadBalanceOverview } from "@/lib/balance/overview";
import { BalanceClient } from "@/components/balance/balance-client";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";

export const dynamic = "force-dynamic";

/**
 * Настройки → «Баланс и бонусы».
 *
 * Доступ у любого сотрудника организации: отзыв пишет и повар, и ему
 * важно видеть, сколько за это начислят. Баланс и историю списаний
 * внутри показываем только `admin.full` — это решает
 * `loadBalanceOverview`, а не страница.
 */
export default async function BalanceSettingsPage() {
  const session = await requireAuth();
  const overview = await loadBalanceOverview(
    getActiveOrgId(session),
    session.user,
  );
  // Приложение WeSetup: только баланс и история, без оплаты и без
  // заработка баллов на скидку к оплате (правила магазинов).
  const inApp = await isMobileAppRequest();

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Coins className="size-5" />
        </span>
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-semibold tracking-[-0.02em] text-[#0b1024]">
            Баланс и бонусы
          </h1>
          <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
            {inApp
              ? "Бонусные баллы вашей организации и история начислений."
              : "Баллы — это скидка на подписку: 1 балл = 1 ₽. Зарабатываются двумя способами: рекомендацией коллегам и отзывом о сервисе. Тратятся автоматически при оплате."}
          </p>
        </div>
      </div>

      <BalanceClient initial={overview} variant="site" inApp={inApp} />
    </div>
  );
}
