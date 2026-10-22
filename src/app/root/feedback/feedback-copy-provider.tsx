"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DeliveredReplyCombination, FeedbackReplyErrorKey } from "./feedback-report-presentation";

type FeedbackCopyContextValue = {
  getReplyErrorCopy: (key: FeedbackReplyErrorKey) => string;
  getTestErrorCopy: () => string;
  getReplyDeliveryCopy: (combination: DeliveredReplyCombination | null) => string;
  getTestTelegramCopy: (sent: boolean, count: string) => string;
  getTestEmailCopy: (configured: boolean, sent: boolean) => string;
  getTestResultCopy: (telegram: string, email: string) => string;
};
const FeedbackCopyContext = createContext<FeedbackCopyContextValue | null>(null);

/** Stable accessor whose committed translator stays current for retained async actions/toasts. */
export function FeedbackCopyProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("rootFeedbackReports");
  const translatorRef = useRef(t);
  useLayoutEffect(() => { translatorRef.current = t; }, [t]);
  const [value] = useState<FeedbackCopyContextValue>(() => ({
      getReplyErrorCopy: (key) => {
        switch (key) {
          case "required": return translatorRef.current("reply.errors.required");
          case "invalid": return translatorRef.current("reply.errors.invalid");
          case "notFound": return translatorRef.current("reply.errors.notFound");
          case "failed": return translatorRef.current("reply.errors.failed");
        }
      },
      getTestErrorCopy: () => translatorRef.current("test.errors.failed"),
      getReplyDeliveryCopy: (combination) => {
        if (!combination) return translatorRef.current("reply.savedNoDelivery");
        switch (combination) {
          case "app": return translatorRef.current("reply.sent_app");
          case "telegram": return translatorRef.current("reply.sent_telegram");
          case "email": return translatorRef.current("reply.sent_email");
          case "app_telegram": return translatorRef.current("reply.sent_app_telegram");
          case "app_email": return translatorRef.current("reply.sent_app_email");
          case "telegram_email": return translatorRef.current("reply.sent_telegram_email");
          case "all": return translatorRef.current("reply.sent_all");
        }
      },
      getTestTelegramCopy: (sent, count) => sent
        ? translatorRef.current("test.telegramSent", { count })
        : translatorRef.current("test.telegramNotSent"),
      getTestEmailCopy: (configured, sent) => !configured
        ? translatorRef.current("test.emailNotConfiguredResult")
        : sent
          ? translatorRef.current("test.emailSent")
          : translatorRef.current("test.emailFailed"),
      getTestResultCopy: (telegram, email) => translatorRef.current("test.result", { telegram, email }),
    }));
  return <FeedbackCopyContext.Provider value={value}>{children}</FeedbackCopyContext.Provider>;
}

export function useFeedbackCopy(): FeedbackCopyContextValue {
  const value = useContext(FeedbackCopyContext);
  if (!value) throw new Error("FeedbackCopyProvider is required");
  return value;
}
