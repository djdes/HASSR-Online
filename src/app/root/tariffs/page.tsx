import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { readTariffs } from "@/lib/tariffs";
import { collectBillingOverview, readFreePeriodSettings } from "@/lib/billing.server";
import { TariffsClient } from "./tariffs-client";
import { BillingPeriodCard } from "./billing-period-card";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const t = await getTranslations("rootTariffs");
  return { title: t("pageTitle") };
}

/**
 * ROOT-админка цен. Лендинг, /pricing и создание платежа читают ту же
 * таблицу, поэтому смена цены применяется сразу после сохранения —
 * деплой не нужен.
 */
export default async function RootTariffsPage() {
  await requireRoot();
  const [tariffs, freePeriod, billingOverview] = await Promise.all([
    readTariffs(),
    readFreePeriodSettings(),
    collectBillingOverview(),
  ]);

  const t = await getTranslations("rootTariffs");

  return (
    <DomainMessagesBoundary namespaces={["rootTariffs"]}>
    <div className="mx-auto max-w-[880px]">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
        {t("pageTitle")}
      </h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-[#6f7282]">
        {t("pageDescription")}
      </p>
      <div className="mt-6">
        <TariffsClient initial={tariffs} />
      </div>
      {/* Бесплатный период «подписка для всех» и переход на оплату (2026-10). */}
      <div className="mt-6">
        <BillingPeriodCard
          initialSettings={{
            startsAt: freePeriod.startsAt.toISOString(),
            endsAt: freePeriod.endsAt.toISOString(),
            graceDays: freePeriod.graceDays,
            transitionEnabled: freePeriod.transitionEnabled,
          }}
          initialOverview={billingOverview}
        />
      </div>
    </div>
    </DomainMessagesBoundary>
  );
}
