"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Bug, ImageOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AttachButton,
  AttachmentChips,
  useAttachmentUploads,
} from "@/components/support/attachment-composer";
import { feedbackFailure } from "@/lib/feedback-copy";
import {
  BUG_REPORT_IGNORE_ATTR,
  capturePageScreenshot,
} from "@/lib/page-screenshot";
import { useIsNarrowViewport } from "@/lib/use-narrow-viewport";

/**
 * «Сообщить о проблеме» — ярлык с жуком у правого края окна.
 *
 * Нажатие сначала снимает скриншот (ярлык в него не попадает), потом
 * открывает форму: на компьютере окно, на телефоне лист снизу. Скриншот
 * загружается сразу, как обычное вложение поддержки, и стоит в форме
 * закреплённым превью — человек может его убрать, добавить свои файлы и
 * описать проблему. Уходит в `/api/feedback` с типом «ошибка»: админу
 * письмо и Telegram со скриншотом, автору — письмо с номером тикета.
 *
 * Портал в `document.body` обязателен: полотно дашборда обёрнуто в блок
 * с `translate: -50%`, и `position: fixed` внутри считался бы от него.
 */

type Screenshot = { filename: string; previewUrl: string };

export function BugReportLauncher() {
  const t = useTranslations("bugReport");
  const feedbackT = useTranslations("feedbackDialog");
  const common = useTranslations("common");
  const narrow = useIsNarrowViewport();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const uploads = useAttachmentUploads();
  const { addFiles, remove } = uploads;
  const previewRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

  const shotUpload = screenshot
    ? uploads.uploads.find((u) => u.filename === screenshot.filename)
    : undefined;
  const otherUploads = uploads.uploads.filter((u) => u !== shotUpload);

  const dropScreenshot = useCallback(() => {
    if (shotUpload) remove(shotUpload.key);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setScreenshot(null);
  }, [remove, shotUpload]);

  // Загрузка скриншота не удалась (лимит, сеть) — хук уже убрал его из
  // вложений и показал ошибку. Превью убираем тоже, иначе человек думал
  // бы, что скриншот уйдёт с обращением.
  const shotLost = screenshot !== null && shotUpload === undefined;
  useEffect(() => {
    if (!shotLost) return;
    dropScreenshot();
    setCaptureFailed(true);
  }, [shotLost, dropScreenshot]);

  async function start() {
    if (capturing) return;
    setCapturing(true);
    // Старый скриншот неактуален — страница могла поменяться. Текст и
    // свои файлы человека оставляем: он мог закрыть окно случайно.
    dropScreenshot();
    let file: File | null = null;
    try {
      file = await capturePageScreenshot();
    } catch (error) {
      console.error("[bug-report] screenshot failed:", error);
    }
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      previewRef.current = previewUrl;
      setScreenshot({ filename: file.name, previewUrl });
      addFiles([file]);
    }
    setCaptureFailed(!file);
    setCapturing(false);
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (text.length < 3) {
      toast.error(t("messageRequired"));
      return;
    }
    if (uploads.uploading) {
      toast.error(t("uploading"));
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "bug",
          message: text,
          attachments: uploads.readyAttachments,
          pageUrl: window.location.href,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const copy = feedbackFailure(data);
        if (copy.key === "messageTooShort") toast.error(feedbackT(copy.key, { min: copy.min }));
        else if (copy.key === "messageTooLong" || copy.key === "phoneTooLong") toast.error(feedbackT(copy.key, { max: copy.max }));
        else toast.error(feedbackT(copy.key));
        return;
      }
      const ticket = typeof data?.ticket === "string" ? data.ticket : "";
      toast.success(
        data?.emailed ? t("success", { ticket }) : t("successNoEmail", { ticket })
      );
      dropScreenshot();
      uploads.clear();
      setMessage("");
      setOpen(false);
    } catch {
      toast.error(feedbackT("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted) return null;

  const body = (
    <div className="space-y-4 px-1 py-2 sm:px-0 sm:py-0">
      {screenshot ? (
        <div className="relative overflow-hidden rounded-2xl border border-[#ececf4] bg-[#f5f6ff]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshot.previewUrl}
            alt={t("screenshotLabel")}
            className="block max-h-44 w-full object-cover object-top"
          />
          <div className="flex items-center justify-between gap-2 border-t border-[#ececf4] bg-white px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#3848c7]">
              {shotUpload?.status === "uploading" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {t("screenshotLabel")}
            </span>
            <button
              type="button"
              onClick={dropScreenshot}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            >
              <X className="size-3.5" />
              {t("removeScreenshot")}
            </button>
          </div>
        </div>
      ) : captureFailed ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-3 py-3 text-[13px] text-[#6f7282]">
          <ImageOff className="size-4 shrink-0" />
          {t("screenshotFailed")}
        </div>
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="bug-report-message"
          className="text-[14px] font-semibold text-[#0b1024]"
        >
          {t("messageLabel")}
        </label>
        <Textarea
          id="bug-report-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onPaste={uploads.handlePaste}
          placeholder={t("messagePlaceholder")}
          rows={4}
          maxLength={4000}
          // 16px на телефоне: iOS Safari зумит страницу при фокусе в поле
          // с меньшим шрифтом.
          className="resize-none rounded-xl border-[#e2e5ef] bg-white text-[16px] placeholder:text-[#9b9fb3] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:text-[14px]"
        />
      </div>

      <div>
        <AttachmentChips uploads={otherUploads} onRemove={remove} />
        <div className="flex items-center gap-3">
          <AttachButton onFiles={addFiles} disabled={submitting} />
          <span className="text-[12.5px] leading-snug text-[#6f7282]">
            {t("attachHint")}
          </span>
        </div>
      </div>
    </div>
  );

  const submitButton = (
    <Button
      type="submit"
      form="bug-report-form"
      disabled={submitting || uploads.uploading || message.trim().length < 3}
      className="h-11 w-full rounded-xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:w-auto sm:min-w-[140px]"
    >
      {submitting
        ? t("submitting")
        : uploads.uploading
          ? t("uploading")
          : t("submit")}
    </Button>
  );

  const form = (
    <form id="bug-report-form" onSubmit={submit}>
      {body}
    </form>
  );

  return createPortal(
    <>
      <button
        type="button"
        {...{ [BUG_REPORT_IGNORE_ATTR]: "" }}
        onClick={start}
        disabled={capturing}
        aria-label={t("trigger")}
        title={t("trigger")}
        className="group fixed right-0 top-[58%] z-30 flex h-10 items-center gap-2 rounded-l-xl border border-r-0 border-[#ececf4] bg-white pl-2 pr-1.5 text-[#5566f6] shadow-[0_10px_24px_-12px_rgba(11,16,36,0.35)] transition-all hover:pl-3 hover:text-[#3848c7] disabled:cursor-wait print:hidden sm:h-11 sm:pl-2.5"
      >
        {capturing ? (
          <Loader2 className="size-4 animate-spin sm:size-5" />
        ) : (
          <Bug className="size-4 sm:size-5" />
        )}
        <span className="sr-only">{t("trigger")}</span>
        {capturing ? (
          <span className="hidden text-[12.5px] font-medium sm:inline">
            {t("capturing")}
          </span>
        ) : null}
      </button>

      {narrow ? (
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title={t("title")}
          subtitle={t("description")}
          footer={submitButton}
        >
          {form}
        </BottomSheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            closeLabel={common("close")}
            className="flex max-h-[88vh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 supports-[height:100dvh]:max-h-[88dvh] sm:max-w-[520px]"
          >
            <DialogHeader className="shrink-0 border-b py-5 pl-6 pr-14">
              <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold text-[#0b1024]">
                <Bug className="size-5 text-[#5566f6]" />
                {t("title")}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-[#6f7282]">
                {t("description")}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
              {form}
            </div>
            <div className="flex shrink-0 justify-end border-t bg-white px-6 py-4">
              {submitButton}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>,
    document.body
  );
}
