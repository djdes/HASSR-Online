import { PromoOfferPage } from "@/components/promo/promo-offer-page";
import { CARD_PROMO_CODE } from "@/lib/promo/card-offer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Акция по визитке — скидка на сетап",
  description: "Акция по визитке сетап: тарифы «Стандарт» и «Премиум» со скидкой по промокоду.",
  robots: { index: false, follow: false },
};

/** Акция по визитке: QR на обороте → сюда, код `VIZITKA10` уже применён. */
export default function VizitkaPromoPage() {
  return (
    <PromoOfferPage
      config={{
        code: CARD_PROMO_CODE,
        tag: "vizitka",
        badge: "Акция по визитке",
        eyebrow: "Только для тех, кто отсканировал QR с визитки",
        contactCard: true,
        inactiveText:
          "Акция по визитке сейчас не действует — показываем обычные цены. Если промокод вам обещали, напишите или позвоните нам — поможем.",
      }}
    />
  );
}
