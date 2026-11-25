import { PromoOfferPage } from "@/components/promo/promo-offer-page";
import { AD_PROMO_CODE } from "@/lib/promo/card-offer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Акция сетап: 14 дней бесплатно и −10 % на первую оплату",
  description: "Электронные журналы ХАССП и СанПиН: 14 дней бесплатно, затем −10 % на первую оплату по промокоду.",
  robots: { index: false, follow: false },
};

/**
 * Акция из рекламных постов (ссылка с erid): 14 дней бесплатно, затем
 * −10 % на первую оплату по коду `SETUP10`.
 */
export default function AdPromoPage() {
  return (
    <PromoOfferPage
      config={{
        code: AD_PROMO_CODE,
        tag: "akciya",
        badge: "Акция",
        eyebrow: "Специальное предложение для новых клиентов",
        trial: true,
        inactiveText:
          "Акция сейчас не действует — показываем обычные цены. Первые 14 дней всё равно бесплатно: зарегистрируйтесь и попробуйте.",
      }}
    />
  );
}
