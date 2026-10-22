"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useFeedbackCopy } from "./feedback-copy-provider";

/**
 * «Проверить уведомления» — владелец жмёт кнопку и своими глазами видит,
 * в какой Telegram и на какую почту приходят служебные сообщения
 * платформы. До этого он мог только гадать, чей chat id прописан в env.
 */
export function TestNotifyButton({
  chatIdsMasked,
  emailMasked,
}: {
  chatIdsMasked: string[];
  emailMasked: string | null;
}) {
  const [sending, setSending] = useState(false);
  const t = useTranslations("rootFeedbackReports");
  const copy = useFeedbackCopy();

  async function run() {
    setSending(true);
    try {
      const response = await fetch("/api/root/feedback/test-notify", {
        method: "POST",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "");
      }

      const telegram = copy.getTestTelegramCopy(Boolean(data?.telegram), String(data?.telegramChats));
      const email = copy.getTestEmailCopy(Boolean(data?.emailConfigured), Boolean(data?.email));
      const message = copy.getTestResultCopy(telegram, email);
      if (data?.telegram || data?.email) {
        toast.success(message);
      } else {
        toast.error(message);
      }
    } catch (_error) {
      toast.error(copy.getTestErrorCopy());
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={run}
        disabled={sending}
        className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60"
      >
        <BellRing className="size-4" />
        {sending ? t("test.sending") : t("test.button")}
      </button>
      <p className="text-[12px] text-[#6f7282]">
        {chatIdsMasked.length > 0
          ? t("test.telegramChats", { destination: chatIdsMasked.join(", ") })
          : t("test.telegramNotConfigured")}
        {" · "}
        {emailMasked ? t("test.emailConfigured", { destination: emailMasked }) : t("test.emailNotConfigured")}
      </p>
    </div>
  );
}
