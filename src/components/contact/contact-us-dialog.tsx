"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Mail, MessageCircle, Phone, Send } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_TELEGRAM_FALLBACK } from "@/lib/contact-us";
import { contactSupport } from "@/lib/support-chat-bus";
import { cn } from "@/lib/utils";

/**
 * «Свяжитесь с нами» вместо цены услуги (владелец, 2026-10-29): по клику —
 * окно с крупными контактами. Одно окно на сайт, кабинет и Mini App (П-3):
 * на телефоне `ui/dialog` выезжает листом снизу во всю ширину.
 *
 * Самое крупное — телефон: это то, ради чего окно открыли. Ниже — Telegram,
 * почта и чат на сайте с темой про услугу.
 */

type ContactUsTarget = {
  /** Название услуги — подпись в окне и тема письма или чата. */
  service?: string | null;
  /** Telegram отдела продаж: `contactTelegramUrl(process.env)` с сервера. */
  telegramUrl?: string | null;
};

/** Время на закрытие окна, прежде чем открыть чат поддержки. */
const CHAT_AFTER_CLOSE_MS = 200;

const ROW_CLASS =
  "group flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3 text-left transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

function ContactRow({
  icon,
  label,
  hint,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[16px] font-semibold leading-tight text-[#0b1024]">{label}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[#6f7282]">{hint}</span>
      </span>
      <ArrowUpRight
        className="size-4 shrink-0 text-[#9b9fb3] transition-colors duration-150 group-hover:text-[#5566f6]"
        aria-hidden
      />
    </>
  );
}

/** Содержимое окна: крупный телефон, Telegram, почта, чат. */
export function ContactUsPanel({
  service = null,
  telegramUrl = null,
  onBeforeChat,
  className,
}: ContactUsTarget & {
  /** Закрыть окно, в котором лежит панель, до открытия чата. */
  onBeforeChat?: () => void;
  className?: string;
}) {
  const t = useTranslations("sharedUi.contactUs");
  const subject = service ? t("subjectService", { service }) : t("subjectGeneral");
  const telegram = telegramUrl || CONTACT_TELEGRAM_FALLBACK;

  const openChat = () => {
    if (!onBeforeChat) {
      contactSupport(subject);
      return;
    }
    onBeforeChat();
    window.setTimeout(() => contactSupport(subject), CHAT_AFTER_CLOSE_MS);
  };

  return (
    <div className={cn("space-y-2.5", className)} data-contact-us-panel>
      <a
        href={`tel:${CONTACT_PHONE.tel}`}
        data-contact-phone
        className="flex items-center gap-4 rounded-3xl bg-[#5566f6] px-5 py-4 text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <Phone className="size-6" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-white/80">{t("call")}</span>
          <span className="block whitespace-nowrap text-[24px] font-semibold leading-tight tracking-[-0.02em] tabular-nums sm:text-[28px]">
            {CONTACT_PHONE.display}
          </span>
        </span>
      </a>

      <a href={telegram} target="_blank" rel="noopener noreferrer" className={ROW_CLASS} data-contact-telegram>
        <ContactRow icon={<Send className="size-5" aria-hidden />} label={t("telegram")} hint={t("telegramHint")} />
      </a>

      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`}
        className={ROW_CLASS}
        data-contact-email
      >
        <ContactRow icon={<Mail className="size-5" aria-hidden />} label={CONTACT_EMAIL} hint={t("emailHint")} />
      </a>

      <button type="button" onClick={openChat} className={ROW_CLASS} data-contact-chat>
        <ContactRow icon={<MessageCircle className="size-5" aria-hidden />} label={t("chat")} hint={t("chatHint")} />
      </button>
    </div>
  );
}

/** Управляемое окно «Свяжитесь с нами». */
export function ContactUsDialog({
  open,
  onOpenChange,
  service = null,
  telegramUrl = null,
}: ContactUsTarget & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("sharedUi.contactUs");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-3xl border-[#ececf4] bg-white text-[#0b1024] sm:max-w-[440px]" data-contact-us-dialog>
        <DialogHeader className="text-left">
          <DialogTitle className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{t("title")}</DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.55] text-[#3c4053]">{t("lead")}</DialogDescription>
          {service ? (
            <span className="inline-flex w-fit max-w-full rounded-xl bg-[#f5f6ff] px-3 py-1.5 text-[12.5px] font-medium leading-snug text-[#3848c7]">
              {t("about", { service })}
            </span>
          ) : null}
        </DialogHeader>
        <ContactUsPanel service={service} telegramUrl={telegramUrl} onBeforeChat={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const BUTTON_VARIANTS = {
  /** Мягкая индиго — на месте цены в карточке. */
  soft: "h-11 rounded-2xl bg-[#eef1ff] px-4 text-[14px] font-medium text-[#3848c7] hover:bg-[#e2e7ff] focus-visible:ring-[#5566f6]/15",
  /** Контурная — рядом с основной кнопкой. */
  outline:
    "h-11 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:ring-[#5566f6]/15",
  /** На тёмном hero публичной страницы. */
  onDark:
    "h-12 rounded-2xl border border-white/20 bg-white/10 px-5 text-[15px] font-medium text-white hover:bg-white/20 focus-visible:ring-white/25",
  /** Ссылка-текст — в клетке таблицы. */
  link: "min-h-8 rounded-lg text-left font-medium text-[#3848c7] underline decoration-[#5566f6]/30 underline-offset-4 hover:text-[#5566f6] hover:decoration-[#5566f6] focus-visible:ring-[#5566f6]/15",
} as const;

type TriggerProps = {
  variant?: keyof typeof BUTTON_VARIANTS;
  icon?: boolean;
  className?: string;
  testId?: string;
  children?: ReactNode;
};

/**
 * Только кнопка — когда одно окно открывают несколько кнопок (витрина
 * тарифов: блок ППК и клетки таблицы).
 */
export function ContactUsTrigger({
  onClick,
  variant = "soft",
  icon = true,
  className,
  testId,
  children,
}: TriggerProps & { onClick: () => void }) {
  const t = useTranslations("sharedUi.contactUs");
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-contact-us-trigger
      aria-haspopup="dialog"
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {icon ? <Phone className="size-4 shrink-0" aria-hidden /> : null}
      {children ?? t("cta")}
    </button>
  );
}

/** Кнопка «Свяжитесь с нами» со своим окном. */
export function ContactUsButton({ service = null, telegramUrl = null, ...trigger }: ContactUsTarget & TriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ContactUsTrigger {...trigger} onClick={() => setOpen(true)} />
      <ContactUsDialog open={open} onOpenChange={setOpen} service={service} telegramUrl={telegramUrl} />
    </>
  );
}
