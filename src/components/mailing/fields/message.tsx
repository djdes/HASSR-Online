"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Bold, Link2, MousePointerClick } from "lucide-react";

import type { MailingKindFieldsProps } from "@/components/mailing/kind-fields";
import {
  MESSAGE_BODY_MAX,
  MESSAGE_BUTTON_TEXT_MAX,
  MESSAGE_SUBJECT_MAX,
  coerceMessagePayload,
  type MessagePayload,
} from "@/lib/mailing/kinds/message-shared";
import { MAILING_VARIABLES, isSafeLinkUrl, usedVariables } from "@/lib/mailing/text-format";

/**
 * Поля типа «Сообщение»: тема, текст с переменными и простой разметкой,
 * необязательная кнопка, запасные значения переменных.
 */

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const LABEL = "mb-1.5 flex items-center justify-between gap-2 text-[13px] font-medium text-[#3c4053]";
const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

export default function MessageFields({ payload, onChange, disabled }: MailingKindFieldsProps<MessagePayload>) {
  const t = useTranslations("rootMailingKindFields");
  const bodyLabelId = useId();
  const value = coerceMessagePayload(payload);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const set = (patch: Partial<MessagePayload>) => onChange({ ...value, ...patch });

  /** Вставить/обернуть в поле текста там, где курсор. */
  function edit(transform: (selected: string) => { text: string; cursor: number }) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? value.body.length;
    const end = el?.selectionEnd ?? value.body.length;
    const { text, cursor } = transform(value.body.slice(start, end));
    const body = `${value.body.slice(0, start)}${text}${value.body.slice(end)}`.slice(0, MESSAGE_BODY_MAX);
    set({ body });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + cursor, start + cursor);
    });
  }

  const used = usedVariables(`${value.subject}\n${value.body}\n${value.buttonText}`);
  const buttonUrlBad = value.buttonUrl.trim() !== "" && !isSafeLinkUrl(value.buttonUrl.trim());

  return (
    <div className="space-y-4" data-testid="mailing-fields-message">
      <label className="block">
        <span className={LABEL}>
          {t("message.subjectLabel")}
          <span className="tabular-nums text-[12px] font-normal text-[#9b9fb3]">
            {value.subject.length}/{MESSAGE_SUBJECT_MAX}
          </span>
        </span>
        <input
          name="subject"
          value={value.subject}
          disabled={disabled}
          maxLength={MESSAGE_SUBJECT_MAX}
          onChange={(e) => set({ subject: e.target.value })}
          placeholder={t("message.subjectExample", { nameToken: "{имя}" })}
          className={INPUT}
        />
      </label>

      <div>
        <div className={LABEL}>
          <span id={bodyLabelId}>{t("message.bodyLabel")}</span>
          <span className="tabular-nums text-[12px] font-normal text-[#9b9fb3]">
            {value.body.length}/{MESSAGE_BODY_MAX}
          </span>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={disabled}
            className={CHIP}
            onClick={() =>
              edit((sel) => ({ text: `**${sel || "жирный текст"}**`, cursor: (sel || "жирный текст").length + 4 }))
            }
          >
            <Bold className="size-3.5 text-[#5566f6]" /> {t("message.bold")}
          </button>
          <button
            type="button"
            disabled={disabled}
            className={CHIP}
            onClick={() =>
              edit((sel) => {
                const label = sel || "текст ссылки";
                const text = `[${label}](https://)`;
                return { text, cursor: text.length - 1 };
              })
            }
          >
            <Link2 className="size-3.5 text-[#5566f6]" /> {t("message.link")}
          </button>
          {MAILING_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              disabled={disabled}
              className={CHIP}
              onClick={() => edit(() => ({ text: `{${v.token}}`, cursor: v.token.length + 2 }))}
              title={t(`message.variable.${v.key}`)}
            >
              {`{${v.token}}`}
            </button>
          ))}
        </div>
        <textarea
          ref={bodyRef}
          name="body"
          aria-labelledby={bodyLabelId}
          value={value.body}
          disabled={disabled}
          maxLength={MESSAGE_BODY_MAX}
          onChange={(e) => set({ body: e.target.value })}
          rows={9}
          placeholder={t("message.bodyExample", { nameToken: "{имя}", companyToken: "{компания}" })}
          className="w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-3 text-[15px] leading-[1.6] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60"
        />
        <p className="mt-1.5 text-[12px] leading-[1.55] text-[#6f7282]">
          {t.rich("message.formatHelp", {
            boldExample: "**так**", linkExample: "[текст](https://…)", fallbackExample: "{имя|друзья}",
            bold: (chunks) => <code className="rounded bg-[#f5f6ff] px-1">{chunks}</code>,
            link: (chunks) => <code className="rounded bg-[#f5f6ff] px-1">{chunks}</code>,
            fallback: (chunks) => <code className="rounded bg-[#f5f6ff] px-1">{chunks}</code>,
          })}
        </p>
      </div>

      <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#0b1024]">
          <MousePointerClick className="size-4 text-[#5566f6]" />
          {t("message.buttonOptional")}
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <label className="block">
            <span className={LABEL}>{t("message.buttonText")}</span>
            <input
              name="buttonText"
              value={value.buttonText}
              disabled={disabled}
              maxLength={MESSAGE_BUTTON_TEXT_MAX}
              onChange={(e) => set({ buttonText: e.target.value })}
              placeholder={t("message.buttonExample")}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className={LABEL}>{t("message.link")}</span>
            <input
              name="buttonUrl"
              value={value.buttonUrl}
              disabled={disabled}
              onChange={(e) => set({ buttonUrl: e.target.value })}
              placeholder={t("message.linkExample")}
              inputMode="url"
              className={INPUT}
            />
          </label>
        </div>
        {buttonUrlBad ? (
          <p className="mt-2 text-[12px] text-[#a13a32]">{t("message.badUrl")}</p>
        ) : (
          <p className="mt-2 text-[12px] text-[#9b9fb3]">
            {t("message.buttonHint")}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
        <div className="text-[13px] font-semibold text-[#0b1024]">{t("message.fallbackTitle")}</div>
        <p className="mt-0.5 text-[12px] text-[#6f7282]">
          {used.length
            ? t("message.fallbackUsed")
            : t("message.fallbackUnused")}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {MAILING_VARIABLES.map((v) => (
            <label key={v.key} className="block">
              <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">{`{${v.token}}`} →</span>
              <input
                value={value.fallbacks[v.key]}
                disabled={disabled}
                maxLength={60}
                onChange={(e) => set({ fallbacks: { ...value.fallbacks, [v.key]: e.target.value } })}
                placeholder={v.defaultFallback}
                className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
