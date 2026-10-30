import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { edoBaseUrlOptions, getEdoCabinetView } from "@/lib/edo/cabinet.server";
import { listEdoDocuments } from "@/lib/edo/send.server";

import { EdoClient } from "./edo-client";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("rootEdo");
  return { title: t("metadata.title"), description: t("metadata.description") };
}

/**
 * ЭДО: договоры, счета и УПД клиентам через Saby от ООО «БФС». Сайт записывает документ в Saby
 * черновиком (получатель — по ИНН клиента), подписывает КЭП и отправляет человек в Saby.
 */
export default async function RootEdoPage() {
  await requireRoot();
  const [cabinet, documents, t] = await Promise.all([getEdoCabinetView(), listEdoDocuments(), getTranslations("rootEdo")]);
  return (
    <DomainMessagesBoundary namespaces={["rootEdo"]}>
      <div className="space-y-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("page.title")}</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">{t("page.description")}</p>
        </div>
        <EdoClient initialCabinet={cabinet} baseUrls={edoBaseUrlOptions()} initialDocuments={documents} />
      </div>
    </DomainMessagesBoundary>
  );
}
