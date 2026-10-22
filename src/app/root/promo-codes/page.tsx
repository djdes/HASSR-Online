import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { getTranslations } from "next-intl/server";
import { requireRoot } from "@/lib/auth-helpers";
import { listLifetimeDiscountsForRoot } from "@/lib/promo/lifetime";
import { listPromoCodesForRoot } from "@/lib/promo/promo-codes-admin";

import { PromoCodesClient } from "./promo-codes-client";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("rootPromoCodes");
  return { title: t("page.title") };
}

export default async function RootPromoCodesPage() {
  await requireRoot();
  const [codes, lifetime] = await Promise.all([listPromoCodesForRoot(), listLifetimeDiscountsForRoot()]);
  const t = await getTranslations("rootPromoCodes");
  return (
    <DomainMessagesBoundary namespaces={["rootPromoCodes"]}>
      <div className="space-y-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("page.title")}
          </h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
            {t.rich("page.explanation", {
              seedScript: "scripts/seed-promo-codes.ts",
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        </div>
        <PromoCodesClient initial={codes} lifetime={lifetime} />
      </div>
    </DomainMessagesBoundary>
  );
}
