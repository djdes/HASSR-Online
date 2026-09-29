import { requireRoot } from "@/lib/auth-helpers";
import { listLifetimeDiscountsForRoot } from "@/lib/promo/lifetime";
import { listPromoCodesForRoot } from "@/lib/promo/promo-codes-admin";

import { PromoCodesClient } from "./promo-codes-client";

export const dynamic = "force-dynamic";

export default async function RootPromoCodesPage() {
  await requireRoot();
  const [codes, lifetime] = await Promise.all([listPromoCodesForRoot(), listLifetimeDiscountsForRoot()]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Промокоды</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          Скидка на подписку при оформлении: процент или рубли, срок, лимит использований,
          «только новым». Считается по оплаченным заказам — брошенный заказ лимит не тратит.
          Если идёт акция (ROOT → «Акции»), промокод считается от цены по акции. К оборудованию
          скидка не применяется. «Навсегда» — первая оплата с кодом закрепляет скидку за аккаунтом,
          дальше она применяется сама (не складывается с другими кодами — берётся выгоднейшая).
          Персональный код работает только для своей почты или организации. Стартовый набор кодов —{" "}
          <code>scripts/seed-promo-codes.ts</code> (создаёт выключенными).
        </p>
      </div>
      <PromoCodesClient initial={codes} lifetime={lifetime} />
    </div>
  );
}
