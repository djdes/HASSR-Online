"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, GraduationCap, LifeBuoy, Mail, MessageCircle, MessagesSquare, Phone, Send } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONTACT_EMAIL, CONTACT_MOBILE, CONTACT_PHONE, CONTACT_TELEGRAM, contactMaxUrl } from "@/lib/contact-us";
import { contactSupport } from "@/lib/support-chat-bus";
import { COMPANY_MAX_URL } from "@/lib/company-contacts";
import { cn } from "@/lib/utils";

/**
 * «Свяжитесь с нами» вместо цены услуги (владелец, 2026-10-29): по клику —
 * окно с крупными контактами. Одно окно на сайт, кабинет и Mini App (П-3):
 * на телефоне `ui/dialog` выезжает листом снизу во всю ширину.
 *
 * С 2026-11-09 контакты разложены по вкладкам «Поддержка / Отдел продаж /
 * Консалтинг» (`ContactUsPanel`): телефоны — только у продаж.
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
/** Узкая колонка главной: строки пониже. */
const ROW_CLASS_COMPACT =
  "group flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-3 py-2.5 text-left transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Узкая колонка (главная кабинета): строки компактнее, без стрелки. */
const CompactRows = createContext(false);

function ContactRow({
  icon,
  label,
  hint,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  const compact = useContext(CompactRows);
  if (compact) {
    // Адрес или номер — одной строкой: «@wesetup_support» не рвётся посередине.
    return (
      <>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7] [&_svg]:size-[18px]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold leading-tight text-[#0b1024]" title={label}>{label}</span>
          <span className="mt-0.5 block truncate text-[12.5px] leading-snug text-[#6f7282]" title={hint}>{hint}</span>
        </span>
      </>
    );
  }
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

/** Вкладки контактов: поддержка, отдел продаж, консалтинг (владелец, 2026-11-09). */
export type ContactGroup = "support" | "sales" | "consulting";
const GROUPS: readonly ContactGroup[] = ["support", "sales", "consulting"];
const GROUP_ICONS = { support: LifeBuoy, sales: Phone, consulting: GraduationCap } as const;

/**
 * Содержимое окна — три вкладки (владелец, 2026-11-09: «номера телефонов —
 * только отдел продаж; поддержка — Telegram, MAX, чат и почта»):
 *   • Поддержка — Telegram @wesetup_support, MAX, чат на сайте, почта;
 *   • Отдел продаж — основной телефон крупно, мобильный, Telegram продаж (если задан);
 *   • Консалтинг — эксперты (страница или Telegram консультанта), чат и почта с темой.
 * Открыта сразу: вопрос о цене услуги — продажи, иначе — поддержка.
 */
export function ContactUsPanel({
  service = null,
  telegramUrl = null,
  consultingUrl = null,
  consultingHref = "/uslugi",
  defaultGroup,
  compact = false,
  onBeforeChat,
  className,
}: ContactUsTarget & {
  /** Telegram консультанта (`WESETUP_TG_CONSULTING_URL`), если задан. */
  consultingUrl?: string | null;
  /** Страница консалтинга внутри сайта. */
  consultingHref?: string;
  defaultGroup?: ContactGroup;
  /** Узкая колонка (главная кабинета): телефон без крупной плашки. */
  compact?: boolean;
  /** Закрыть окно, в котором лежит панель, до открытия чата. */
  onBeforeChat?: () => void;
  className?: string;
}) {
  const t = useTranslations("sharedUi.contactUs");
  const [group, setGroup] = useState<ContactGroup>(defaultGroup ?? (service ? "sales" : "support"));
  const subject =
    group === "consulting" ? t("subjectConsulting") : service ? t("subjectService", { service }) : t("subjectGeneral");
  // Telegram продаж — только когда он отдельный, не поддержка.
  const salesTelegram = telegramUrl && telegramUrl !== CONTACT_TELEGRAM.url ? telegramUrl : null;
  // MAX поддержки: адрес из переменной сборки, иначе профиль «СЕТАП».
  const max = contactMaxUrl(process.env.NEXT_PUBLIC_WESETUP_MAX_URL) ?? COMPANY_MAX_URL;
  const rowClass = compact ? ROW_CLASS_COMPACT : ROW_CLASS;

  const openChat = () => {
    if (!onBeforeChat) {
      contactSupport(subject);
      return;
    }
    onBeforeChat();
    window.setTimeout(() => contactSupport(subject), CHAT_AFTER_CLOSE_MS);
  };

  const email = (
    <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`} className={rowClass} data-contact-email>
      <ContactRow icon={<Mail className="size-5" aria-hidden />} label={CONTACT_EMAIL} hint={t("emailHint")} />
    </a>
  );
  const chat = (
    <button type="button" onClick={openChat} className={rowClass} data-contact-chat>
      <ContactRow icon={<MessageCircle className="size-5" aria-hidden />} label={t("chat")} hint={t("chatHint")} />
    </button>
  );

  return (
    <CompactRows.Provider value={compact}>
    <div className={cn("space-y-3", className)} data-contact-us-panel>
      <div role="tablist" aria-label={t("groupsLabel")} className="grid grid-cols-3 gap-1 rounded-2xl bg-[#f5f6ff] p-1">
        {GROUPS.map((id) => {
          const Icon = GROUP_ICONS[id];
          const active = id === group;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setGroup(id)}
              data-contact-group={id}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1 py-1.5 text-center text-[12.5px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                active ? "bg-white text-[#3848c7] shadow-[0_4px_14px_-8px_rgba(85,102,246,0.55)]" : "text-[#6f7282] hover:bg-white/60 hover:text-[#0b1024]",
              )}
            >
              <Icon className={cn("size-4", active ? "text-[#5566f6]" : "text-[#9b9fb3]")} aria-hidden />
              {compact ? t(`groupsShort.${id}`) : t(`groups.${id}`)}
            </button>
          );
        })}
      </div>

      <p className={cn("px-1 leading-snug text-[#6f7282] newd:hidden", compact ? "text-[12.5px]" : "text-[13px]")}>{t(`groupLeads.${group}`)}</p>

      <div role="tabpanel" className="space-y-2.5" data-contact-group-panel={group}>
        {group === "support" ? (
          <>
            <a href={CONTACT_TELEGRAM.url} target="_blank" rel="noopener noreferrer" className={rowClass} data-contact-telegram>
              <ContactRow icon={<Send className="size-5" aria-hidden />} label={CONTACT_TELEGRAM.handle} hint={t("telegramHint")} />
            </a>
            {max ? (
              <a href={max} target="_blank" rel="noopener noreferrer" className={rowClass} data-contact-max>
                <ContactRow icon={<MessagesSquare className="size-5" aria-hidden />} label={t("max")} hint={t("maxHint")} />
              </a>
            ) : null}
            {chat}
            {email}
          </>
        ) : null}

        {group === "sales" ? (
          <>
            {compact ? (
              <a href={`tel:${CONTACT_PHONE.tel}`} className={rowClass} data-contact-phone>
                <ContactRow icon={<Phone className="size-5" aria-hidden />} label={CONTACT_PHONE.display} hint={t("call")} />
              </a>
            ) : (
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
            )}
            <a href={`tel:${CONTACT_MOBILE.tel}`} className={rowClass} data-contact-mobile>
              <ContactRow icon={<Phone className="size-5" aria-hidden />} label={CONTACT_MOBILE.display} hint={t("mobileHint")} />
            </a>
            {salesTelegram ? (
              <a href={salesTelegram} target="_blank" rel="noopener noreferrer" className={rowClass} data-contact-sales-telegram>
                <ContactRow icon={<Send className="size-5" aria-hidden />} label={t("telegram")} hint={t("salesTelegramHint")} />
              </a>
            ) : null}
          </>
        ) : null}

        {group === "consulting" ? (
          <>
            {consultingUrl ? (
              <a href={consultingUrl} target="_blank" rel="noopener noreferrer" className={rowClass} data-contact-consulting-telegram>
                <ContactRow icon={<Send className="size-5" aria-hidden />} label={t("telegram")} hint={t("consultingTelegramHint")} />
              </a>
            ) : null}
            <Link href={consultingHref} className={rowClass} data-contact-consulting>
              <ContactRow icon={<GraduationCap className="size-5" aria-hidden />} label={t("consulting")} hint={t("consultingHint")} />
            </Link>
            {chat}
            {email}
          </>
        ) : null}
      </div>
    </div>
    </CompactRows.Provider>
  );
}

/** Управляемое окно «Свяжитесь с нами». */
export function ContactUsDialog({
  open,
  onOpenChange,
  service = null,
  telegramUrl = null,
  general = false,
}: ContactUsTarget & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Просто «Контакты» (док кабинета), без разговора о цене услуги. */
  general?: boolean;
}) {
  const t = useTranslations("sharedUi.contactUs");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-3xl border-[#ececf4] bg-white text-[#0b1024] sm:max-w-[440px]" data-contact-us-dialog>
        <DialogHeader className="text-left">
          <DialogTitle className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{general ? t("titleGeneral") : t("title")}</DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.55] text-[#3c4053] newd:sr-only">{general ? t("leadGeneral") : t("lead")}</DialogDescription>
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
