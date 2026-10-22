import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { readPlatformStatus } from "@/lib/platform-status";

import { StatusClient } from "./status-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rootStatus.page");
  return { title: t("title") };
}

export default async function RootStatusPage() {
  await requireRoot();
  const settings = await readPlatformStatus();
  return (
    <DomainMessagesBoundary namespaces={["rootStatus"]}>
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{(await getTranslations("rootStatus.page"))("title")}</h1>
        <p className="mt-1 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">
          {(await getTranslations("rootStatus.page")).rich("description", {
            statusLink: (chunks) => <a href="/status" className="underline underline-offset-2" target="_blank" rel="noreferrer">{chunks}</a>,
          })}
        </p>
      </div>
      <StatusClient initial={settings} />
    </div>
    </DomainMessagesBoundary>
  );
}
