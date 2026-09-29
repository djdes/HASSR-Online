import { notFound, redirect } from "next/navigation";

import { requireRoot } from "@/lib/auth-helpers";
import { getCampaignCard } from "@/lib/mailing/campaigns.server";
import { marketingSenderInfo } from "@/lib/mailing/transport.server";
import { readMailingSettings, emailSendStats } from "@/lib/mailing/settings.server";

import { CampaignCardClient } from "./campaign-card";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Рассылка — получатели",
};

/** Карточка рассылки: статусы получателей по каналам, отмена, повтор неудачных. */
export default async function MailingCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  const card = await getCampaignCard(id, { filter: "all", limit: 50 });
  if (!card) notFound();
  if (card.campaign.status === "draft") redirect(`/root/mailing?tab=compose&draft=${id}`);
  const [settings, stats] = await Promise.all([readMailingSettings(), emailSendStats()]);
  const sender = marketingSenderInfo();
  return (
    <CampaignCardClient
      initial={card}
      settings={settings}
      sentToday={stats.today}
      dryRun={sender.mode === "dry-run-dir" || sender.mode === "log-only"}
    />
  );
}
