import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import type { SupportAttachmentMeta } from "@/lib/support-attachments-shared";
import { SupportChatsClient } from "./support-chats-client";

export type RootChatMessage = {
  id: string;
  author: string;
  body: string;
  operatorName: string | null;
  authorName: string | null;
  attachments: SupportAttachmentMeta[];
  createdAt: string;
};

export type RootChatThread = {
  id: string;
  kind: "org" | "guest" | "legacy";
  organizationId: string | null;
  organizationName: string | null;
  userName: string | null;
  userEmail: string | null;
  phone: string | null;
  unreadForStaff: number;
  unreadForClient: number;
  lastMessageAt: string;
  partner: { partnerId: string; brandName: string } | null;
  messages: RootChatMessage[];
};

export type OrgOption = { id: string; name: string };

/** Keep the public server entry and serialize only this screen's selected-language copy. */
export function SupportChats(props: { threads: RootChatThread[]; organizations: OrgOption[] }) {
  return <DomainMessagesBoundary namespaces={["rootSupportChats"]}><SupportChatsClient {...props} /></DomainMessagesBoundary>;
}
