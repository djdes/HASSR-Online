import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";

import { RootIdeasClient } from "./ideas-client";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("rootIdeas");
  return { title: t("title") };
}

/** Идеи клиентов: статус, комментарий — автору уходит уведомление в кабинет. */
export default async function RootIdeasPage() {
  await requireRoot();
  const t = await getTranslations("rootIdeas");
  return (
    <DomainMessagesBoundary namespaces={["rootIdeas"]}>
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
        <p className="mt-1 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">
          {t("description")}
        </p>
      </div>
      <RootIdeasClient />
    </div>
    </DomainMessagesBoundary>
  );
}
