import { requireRoot } from "@/lib/auth-helpers";
import { getDraft, listCampaigns } from "@/lib/mailing/campaigns.server";
import { pushAvailability, telegramBotConfigured } from "@/lib/mailing/channels.server";
import { mailingKindOptions } from "@/lib/mailing/kinds";
import { emailSendStats, readMailingSettings } from "@/lib/mailing/settings.server";
import { marketingSenderInfo } from "@/lib/mailing/transport.server";

import { MailingClient } from "./mailing-client";
import { MAILING_TABS, type MailingPageData, type MailingTab } from "./types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Рассылка",
};

/**
 * ROOT → «Рассылка»: пользователи платформы (фильтры) и загруженные
 * контакты → сообщение в почту / колокольчик / push / Telegram по
 * галочкам, тест себе, отправка сейчас или по расписанию. Очередь с
 * лимитом писем разбирает cron `/api/cron/mailing`.
 */
export default async function RootMailingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; draft?: string }>;
}) {
  await requireRoot();
  const params = await searchParams;
  const [campaigns, settings, stats, draftRaw] = await Promise.all([
    listCampaigns(),
    readMailingSettings(),
    emailSendStats(),
    params.draft ? getDraft(params.draft) : Promise.resolve(null),
  ]);
  const draft = draftRaw && draftRaw.status === "draft" ? draftRaw : null;
  const sender = marketingSenderInfo();
  const initialTab: MailingTab = MAILING_TABS.includes(params.tab as MailingTab)
    ? (params.tab as MailingTab)
    : "compose";

  const data: MailingPageData = {
    kinds: mailingKindOptions(),
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
    draft,
    initialTab,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Рассылка</h1>
        <p className="mt-1 max-w-[820px] text-[14px] leading-relaxed text-[#6f7282]">
          Сообщение выбранным пользователям платформы и загруженным контактам: письмо, колокольчик в кабинете, push и
          Telegram — по галочкам. Письма уходят очередью с ограничением скорости, в каждом — ссылка «Отписаться»;
          отписавшиеся попадают в стоп-лист и больше рекламу не получают. Служебные письма это не затрагивает.
        </p>
      </div>
      <MailingClient data={data} />
    </div>
  );
}
