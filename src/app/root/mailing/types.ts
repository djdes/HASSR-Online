import type { MailingBase } from "@/lib/mailing/bases";
import type { CampaignListRow, DraftDto } from "@/lib/mailing/campaigns.server";
import type { MailingSettings } from "@/lib/mailing/rate-limit";
import type { MarketingSendMode } from "@/lib/mailing/transport.server";

export type MailingTab = "quick" | "history" | "compose" | "users" | "contacts" | "stoplist";

export const MAILING_TABS: MailingTab[] = ["quick", "history", "compose", "users", "contacts", "stoplist"];

/** Вкладки расширенного режима — конструктор и ручной выбор (для Claude и редких случаев). */
export const ADVANCED_TABS: ReadonlySet<MailingTab> = new Set(["compose", "users", "contacts", "stoplist"]);

/** Данные страницы `/root/mailing` — собирает сервер, читает клиент. */
export type MailingPageData = {
  kinds: Array<{ kind: string; label: string; defaultPayload: unknown; formData?: unknown }>;
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
  /** Базы адресов простого режима (сегменты клиентов и загруженные). */
  bases: MailingBase[];
  draft: DraftDto | null;
  initialTab: MailingTab;
};
