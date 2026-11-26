import { COMPANY_EMAIL, COMPANY_MOBILE } from "@/lib/company-contacts";
import { escapeHtml } from "@/lib/html-escape";
import { C, FONT, button, e, footer, logo, renderDocument, spacer } from "@/lib/mailing/promo-designs/shared";
import { ORG_SPHERES } from "@/lib/org-profile";
import { PROPOSAL_SITE_ORIGIN } from "@/lib/proposal/cta";
import { readTariffs } from "@/lib/tariffs";

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
import {
  POSTER_PHONE,
  POSTER_PUBLIC_PATH,
  POSTER_SITE,
  coercePosterPayload,
  defaultPosterPayload,
  isPosterImageFile,
  posterAlt,
  posterWord,
  validatePosterPayload,
  type PosterFormData,
  type PosterMailPayload,
} from "./poster-shared";

/**
 * Тип «Постер»: письмо начинается с рекламного постера 1080×1350 (фон —
 * генератор, надписи — сервер, `poster-image.server.ts`), под ним живой
 * HTML в тех же тёмных тонах: заголовок, текст с разметкой и переменными,
 * кнопка, телефон и почта текстом, отписка. Письмо не сводится к одной
 * картинке, а alt постера пересказывает его надписи. Без собранного
 * постера — та же шапка живой вёрсткой (черновик, предпросмотр).
 * Telegram, MAX, колокольчик и push — короткий текст, как у «Сообщения».
 */

export type { PosterMailPayload } from "./poster-shared";

const TELEGRAM_MAX = 3900;
const PANEL = "#121838";
const LINE = "#262e5c";
const SOFT = "#c7cbe0";
const LAVENDER = "#a3aef8";
const DISPLAY = "'Oswald','Arial Narrow','Roboto Condensed',Impact,Arial,sans-serif";
const PHONE_HREF = `tel:${POSTER_PHONE.tel}`;
const MOBILE_HREF = `tel:${COMPANY_MOBILE.tel}`;

const CSS = `
a:focus-visible{outline:3px solid ${C.mint};outline-offset:3px}
@media only screen and (max-width:480px){
.p-word{font-size:92px!important;line-height:96px!important}
.p-title{font-size:24px!important;line-height:30px!important}
.p-phone{font-size:30px!important;line-height:36px!important}
.p-hero{border-radius:20px 20px 0 0!important}
}
`;

function sphereLabel(sphere: string | null): string | null {
  if (!sphere) return null;
  return ORG_SPHERES.find((s) => s.value === sphere)?.label ?? null;
}

function table(rows: string, attrs = ""): string {
  return `<table role="presentation" ${attrs}cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

/** Шапка без картинки: плашка, слово, карточка — живой вёрсткой. */
function fallbackHero(payload: PosterMailPayload, href: string): string {
  const art = payload.poster;
  const kicker = art.kicker
    ? table(
        `<tr><td style="padding:7px 16px;border:3px solid ${C.dark};border-radius:10px;background-color:${C.mint};font-family:${DISPLAY};font-size:20px;line-height:24px;font-weight:700;color:${C.dark};letter-spacing:.5px;text-transform:uppercase">${e(art.kicker)}</td></tr>`,
        'align="center" '
      )
    : "";
  const card =
    art.cardTitle || art.cardValue
      ? table(
          `<tr><td align="center" style="padding:12px 24px;border:3px solid ${C.indigo};border-radius:18px;background-color:#ffffff"><span style="font-family:${DISPLAY};font-size:18px;line-height:22px;font-weight:700;color:${C.indigoDeep};text-transform:uppercase">${e(art.cardTitle)}</span>${art.cardValue ? `<br><span style="font-family:${DISPLAY};font-size:40px;line-height:46px;font-weight:700;color:${C.dark};text-transform:uppercase">${e(art.cardValue)}</span>` : ""}</td></tr>`,
          'align="center" '
        )
      : "";
  return `<tr><td class="p-hero" bgcolor="${C.dark}" align="center" style="padding:40px 24px 30px;background-color:${C.dark};background-image:radial-gradient(circle at 50% 30%,rgba(85,102,246,.5),transparent 60%);border-radius:24px 24px 0 0">
${kicker}
<a href="${e(href)}" style="text-decoration:none"><p class="p-word" style="margin:8px 0 6px;font-family:${DISPLAY};font-size:140px;line-height:146px;font-weight:700;color:#8e9bf8;letter-spacing:-1px;text-align:center;white-space:nowrap;text-transform:uppercase">${e(posterWord(art.word))}</p></a>
${card}
</td></tr>`;
}

export const posterTemplate: MailingTemplate<PosterMailPayload> = {
  kind: "poster",
  label: "Постер",
  defaultPayload: defaultPosterPayload,
  validate: validatePosterPayload,
  /** Цена «Стандарта» помесячно — из `/root/tariffs`, для подсказки карточки (цены не выдумываем). */
  async formData(): Promise<PosterFormData> {
    const tariffs = await readTariffs();
    const standard = tariffs.find((t) => t.key === "standard_month" && t.active);
    return { standardMonthRub: standard?.priceRub ?? null };
  },
  async render(raw, ctx) {
    const payload = coercePosterPayload(raw);
    const art = payload.poster;
    const values = { name: ctx.name, company: ctx.companyName, sphere: sphereLabel(ctx.sphere) };
    const fallbacks: VariableFallbacks = payload.fallbacks ?? {};
    const fill = (text: string) => substituteVariables(text, values, fallbacks).replace(/\s+/g, " ").trim();
    const subject = fill(payload.subject);
    const headline = fill(payload.headline);
    const prepared = prepareText(payload.body, values, fallbacks);
    const short = payload.shortBody?.trim() ? prepareText(payload.shortBody, values, fallbacks) : prepared;
    const hasButton = Boolean(payload.buttonText && payload.buttonUrl && isSafeLinkUrl(payload.buttonUrl));
    const buttonText = hasButton ? fill(payload.buttonText) : "";
    // Ссылки текста, потом кнопка: номера ссылок идут по порядку в письме.
    const textHtml = toEmailHtml(prepared, {
      linkHref: ctx.trackUrl,
      paragraphStyle: `margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:25px;color:${SOFT}`,
      linkStyle: `color:${C.mint};text-decoration:underline;font-weight:700`,
    });
    const trackedButton = hasButton ? ctx.trackUrl(payload.buttonUrl) : null;
    const site = ctx.trackUrl(`${PROPOSAL_SITE_ORIGIN}/`);
    const heroHref = trackedButton ?? site;
    const preheader = toShortText(prepared, 120);
    const poster = art.image && isPosterImageFile(art.image) ? `${PROPOSAL_SITE_ORIGIN}${POSTER_PUBLIC_PATH}${art.image}` : "";
    const alt = posterAlt(art);

    const header = `<tr><td style="padding:4px 8px 16px">${table(
      `<tr><td valign="middle">${logo({ origin: PROPOSAL_SITE_ORIGIN }, "white-on-dark", 24)}</td><td valign="middle" align="right" style="font-family:${FONT};font-size:13px;line-height:18px;font-weight:700"><a href="${e(site)}" style="color:${LAVENDER};text-decoration:none">${POSTER_SITE}</a></td></tr>`,
      'width="100%" '
    )}</td></tr>`;
    const hero = poster
      ? `<tr><td class="p-hero" bgcolor="${C.dark}" style="padding:0;line-height:0;font-size:0;background-color:${C.dark};border-radius:24px 24px 0 0"><a href="${e(heroHref)}" style="display:block;text-decoration:none"><img class="p-hero" src="${e(poster)}" width="600" alt="${e(alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:24px 24px 0 0;background-color:${C.dark};font-family:${FONT};font-size:16px;line-height:24px;font-weight:700;color:#ffffff"></a></td></tr>`
      : fallbackHero(payload, heroHref);

    const contacts = `${table(
      `<tr><td style="padding:22px 0 0;border-top:1px solid ${LINE}">
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${C.mint}">${e(art.cta || "Звоните")}</p>
<p style="margin:6px 0 0"><a class="p-phone" href="${PHONE_HREF}" style="font-family:${DISPLAY};font-size:38px;line-height:44px;font-weight:700;color:#ffffff;text-decoration:none;white-space:nowrap">${e(POSTER_PHONE.display)}</a></p>
<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${LAVENDER}"><a href="${MOBILE_HREF}" style="color:${LAVENDER};text-decoration:none;white-space:nowrap">${e(COMPANY_MOBILE.display)}</a> · <a href="mailto:${COMPANY_EMAIL}" style="color:${LAVENDER};text-decoration:underline">${COMPANY_EMAIL}</a> · <a href="${e(site)}" style="color:${LAVENDER};text-decoration:underline">${POSTER_SITE}</a></p>
</td></tr>`,
      'width="100%" '
    )}`;
    const lettering = `<tr><td class="m-px" bgcolor="${PANEL}" style="padding:30px 32px 32px;background-color:${PANEL};border-radius:0 0 24px 24px">
<h1 class="p-title" style="margin:0 0 14px;font-family:${FONT};font-size:28px;line-height:34px;font-weight:800;color:#ffffff;letter-spacing:-.4px">${e(headline)}</h1>
${textHtml}
${trackedButton ? `<div style="height:8px;line-height:8px;font-size:0">&nbsp;</div>${button({ href: trackedButton, label: buttonText, bg: C.indigo, shadow: "0 10px 30px rgba(85,102,246,.45)" })}<div style="clear:both;height:6px;line-height:6px;font-size:0">&nbsp;</div>` : ""}
<div style="height:22px;line-height:22px;font-size:0">&nbsp;</div>
${contacts}
</td></tr>`;
    const foot = `<tr><td class="m-px" style="padding:22px 12px 8px">${footer({ unsubscribeUrl: ctx.unsubscribeUrl }, "dark")}</td></tr>`;
    const html = renderDocument({
      view: { subject, preheader },
      bodyBg: C.dark,
      light: false,
      css: CSS,
      // На постере уже есть знак «сетап» — шапка письма нужна только живой вёрстке.
      body: [poster ? spacer(4) : header, hero, lettering, spacer(4), foot].join("\n"),
    }).replace(
      // Узкий шрифт слова в шапке без картинки — подгружаем рядом с Manrope.
      "family=Manrope:wght@500;700;800&amp;display=swap",
      "family=Manrope:wght@500;700;800&amp;family=Oswald:wght@700&amp;display=swap"
    );

    const text = [
      headline,
      toPlainText(prepared, { linkHref: ctx.trackUrl }),
      trackedButton ? `${buttonText}: ${trackedButton}` : null,
      `${art.cta || "Звоните"}: ${POSTER_PHONE.display}, ${COMPANY_MOBILE.display}, ${COMPANY_EMAIL}, ${POSTER_SITE}`,
      "—",
      "WeSetup — электронные журналы СанПиН и ХАССП.",
      `Отписаться от новостей и предложений: ${ctx.unsubscribeUrl}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let telegram = `<b>${escapeHtml(headline)}</b>\n\n${toTelegramHtml(short, { linkHref: ctx.trackUrl })}`;
    if (telegram.length > TELEGRAM_MAX) {
      telegram = `<b>${escapeHtml(headline)}</b>\n\n${escapeHtml(toShortText(short, TELEGRAM_MAX - headline.length - 200))}`;
    }
    if (trackedButton) telegram += `\n\n<a href="${escapeHtml(trackedButton)}">${escapeHtml(buttonText)}</a>`;

    const inAppUrl = hasButton ? payload.buttonUrl : null;
    const notes = poster
      ? []
      : ["Постер ещё не собран — в письме вместо картинки будет текстовая шапка. Сгенерируйте фон в полях рассылки."];
    return {
      email: { subject, preheader, html, text },
      inApp: { title: headline, body: toShortText(short, 500), url: inAppUrl },
      push: {
        title: headline.length > 80 ? `${headline.slice(0, 79)}…` : headline,
        body: toShortText(short, 180),
        url: inAppUrl && inAppUrl.startsWith("/") ? inAppUrl : null,
      },
      telegram: { text: telegram, url: trackedButton },
      ...(notes.length ? { notes } : {}),
    };
  },
};
