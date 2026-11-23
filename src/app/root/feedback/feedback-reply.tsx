"use client";

import { useState } from "react";
import { Link2, MessageSquareReply } from "lucide-react";
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
import {
  AttachButton,
  AttachmentChips,
  useAttachmentUploads,
} from "@/components/support/attachment-composer";
import type { SupportAttachmentMeta } from "@/lib/support-attachments-shared";
import { useTranslations } from "next-intl";
import { useFeedbackCopy } from "./feedback-copy-provider";
import { deliveredReplyCombination, feedbackReplyErrorKey, replyChannelCombination } from "./feedback-report-presentation";
import { formatRootAttachmentBytes, getRootUploadFailureContent } from "./attachment-presentation";

/** Что показать в окне ответа: кому и на что отвечаем (владелец, 2026-11-23). */
export type FeedbackReplyContext = {
  ticket: string;
  typeLabel: string;
  dateLabel: string;
  message: string;
  attachments: SupportAttachmentMeta[];
  pageUrl: string | null;
  /** «Анна · anna@mail.ru · +7… · Кафе Ромашка». */
  who: string;
};

/** Куда ответ уйдёт — говорим до отправки, а не «куда-то в базу». */
export function FeedbackReply({
  reportId,
  hasRecipient,
  hasTelegram,
  hasEmail,
  context,
}: {
  reportId: string;
  hasRecipient: boolean;
  hasTelegram: boolean;
  hasEmail: boolean;
  context: FeedbackReplyContext;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const t = useTranslations("rootFeedbackReports");
  const copy = useFeedbackCopy();
  const files = useAttachmentUploads({ getUploadFailureContent: getRootUploadFailureContent });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() && files.readyAttachments.length === 0) return;
    if (files.uploading) {
      toast.error(t("reply.waitForUploads"));
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/root/feedback/${reportId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, attachments: files.readyAttachments }),
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
      files.clear();
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
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[600px]" closeLabel={t("reply.close")}>
        <DialogHeader>
          <DialogTitle>{t("reply.title")}</DialogTitle>
          <DialogDescription>
            {t(`reply.channels_${replyChannelCombination(hasRecipient, hasTelegram, hasEmail)}`)}
          </DialogDescription>
        </DialogHeader>
        {/* Кому и на что: адресат и само обращение — над полем ответа. */}
        <div className="space-y-2" data-reply-context>
          <div className="text-[13px] text-[#3c4053]" data-reply-to>
            <span className="font-medium text-[#6f7282]">{t("reply.to")}: </span>
            {context.who || t("reply.noContact")}
          </div>
          <div className="rounded-xl border-l-2 border-[#5566f6]/60 bg-[var(--app-veil)] px-3 py-2" data-reply-quote>
            <div className="text-[11.5px] font-medium text-[#6f7282]">
              {t("reply.requestHeading", { ticket: context.ticket, type: context.typeLabel, date: context.dateLabel })}
            </div>
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[13.5px] leading-[1.5] text-[#0b1024]">
              {context.message}
            </p>
            {context.attachments.map((attachment, index) => (
              <a
                key={index}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-[12.5px] text-[#3848c7] underline-offset-2 hover:underline"
              >
                📎 {attachment.filename}
              </a>
            ))}
            {context.pageUrl ? (
              <a
                href={context.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex min-w-0 items-center gap-1 break-all text-[12px] text-[#6f7282] hover:text-[#5566f6]"
              >
                <Link2 className="size-3 shrink-0" />
                {context.pageUrl.replace(/^https?:\/\/[^/]+/, "")}
              </a>
            ) : null}
          </div>
        </div>
        <form
          onSubmit={submit}
          className={`space-y-3 rounded-xl transition-shadow ${dragging ? "ring-2 ring-[#5566f6]/40" : ""}`}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            setDragging(false);
            files.addFiles(event.dataTransfer.files);
          }}
        >
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onPaste={files.handlePaste}
            placeholder={t("reply.textarea")}
            rows={6}
            maxLength={5000}
            autoFocus
          />
          <AttachmentChips uploads={files.uploads} onRemove={files.remove} formatSizeBytes={formatRootAttachmentBytes} />
          <div className="flex items-center gap-2">
            <AttachButton onFiles={files.addFiles} disabled={submitting} />
            <p className="text-[12px] leading-snug text-[#6f7282]">{t("reply.attachHint")}</p>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={submitting || files.uploading || (!message.trim() && files.readyAttachments.length === 0)}
            >
              {submitting ? t("reply.sending") : t("reply.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
