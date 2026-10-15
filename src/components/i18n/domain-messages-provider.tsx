"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import type { Messages } from "@/i18n/messages";

/** Domain layouts add complete namespaces while retaining their parent context. */
export function DomainMessagesProvider({ messages, children }: { messages: Partial<Messages>; children: ReactNode }) {
  const parent = useMessages();
  const locale = useLocale();
  const merged = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
  return <NextIntlClientProvider locale={locale} messages={merged}>{children}</NextIntlClientProvider>;
}
