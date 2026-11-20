"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import Link from "next/link";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ConfirmDocument = "offer" | "consent";
const CONFIRM_HREF: Record<ConfirmDocument, string> = { offer: "/oferta", consent: "/consent" };

/**
 * Обязательная галка согласия с документами (2026-09-22). Не отмечена по
 * умолчанию; без неё регистрация не отправляется (сервер тоже проверяет).
 */
export function LegalConsentCheckbox({
  checked,
  onChange,
  tone = "light",
  className,
  highlight,
  guideTarget,
  variant = "full",
  confirmLinks = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  tone?: "light" | "dark";
  className?: string;
  /** Пытались отправить без галки — подсветить. */
  highlight?: boolean;
  /** Цель живого гида по регистрации (`data-guide`). */
  guideTarget?: string;
  /**
   * `short` — стартовая форма сайта (правки 18.11.2026): одна строка с двумя
   * документами, оферта и согласие на обработку персональных данных. В журнал
   * согласий для источника `landing` пишется этот же текст
   * (`LEGAL_CONSENT_TEXT_SHORT` в `lib/legal-consent.ts`) — менять вместе.
   */
  variant?: "full" | "short";
  /**
   * Нажатие на название документа сначала спрашивает «Открыть?» (правки
   * 19.11.2026). На телефоне строка согласия почти целиком из ссылок: человек
   * метит в галку, попадает в ссылку и уходит с формы в документ. Окно
   * возвращает его к форме: как в Telegram (правки 20.11.2026), сверху яркая
   * «Не переходить», под ней серая «Всё равно перейти». Работает для
   * короткой строки (`variant="short"`).
   */
  confirmLinks?: boolean;
}) {
  const t = useTranslations("auth.legal");
  const descriptionId = useId();
  const [confirm, setConfirm] = useState<ConfirmDocument | null>(null);
  // Ссылка остаётся настоящей (новая вкладка, средняя кнопка, поисковик);
  // обычное нажатие вместо перехода открывает вопрос.
  const documentLink = (document: ConfirmDocument, chunks: ReactNode) => (
    <Link
      href={CONFIRM_HREF[document]}
      target="_blank"
      className={link}
      onClick={
        confirmLinks
          ? (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              setConfirm(document);
            }
          : undefined
      }
    >
      {chunks}
    </Link>
  );
  const dark = tone === "dark";
  const link = cn(
    "underline underline-offset-2 transition-colors",
    dark ? "text-white/90 hover:text-white" : "text-[#3848c7] hover:text-[#0b1024]"
  );
  return (
    <>
    <label
      data-guide={guideTarget}
      className={cn(
        "flex cursor-pointer gap-2.5 rounded-2xl px-1 py-1 text-left text-[12.5px] leading-[1.5] transition-colors",
        variant === "short" ? "items-center" : "items-start",
        dark ? "text-white/70" : "text-[#6f7282]",
        highlight && !checked && (dark ? "bg-white/10 ring-2 ring-[#ffb4ab]/60" : "bg-[#fff4f2] ring-2 ring-[#f2b8b0]"),
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={cn("size-[18px] shrink-0 accent-[#5566f6]", variant === "short" ? "" : "mt-0.5")}
        data-testid="legal-consent"
        aria-describedby={descriptionId}
      />
      <span id={descriptionId}>
        {variant === "short"
          ? t.rich("consentShort", {
              offer: (chunks) => documentLink("offer", chunks),
              consent: (chunks) => documentLink("consent", chunks),
            })
          : t.rich("consentSentence", {
              offer: (chunks) => <Link href="/oferta" target="_blank" className={link}>{chunks}</Link>,
              terms: (chunks) => <Link href="/terms" target="_blank" className={link}>{chunks}</Link>,
              privacy: (chunks) => <Link href="/privacy" target="_blank" className={link}>{chunks}</Link>,
              consent: (chunks) => <Link href="/consent" target="_blank" className={link}>{chunks}</Link>,
            })}
      </span>
    </label>
    {confirmLinks ? (
      <Dialog open={confirm !== null} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <DialogContent className="sm:max-w-[420px]" data-testid="legal-open-confirm">
          <DialogHeader>
            <DialogTitle className="text-[20px] leading-snug tracking-[-0.01em]">
              {confirm === "consent" ? t("openConsentTitle") : t("openOfferTitle")}
            </DialogTitle>
            <DialogDescription className="text-[14px] leading-[1.55] text-[#6f7282]">{t("openHint")}</DialogDescription>
          </DialogHeader>
          {/* Как окно перехода по ссылке в Telegram (правки 20.11.2026): две
              кнопки во всю ширину столбиком. Сверху яркая «Не переходить» —
              на ней фокус, палец попадает в неё первой; снизу серая неброская
              «Всё равно перейти». Серые классы — с ночным соответствием в
              app-theme.css, иначе ночью кнопка осталась бы светлой. */}
          <div className="mt-1 flex flex-col gap-2.5">
            <button
              type="button"
              data-testid="legal-open-no"
              autoFocus
              onClick={() => setConfirm(null)}
              className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-[#5566f6] px-6 text-[17px] font-semibold text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] hover:bg-[#4a5bf0]"
            >
              {t("openNo")}
            </button>
            <button
              type="button"
              data-testid="legal-open-yes"
              onClick={() => {
                if (confirm) window.open(CONFIRM_HREF[confirm], "_blank", "noopener");
                setConfirm(null);
              }}
              className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-[#f1f2f8] px-6 text-[16px] font-medium text-[#6f7282] hover:text-[#3c4053]"
            >
              {t("openYes")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    ) : null}
    </>
  );
}
