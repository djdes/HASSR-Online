import type { ReactNode } from "react";
import { loadMessages, pickMessages, type MessageNamespace } from "@/i18n/messages";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { DomainMessagesProvider } from "./domain-messages-provider";

/** Serialize only the domain messages for the current request's selected language. */
export async function DomainMessagesBoundary({ namespaces, children }: { namespaces: readonly MessageNamespace[]; children: ReactNode }) {
  const locale = await getSiteLocale();
  const messages = pickMessages(await loadMessages(locale), namespaces);
  return <DomainMessagesProvider messages={messages}>{children}</DomainMessagesProvider>;
}
