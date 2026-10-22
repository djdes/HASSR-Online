import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { dateToMskInput } from "@/lib/promo/promotions";
import { listPromotionAudit, listPromotionsForRoot } from "@/lib/promo/promotions-admin";
import { fallbackTariffs, readTariffs, TARIFF_MONTHLY } from "@/lib/tariffs";

import { PromotionsClient } from "./promotions-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const t = await getTranslations("rootPromotions");
  return { title: t("title") };
}

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
    listPromotionAudit(20, { includePresentationOrigin: true }),
    readTariffs().catch(() => fallbackTariffs()),
  ]);
  const monthly = tariffs.find((t) => t.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0];

  const t = await getTranslations("rootPromotions");
  return (
    <DomainMessagesBoundary namespaces={["rootPromotions", "journalControls"]}>
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          {t("description")}
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
    </DomainMessagesBoundary>
  );
}
