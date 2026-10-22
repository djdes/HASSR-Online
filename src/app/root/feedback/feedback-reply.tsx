"use client";

import { useState } from "react";
import { MessageSquareReply } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useFeedbackCopy } from "./feedback-copy-provider";
import { deliveredReplyCombination, feedbackReplyErrorKey, replyChannelCombination } from "./feedback-report-presentation";

/** Куда ответ уйдёт — говорим до отправки, а не «куда-то в базу». */
export function FeedbackReply({
  reportId,
  hasRecipient,
  hasTelegram,
  hasEmail,
}: {
  reportId: string;
  hasRecipient: boolean;
  hasTelegram: boolean;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const t = useTranslations("rootFeedbackReports");
  const copy = useFeedbackCopy();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/root/feedback/${reportId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "");

      // Показываем только реально сработавшие каналы: иначе «отправлено»
      // означало бы всего лишь «записано в базу», как было раньше.
      const delivery = deliveredReplyCombination(
        Boolean(data?.channels?.inApp), Boolean(data?.channels?.telegram), Boolean(data?.channels?.email),
      );
      if (delivery) {
        toast.success(copy.getReplyDeliveryCopy(delivery));
      } else {
        toast.warning(copy.getReplyDeliveryCopy(null));
      }
      setOpen(false);
      setMessage("");
      router.refresh();
    } catch (_error) {
      toast.error(copy.getReplyErrorCopy(feedbackReplyErrorKey(_error instanceof Error ? _error.message : null)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg text-[12px]">
          <MessageSquareReply className="size-3.5" />
          {t("reply.button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]" closeLabel={t("reply.close")}>
        <DialogHeader>
          <DialogTitle>{t("reply.title")}</DialogTitle>
          <DialogDescription>
            {t(`reply.channels_${replyChannelCombination(hasRecipient, hasTelegram, hasEmail)}`)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("reply.textarea")} rows={6} maxLength={5000} required />
          <DialogFooter>
            <Button type="submit" disabled={submitting}>{submitting ? t("reply.sending") : t("reply.send")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
