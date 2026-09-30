import { Coins } from "lucide-react";

import { requireAuth, getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { loadBalanceOverview } from "@/lib/balance/overview";
import { loadTopupBlockConfig } from "@/lib/balance/topup";
import { BalanceClient } from "@/components/balance/balance-client";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

/**
 * Настройки → «Баланс и бонусы».
 *
 * Доступ у любого сотрудника организации: отзыв пишет и повар, и ему
 * важно видеть, сколько за это начислят. Баланс и историю списаний
 * внутри показываем только `admin.full` — это решает
 * `loadBalanceOverview`, а не страница.
 *
 * «Пополнить баланс» — только руководителю, который видит баланс, не ROOT
 * в режиме «войти как» (чужие деньги) и не в приложении WeSetup.
 */
export default async function BalanceSettingsPage() {
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const overview = await loadBalanceOverview(organizationId, session.user);
  // Приложение WeSetup: только баланс и история, без оплаты и без
  // заработка баллов на скидку к оплате (правила магазинов).
  const inApp = await isMobileAppRequest();
  const canTopUp =
    !inApp &&
    overview.canSeeBalance &&
    hasFullWorkspaceAccess(session.user) &&
    !isImpersonating(session);
  const topup = canTopUp
    ? await loadTopupBlockConfig(organizationId).catch((error) => {
        console.error("[balance] topup block load failed", error);
        return null;
      })
    : null;

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
              : "Баллами оплачивается подписка: 1 балл = 1 ₽. Их можно заработать — рекомендацией коллегам и отзывом о сервисе — или пополнить баланс деньгами. Тратятся автоматически при оплате."}
          </p>
        </div>
      </div>

      <BalanceClient initial={overview} variant="site" inApp={inApp} topup={topup} />
    </div>
  );
}
