"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, Loader2, Video } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEMO_WHEN, hasEnoughPhoneDigits, type DemoWhen } from "@/lib/demo-request";
import { phoneInputProps } from "@/lib/phone-input";
import { readSignupSource, rememberSignupSource, ymGoal } from "@/lib/signup-source";
import { cn } from "@/lib/utils";

/**
 * «Покажите мне за 15 минут» (2026-11-01): кнопка и окно с короткой формой.
 * Сетям и производствам проще посмотреть сервис вместе с человеком, чем
 * регистрироваться самим, — поэтому рядом с «Начать бесплатно» стоит этот
 * второй путь. Заявка уходит в `/api/demo-request`: админ получает сигнал
 * «позвоните в течение часа».
 *
 * Ошибки — инлайном у кнопки: на публичных страницах тостера нет.
 */

const TRIGGER_VARIANTS = {
  /** Контурная — рядом с основной кнопкой на светлом фоне. */
  outline:
    "h-12 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:ring-[#5566f6]/15",
  /** На тёмном hero и тёмной плашке. */
  onDark:
    "h-12 rounded-2xl border border-white/20 bg-white/10 px-5 text-[15px] font-medium text-white hover:bg-white/20 focus-visible:ring-white/25",
  /** Текстовая ссылка под формой регистрации. */
  link: "min-h-10 rounded-lg px-1 text-[15px] font-medium text-[#3848c7] underline decoration-[#5566f6]/30 underline-offset-4 hover:text-[#5566f6] hover:decoration-[#5566f6] focus-visible:ring-[#5566f6]/15",
} as const;

const INPUT_CLASS =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

const LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-[#6f7282]";

type Status = "idle" | "sending" | "done";

export function DemoRequestButton({
  place,
  variant = "outline",
  className,
  children,
}: {
  /** Где стоит кнопка — для Метрики и уведомления: pricing, niche:cafe, home… */
  place: string;
  variant?: keyof typeof TRIGGER_VARIANTS;
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("publicUi.demoRequest");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-demo-request={place}
        className={cn(
          "inline-flex items-center justify-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4",
          TRIGGER_VARIANTS[variant],
          className,
        )}
      >
        {variant === "link" ? null : <Video className="size-4 shrink-0" aria-hidden />}
        {children ?? t("trigger")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-4 rounded-3xl border-[#ececf4] bg-white text-[#0b1024] sm:max-w-[460px]" data-demo-request-dialog>
          <DemoRequestForm place={place} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DemoRequestForm({ place, onClose }: { place: string; onClose: () => void }) {
  const t = useTranslations("publicUi.demoRequest");
  const ids = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [when, setWhen] = useState<DemoWhen>("today");
  const [topic, setTopic] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const sending = status === "sending";

  // Первое касание вкладки — источник визита для заявки и регистрации.
  useEffect(() => {
    rememberSignupSource();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (name.trim().length < 2) return setError(t("errorName"));
    if (!hasEnoughPhoneDigits(phone)) return setError(t("errorPhone"));
    if (!consent) return setError(t("errorConsent"));
    setError(null);
    setStatus("sending");
    try {
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          when,
          topic: topic.trim() || undefined,
          place,
          consent,
          website,
          source: readSignupSource(place),
        }),
      });
      if (!response.ok) {
        setStatus("idle");
        setError(response.status === 429 ? t("errorTooMany") : t("errorGeneric"));
        return;
      }
      ymGoal("demo_request", { place });
      setStatus("done");
    } catch {
      setStatus("idle");
      setError(t("errorGeneric"));
    }
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-start gap-4" data-demo-request-done>
        <span className="flex size-12 items-center justify-center rounded-2xl bg-[#ecfdf5] text-[#136b2a]">
          <Check className="size-6" aria-hidden />
        </span>
        <DialogHeader className="text-left">
          <DialogTitle className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{t("doneTitle")}</DialogTitle>
          <DialogDescription className="text-[15px] leading-[1.55] text-[#3c4053]">{t("doneBody", { phone: phone.trim() })}</DialogDescription>
        </DialogHeader>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25"
        >
          {t("close")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <DialogHeader className="text-left">
        {/* Справа — место под крестик окна: длинный заголовок не должен под него заезжать. */}
        <DialogTitle className="pr-10 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{t("title")}</DialogTitle>
        <DialogDescription className="text-[14px] leading-[1.55] text-[#3c4053]">{t("description")}</DialogDescription>
      </DialogHeader>

      <div>
        <label htmlFor={`${ids}-name`} className={LABEL_CLASS}>{t("name")}</label>
        <input
          id={`${ids}-name`}
          className={INPUT_CLASS}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("namePlaceholder")}
          autoComplete="name"
          maxLength={120}
        />
      </div>

      <div>
        <label htmlFor={`${ids}-phone`} className={LABEL_CLASS}>{t("phone")}</label>
        <input id={`${ids}-phone`} className={INPUT_CLASS} placeholder="+7 (900) 000-00-00" maxLength={32} {...phoneInputProps(phone, setPhone)} />
      </div>

      <fieldset>
        <legend className={LABEL_CLASS}>{t("when")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {DEMO_WHEN.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center rounded-2xl border px-2 text-center text-[14px] font-medium leading-tight transition-colors duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#5566f6]/15",
                when === option
                  ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                  : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
              )}
            >
              <input type="radio" name={`${ids}-when`} value={option} checked={when === option} onChange={() => setWhen(option)} className="sr-only" />
              {t(`when_${option}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${ids}-topic`} className={LABEL_CLASS}>
          {t("topic")} <span className="font-normal text-[#9b9fb3]">· {t("optional")}</span>
        </label>
        <textarea
          id={`${ids}-topic`}
          className={cn(INPUT_CLASS, "h-auto min-h-[76px] resize-none py-3 leading-[1.45]")}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={t("topicPlaceholder")}
          maxLength={500}
          rows={2}
        />
      </div>

      {/* Ловушка для ботов: человек это поле не видит и не заполняет. */}
      <div aria-hidden className="absolute -left-[10000px] top-auto size-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </label>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-[1.5] text-[#6f7282]">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-[18px] shrink-0 accent-[#5566f6]"
          data-demo-request-consent
        />
        <span>
          {t.rich("consent", {
            consent: (chunks) => <Link href="/consent" target="_blank" className="text-[#3848c7] underline underline-offset-2 hover:text-[#0b1024]">{chunks}</Link>,
            privacy: (chunks) => <Link href="/privacy" target="_blank" className="text-[#3848c7] underline underline-offset-2 hover:text-[#0b1024]">{chunks}</Link>,
          })}
        </span>
      </label>

      {error ? (
        <p role="alert" className="rounded-2xl bg-[#fff4f2] px-4 py-2.5 text-[13.5px] leading-[1.45] text-[#a13a32]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={sending}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[16px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:opacity-70"
      >
        {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {sending ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
