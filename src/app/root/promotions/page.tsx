import { requireRoot } from "@/lib/auth-helpers";
import { dateToMskInput } from "@/lib/promo/promotions";
import { listPromotionAudit, listPromotionsForRoot } from "@/lib/promo/promotions-admin";
import { fallbackTariffs, readTariffs, TARIFF_MONTHLY } from "@/lib/tariffs";

import { PromotionsClient } from "./promotions-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Акции",
};

/**
 * ROOT → «Акции»: процентная скидка на подписку в окне дат. Пока акция
 * идёт, на лендинге, /pricing, в кабинете и на /order старая цена
 * зачёркнута, а к оплате — цена со скидкой (lib/promo/offer.ts).
 */
export default async function RootPromotionsPage() {
  await requireRoot();
  const now = new Date();
  const [promotions, history, tariffs] = await Promise.all([
    listPromotionsForRoot(),
    listPromotionAudit(20),
    readTariffs().catch(() => fallbackTariffs()),
  ]);
  const monthly = tariffs.find((t) => t.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Акции</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          Скидка в процентах на подписку с датой и временем начала и конца. Пока акция идёт,
          на лендинге, в тарифах, в кабинете и на оплате старая цена зачёркнута, рядом — новая
          и плашка «−N % до …»; к оплате — цена со скидкой. Акции пересекаются — действует
          наибольший процент. Промокод считается уже от цены по акции. Время — московское.
        </p>
      </div>
      <PromotionsClient
        promotions={promotions}
        history={history}
        nowIso={now.toISOString()}
        nowMsk={dateToMskInput(now)}
        baseRub={monthly.priceRub}
      />
    </div>
  );
}
