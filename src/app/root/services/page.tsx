import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { readServices } from "@/lib/services/catalog";
import { ServicesAdmin } from "./services-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const t = await getTranslations("rootServices");
  return { title: t("title") };
}

/**
 * ROOT-админка каталога услуг.
 *
 * Публичная /uslugi и раздел в кабинете читают ту же таблицу при каждом
 * запросе, поэтому правка цены применяется сразу — деплой не нужен.
 */
export default async function RootServicesPage() {
  await requireRoot();
  const services = await readServices();
  const t = await getTranslations("rootServices");

  return (
    <DomainMessagesBoundary namespaces={["rootServices"]}>
    <div className="mx-auto max-w-[980px]">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
        {t("title")}
      </h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-[#6f7282]">
        {t("description")}
      </p>
      <div className="mt-6">
        <ServicesAdmin initial={services} />
      </div>
    </div>
    </DomainMessagesBoundary>
  );
}
