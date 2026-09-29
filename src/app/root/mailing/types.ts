import type { CampaignListRow, DraftDto } from "@/lib/mailing/campaigns.server";
import type { MailingSettings } from "@/lib/mailing/rate-limit";
import type { MarketingSendMode } from "@/lib/mailing/transport.server";

export type MailingTab = "compose" | "users" | "contacts" | "history" | "stoplist";

export const MAILING_TABS: MailingTab[] = ["compose", "users", "contacts", "history", "stoplist"];

/** Данные страницы `/root/mailing` — собирает сервер, читает клиент. */
export type MailingPageData = {
  kinds: Array<{ kind: string; label: string; defaultPayload: unknown }>;
  sender: {
    mode: MarketingSendMode;
    from: string;
    fromAddress: string;
    separateSender: boolean;
    dryRunDir: string | null;
  };
  push: { webConfigured: boolean; appConfigured: boolean };
  telegramConfigured: boolean;
  settings: MailingSettings;
  sentToday: number;
  campaigns: CampaignListRow[];
  draft: DraftDto | null;
  initialTab: MailingTab;
};
