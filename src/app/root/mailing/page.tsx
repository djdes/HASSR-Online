import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { MailingFeedbackProvider } from "./mailing-feedback";
import { requireRoot } from "@/lib/auth-helpers";
import { getDraft, listCampaigns } from "@/lib/mailing/campaigns.server";
import { pushAvailability, telegramBotConfigured } from "@/lib/mailing/channels.server";
import { mailingKindOptionsWithData } from "@/lib/mailing/kinds";
import { listMailingBases } from "@/lib/mailing/quick.server";
import { emailSendStats, readMailingSettings } from "@/lib/mailing/settings.server";
import { marketingSenderInfo } from "@/lib/mailing/transport.server";

import { MailingClient } from "./mailing-client";
import { MAILING_TABS, type MailingPageData, type MailingTab } from "./types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const t = await getTranslations("rootMailingShellAudience");
  return { title: t("page.title") };
}

/**
 * ROOT → «Рассылка». По умолчанию — простой режим: база адресов + готовое
 * письмо (`src/lib/mailing/presets.ts`, пишет Claude) → тест себе, отправка
 * сейчас или по расписанию. Расширенный режим — конструктор и ручной выбор
 * пользователей и контактов. Очередь с лимитом писем разбирает cron
 * `/api/cron/mailing`.
 */
export default async function RootMailingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; draft?: string }>;
}) {
  await requireRoot();
  const params = await searchParams;
  const [campaigns, settings, stats, draftRaw, kinds, bases] = await Promise.all([
    listCampaigns(),
    readMailingSettings(),
    emailSendStats(),
    params.draft ? getDraft(params.draft) : Promise.resolve(null),
    mailingKindOptionsWithData(),
    listMailingBases().catch((error) => {
      console.error("[mailing] bases failed", error);
      return [];
    }),
  ]);
  const draft = draftRaw && draftRaw.status === "draft" ? draftRaw : null;
  const sender = marketingSenderInfo();
  const initialTab: MailingTab = MAILING_TABS.includes(params.tab as MailingTab)
    ? (params.tab as MailingTab)
    : draft
      ? "compose"
      : "quick";

  const data: MailingPageData = {
    kinds,
    sender: {
      mode: sender.mode,
      from: sender.from,
      fromAddress: sender.fromAddress,
      separateSender: sender.separateSender,
      dryRunDir: sender.dryRunDir,
    },
    push: pushAvailability(),
    telegramConfigured: telegramBotConfigured(),
    settings,
    sentToday: stats.today,
    campaigns,
    bases,
    draft,
    initialTab,
  };

  const t = await getTranslations("rootMailingShellAudience");

  return (
    <DomainMessagesBoundary namespaces={["rootMailingShellAudience", "rootMailingKindFields", "rootMailingCompose", "rootMailingDiagnostics"]}>
    <MailingFeedbackProvider>
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("page.title")}</h1>
        <p className="mt-1 max-w-[820px] text-[14px] leading-relaxed text-[#6f7282]">
          {t("page.description")}
        </p>
      </div>
      <MailingClient data={data} />
    </div>
    </MailingFeedbackProvider>
    </DomainMessagesBoundary>
  );
}
