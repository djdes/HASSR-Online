import { escapeHtml } from "@/lib/html-escape";
import { renderEmailLayout } from "@/lib/email";
import { ORG_SPHERES } from "@/lib/org-profile";

import type { MailingTemplate } from "../templates";
import {
  isSafeLinkUrl,
  prepareText,
  substituteVariables,
  toEmailHtml,
  toPlainText,
  toShortText,
  toTelegramHtml,
  type VariableFallbacks,
} from "../text-format";
import { defaultMessagePayload, validateMessagePayload, type MessagePayload } from "./message-shared";

/**
 * Тип «Сообщение»: тема/заголовок, текст с простой разметкой и
 * переменными, необязательная кнопка. Письмо — полный текст (с подвалом и
 * отпиской); Telegram, MAX, колокольчик и push — короткий текст, если он
 * написан, иначе тот же полный.
 * Сделан через ту же точку расширения, что и будущие типы.
 */

export type { MessagePayload } from "./message-shared";

function sphereLabel(sphere: string | null): string | null {
  if (!sphere) return null;
  return ORG_SPHERES.find((s) => s.value === sphere)?.label ?? null;
}

const BUTTON_STYLE =
  "display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px";

const TELEGRAM_MAX = 3900;

export const messageTemplate: MailingTemplate<MessagePayload> = {
  kind: "message",
  label: "Сообщение",
  defaultPayload: defaultMessagePayload,
  validate: validateMessagePayload,
  async render(payload, ctx) {
    const values = { name: ctx.name, company: ctx.companyName, sphere: sphereLabel(ctx.sphere) };
    const fallbacks: VariableFallbacks = payload.fallbacks ?? {};
    const subject = substituteVariables(payload.subject, values, fallbacks).replace(/\s+/g, " ").trim();
    const prepared = prepareText(payload.body, values, fallbacks);
    // Короткий текст — для мессенджеров; ссылки из него считаются после ссылок письма.
    const short = payload.shortBody?.trim() ? prepareText(payload.shortBody, values, fallbacks) : prepared;
    const hasButton = Boolean(payload.buttonText && payload.buttonUrl && isSafeLinkUrl(payload.buttonUrl));
    const buttonText = hasButton ? substituteVariables(payload.buttonText, values, fallbacks) : "";
    // Сначала ссылки текста, потом кнопка — номера ссылок идут по порядку в письме.
    const textHtml = toEmailHtml(prepared, { linkHref: ctx.trackUrl });
    const trackedButton = hasButton ? ctx.trackUrl(payload.buttonUrl) : null;

    const imageHtml = payload.imageUrl
      ? `<p style="margin:0 0 20px"><img src="${escapeHtml(payload.imageUrl)}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:12px"></p>
`
      : "";
    const bodyHtml =
      imageHtml +
      textHtml +
      (trackedButton
        ? `\n<p style="margin:24px 0 8px"><a href="${escapeHtml(trackedButton)}" style="${BUTTON_STYLE}">${escapeHtml(buttonText)}</a></p>`
        : "");
    const unsubscribe = escapeHtml(ctx.unsubscribeUrl);
    const footerHtml =
      `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;text-align:center">` +
      `Не хотите получать новости и предложения WeSetup — <a href="${unsubscribe}" style="color:#71717a;text-decoration:underline">отпишитесь</a>. ` +
      `Служебные письма (коды входа, счета) это не затронет.</p>`;
    const preheader = toShortText(prepared, 120);
    const html = renderEmailLayout(escapeHtml(subject), bodyHtml, null, { preheader, footerHtml });
    const text = [
      toPlainText(prepared, { linkHref: ctx.trackUrl }),
      trackedButton ? `${buttonText}: ${trackedButton}` : null,
      "—",
      "WeSetup — электронные журналы СанПиН и ХАССП.",
      `Отписаться от новостей и предложений: ${ctx.unsubscribeUrl}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let telegram = `<b>${escapeHtml(subject)}</b>\n\n${toTelegramHtml(short, { linkHref: ctx.trackUrl })}`;
    if (telegram.length > TELEGRAM_MAX) {
      telegram = `<b>${escapeHtml(subject)}</b>\n\n${escapeHtml(toShortText(short, TELEGRAM_MAX - subject.length - 200))}`;
    }
    if (trackedButton) telegram += `\n\n<a href="${escapeHtml(trackedButton)}">${escapeHtml(buttonText)}</a>`;

    // Колокольчик и push открываются внутри кабинета: туда — исходный адрес
    // (путь сайта или внешний), учёт кликов — в письме и Telegram.
    const inAppUrl = hasButton ? payload.buttonUrl : null;
    return {
      email: { subject, preheader, html, text },
      inApp: { title: subject, body: toShortText(short, 500), url: inAppUrl },
      push: {
        title: subject.length > 80 ? `${subject.slice(0, 79)}…` : subject,
        body: toShortText(short, 180),
        url: inAppUrl && inAppUrl.startsWith("/") ? inAppUrl : null,
      },
      telegram: { text: telegram, url: trackedButton },
    };
  },
};
