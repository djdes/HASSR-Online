"use client";
import { phoneInputProps } from "@/lib/phone-input";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { feedbackFailure } from "@/lib/feedback-copy";
import { MessageCircleMore } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FeedbackType = "bug" | "suggestion";

type FeedbackDialogProps = {
  telegramBotUsername: string;
  triggerClassName?: string;
  /**
   * Свой триггер вместо кнопки шапки. Нужен там, где форма живёт не в
   * правом кластере хедера, а карточкой в списке — например на
   * `/mini/me`: там иконко-кнопка 40×40 с подписью, скрытой до `sm`,
   * выглядела бы безымянным квадратом.
   */
  trigger?: React.ReactNode;
};

export function FeedbackDialog({
  telegramBotUsername,
  triggerClassName,
  trigger,
}: FeedbackDialogProps) {
  const t = useTranslations("feedbackDialog");
  const common = useTranslations("common");
  const latestT = useRef(t);
  useEffect(() => { latestT.current = t; }, [t]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType | "">("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const botUrl = telegramBotUsername
    ? `https://t.me/${telegramBotUsername.replace(/^@/, "")}`
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) {
      toast.error(t("typeRequired"));
      return;
    }
    if (message.trim().length < 3) {
      toast.error(t("messageRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message: message.trim(), phone: phone.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const copy = feedbackFailure(data);
        const currentT = latestT.current;
        if (copy.key === "messageTooShort") toast.error(currentT(copy.key, { min: copy.min }));
        else if (copy.key === "messageTooLong" || copy.key === "phoneTooLong") toast.error(currentT(copy.key, { max: copy.max }));
        else toast.error(currentT(copy.key));
        return;
      }
      toast.success(latestT.current("success", { days: 5 }));
      setOpen(false);
      setType("");
      setMessage("");
      setPhone("");
    } catch {
      toast.error(latestT.current("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            aria-label={t("trigger")}
            className={cn(
              // Единственный primary-контрол в правом кластере шапки:
              // та же геометрия (h-10 / rounded-lg / size-5 иконка), что и у
              // tinted-кнопок рядом, но со сплошной индиго-заливкой.
              "h-10 w-10 shrink-0 gap-2 rounded-lg bg-[#5566f6] px-3.5 text-[14px] font-semibold text-white shadow-[0_8px_20px_-12px_rgba(85,102,246,0.6)] transition-colors duration-200 hover:bg-[#4a5bf0]",
              // До sm подпись скрыта — тогда кнопка должна быть квадратом
              // 40×40, как остальные иконко-кнопки шапки.
              "max-sm:px-0 sm:w-auto",
              triggerClassName
            )}
          >
            <MessageCircleMore className="size-5" />
            <span className="hidden sm:inline">{t("trigger")}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={common("close")} className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[520px]">
        <DialogHeader className="shrink-0 border-b py-5 pl-6 pr-14">
          <DialogTitle className="text-[18px] font-semibold text-[#0b1024]">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-6">
          <div className="space-y-4 text-[14px] leading-[1.55] text-[#3c4053]">
            <p>
              {t("intro")}
            </p>
            <p className="italic">
              {t.rich("responseTime", {
                days: 5,
                b: (chunks) => <b className="font-semibold not-italic">{chunks}</b>,
              })}{" "}
              {botUrl ? (
                <a
                  href={botUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-[#5566f6] underline-offset-2 hover:underline"
                >
                  {botUrl}
                </a>
              ) : null}
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-[15px] font-semibold text-[#0b1024]">
              {t("chooseType")}
            </div>
            <div className="flex flex-wrap gap-6">
              <RadioOption
                name="feedback-type"
                value="bug"
                label={t("bug")}
                checked={type === "bug"}
                onChange={() => setType("bug")}
              />
              <RadioOption
                name="feedback-type"
                value="suggestion"
                label={t("suggestion")}
                checked={type === "suggestion"}
                onChange={() => setType("suggestion")}
              />
            </div>
          </div>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("messagePlaceholder")}
            aria-label={t("messagePlaceholder")}
            required
            rows={5}
            // На мобиле 16px: iOS Safari зумит страницу при фокусе в поле
            // со шрифтом меньше 16px. На десктопе оставляем прежние 14px.
            className="resize-none rounded-xl border-[#e2e5ef] bg-white text-[16px] placeholder:text-[#9b9fb3] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:text-[14px]"
          />

          <Input
            {...phoneInputProps(phone, setPhone)}
            placeholder={t("phonePlaceholder")}
            aria-label={t("phonePlaceholder")}
            type="tel"
            inputMode="tel"
            // Те же 16px на мобиле, что и у поля выше — иначе телефон
            // «прыгает» в зум ровно на этом поле.
            className="h-11 rounded-xl border-[#e2e5ef] bg-white text-[16px] placeholder:text-[#9b9fb3] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:text-[14px]"
          />

          </div>

          <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t bg-white px-6 py-4">
            <Button
              type="submit"
              disabled={submitting}
              className="h-11 min-w-[140px] rounded-xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RadioOption({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <span className="relative inline-flex size-5 items-center justify-center">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          className="peer size-5 appearance-none rounded-full border-2 border-[#d0d4e6] bg-white outline-none transition-colors checked:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 m-auto size-2.5 rounded-full bg-[#5566f6] transition-opacity",
            checked ? "opacity-100" : "opacity-0"
          )}
        />
      </span>
      <span className="text-[14px] text-[#0b1024]">{label}</span>
    </label>
  );
}
