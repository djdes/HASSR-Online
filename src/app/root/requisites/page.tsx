import { getTranslations } from "next-intl/server";

import { requireRoot } from "@/lib/auth-helpers";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { requisitesChecklist } from "@/lib/closing-documents/types";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

import { RequisitesClient } from "./requisites-client";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("rootRequisites");
  return { title: t("metadata.title"), description: t("metadata.description") };
}

/**
 * Реквизиты нашей организации и факсимиле — источник для закрывающих
 * документов (УПД). Данные, а не код: меняются здесь, без деплоя.
 */
export default async function RootRequisitesPage() {
  await requireRoot();
  const requisites = await readPlatformRequisites();
  const t = await getTranslations("rootRequisites");
  return (
    <DomainMessagesBoundary namespaces={["rootRequisites"]}>
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
          {t("page.title")}
        </h1>
        <p className="mt-1 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">
          {t("page.description")}
        </p>
      </div>
      <RequisitesClient initial={requisites} initialChecklist={requisitesChecklist(requisites)} />
    </div>
    </DomainMessagesBoundary>
  );
}
