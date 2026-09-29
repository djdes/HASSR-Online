import { brandQrHeightFor } from "@/lib/brand-qr-shared";
import { escapeHtml } from "@/lib/html-escape";

import type { ProposalContent, ProposalJournalItem } from "./content";
import { PROPOSAL_SITE_ORIGIN } from "./cta";
import type { RenderedProposalEmail } from "./types";

/**
 * Письмо с КП — под почтовые программы и телефоны:
 *   • таблицы шириной 600 px, все стили инлайн; в `<style>` — только то,
 *     что без него не сделать: сжатие на телефоне и тёмная схема;
 *   • кнопка «пуленепробиваемая»: ячейка с заливкой + VML для Outlook;
 *   • прехедер скрытым блоком в начале;
 *   • картинки — абсолютные адреса боевого сайта (`data:` Gmail режет):
 *     знак сайта и QR (`/api/kp/qr/<CODE>?s=<сфера>`, только с промокодом —
 *     маршрут рисует лишь адреса `/promo/…`);
 *   • на телефоне QR прячется (сканировать экран своего же телефона
 *     нечем) — остаётся кнопка;
 *   • тёмная схема: шапка и так тёмная, у QR свой белый фон; для Apple Mail
 *     и iOS — палитра в `prefers-color-scheme: dark`;
 *   • `trackUrl` оборачивает все ссылки, кроме отписки.
 *
 * Чистая функция от модели страницы (`content.ts`) и ссылок.
 */

export type ProposalEmailLinks = {
  /** Веб-версия КП (`/kp/<токен>`) или null. */
  web: string | null;
  /** PDF веб-версии или null. */
  pdf: string | null;
  unsubscribe: string | null;
  trackUrl?: (url: string) => string;
};

/** Откуда почтовая программа тянет картинки: всегда боевой домен. */
export const EMAIL_ASSET_ORIGIN = PROPOSAL_SITE_ORIGIN;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const C = {
  page: "#f4f5fb",
  card: "#ffffff",
  ink: "#0b1024",
  body: "#3c4053",
  muted: "#6f7282",
  accent: "#5566f6",
  accentDeep: "#3848c7",
  tint: "#f5f6ff",
  tint2: "#eef1ff",
  line: "#e4e6f1",
  dark: "#0b1024",
};

const e = escapeHtml;

/** QR для письма — PNG с сайта: только адреса `/promo/<CODE>?s=<сфера>`. */
export function proposalQrImageUrl(code: string, sphere: string): string {
  return `${EMAIL_ASSET_ORIGIN}/api/kp/qr/${encodeURIComponent(code)}?s=${encodeURIComponent(sphere)}`;
}

function button(href: string, label: string): string {
  const safeHref = e(href);
  const safeLabel = e(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
<tr><td align="center" bgcolor="${C.accent}" style="border-radius:14px;background:${C.accent}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:48px;v-text-anchor:middle;width:260px" arcsize="30%" stroke="f" fillcolor="${C.accent}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${safeLabel}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${safeHref}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;background:${C.accent};mso-hide:all">${safeLabel}</a><!--<![endif]-->
</td></tr></table>`;
}

function para(text: string, style = ""): string {
  return `<p class="kp-text" style="margin:0;font-family:${FONT};font-size:15px;line-height:23px;color:${C.body};${style}">${e(text)}</p>`;
}

function label(text: string): string {
  return `<p class="kp-muted" style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted}">${e(text)}</p>`;
}

function journalList(items: ProposalJournalItem[], filled: boolean): string {
  return items
    .map(
      (item) => `<tr>
<td width="18" valign="top" style="padding:4px 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.accent}">${filled ? "&#9679;" : "&#9675;"}</td>
<td class="kp-text" style="padding:2px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink}">${e(item.name)}${
        item.note ? `<span class="kp-muted" style="color:${C.muted}"> — ${e(item.note)}</span>` : ""
      }</td>
</tr>`,
    )
    .join("");
}

export function renderProposalEmailHtml(content: ProposalContent, links: ProposalEmailLinks): RenderedProposalEmail {
  const track = (url: string) => (links.trackUrl ? links.trackUrl(url) : url);
  const cta = track(content.offer.ctaUrl);
  const web = links.web ? track(links.web) : null;
  const pdf = links.pdf ? track(links.pdf) : null;
  const unsubscribe = links.unsubscribe ?? null;
  const qrImage =
    content.offer.ctaKind === "promo" && content.offer.promoCode
      ? proposalQrImageUrl(content.offer.promoCode, content.sphere)
      : null;
  const qrWidth = 150;
  const qrHeight = brandQrHeightFor(qrWidth);
  const logo = `${EMAIL_ASSET_ORIGIN}/brand/wordmark.png`;

  // Прехедер + заполнитель, чтобы программа не дописывала в превью начало письма.
  const filler = "&#8199;&#65279;&#847;".repeat(40);

  const steps = content.steps
    .map(
      (step, index) => `<tr>
<td width="44" valign="top" style="padding:0 0 14px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="30" height="30" bgcolor="${C.accent}" style="width:30px;height:30px;border-radius:15px;background:${C.accent};font-family:${FONT};font-size:14px;font-weight:700;color:#ffffff">${index + 1}</td></tr></table>
</td>
<td valign="top" style="padding:0 0 14px">
<p class="kp-text-strong" style="margin:0;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:${C.ink}">${e(step.title)}</p>
${para(step.text, "margin-top:2px")}
</td>
</tr>`,
    )
    .join("");

  const benefits = content.benefits
    .map(
      (item) => `<tr>
<td width="28" valign="top" style="padding:2px 0 12px;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:${C.accentDeep}">&#10003;</td>
<td valign="top" style="padding:0 0 12px">
<p class="kp-text-strong" style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;font-weight:700;color:${C.ink}">${e(item.title)}</p>
${para(item.text, "font-size:14px;line-height:21px")}
</td>
</tr>`,
    )
    .join("");

  const [free, team] = content.offer.rows;
  const priceCell = (row: typeof free) => `${
    row.oldPrice
      ? `<span class="kp-muted" style="font-family:${FONT};font-size:15px;line-height:20px;color:${C.muted};text-decoration:line-through">${e(row.oldPrice)}</span><br>`
      : ""
  }<span class="kp-text-strong" style="font-family:${FONT};font-size:28px;line-height:34px;font-weight:800;color:${C.ink}">${e(row.price)}</span><span class="kp-muted" style="font-family:${FONT};font-size:14px;line-height:20px;color:${C.body}">${e(row.unit)}</span>${
    row.badge
      ? `<br><span style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:10px;background:${C.accentDeep};font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;color:#ffffff">${e(row.badge)}</span>`
      : ""
  }`;
  const offerRow = (row: typeof free, last: boolean) => `<tr>
<td class="kp-stack" width="150" valign="top" style="padding:0 16px ${last ? 0 : 16}px 0">${priceCell(row)}</td>
<td class="kp-stack" valign="top" style="padding:0 0 ${last ? 0 : 16}px">
<p class="kp-text-strong" style="margin:0;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:${C.ink}">${e(row.title)}</p>
${para(row.text, "font-size:14px;line-height:21px;margin-top:2px")}
</td>
</tr>`;

  const notes = content.offer.notes
    .map(
      (note) =>
        `<p class="kp-accent" style="margin:12px 0 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${C.accentDeep}">${e(note)}</p>`,
    )
    .join("");

  const qrCell = qrImage
    ? `<td class="kp-hide-mobile" width="170" valign="top" align="center" style="padding:0 0 0 20px">
<a href="${e(cta)}" target="_blank" style="text-decoration:none"><img src="${e(qrImage)}" width="${qrWidth}" height="${qrHeight}" alt="QR-код: промокод ${e(content.offer.promoCode ?? "")} применится сам" style="display:block;width:${qrWidth}px;height:${qrHeight}px;border:0;outline:none"></a>
<p class="kp-text-strong" style="margin:8px 0 0;font-family:${FONT};font-size:15px;line-height:20px;font-weight:800;letter-spacing:1px;color:${C.ink}">${e(content.offer.promoCode ?? "")}</p>
<p class="kp-muted" style="margin:2px 0 0;font-family:${FONT};font-size:12px;line-height:16px;color:${C.muted}">или отсканируйте телефоном</p>
</td>`
    : "";

  const senderBlock = content.sender
    ? `<tr><td class="kp-card kp-px" bgcolor="${C.card}" style="background:${C.card};padding:0 40px 28px">
<p class="kp-text-strong" style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;font-weight:700;color:${C.ink}">${e(content.sender.name)}</p>
${content.sender.lines
  .map(
    (line) =>
      `<p class="kp-text" style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.body}">${e(line.label)}: <a href="${e(track(line.href))}" style="color:${C.accentDeep};text-decoration:none">${e(line.value)}</a></p>`,
  )
  .join("")}
</td></tr>`
    : "";

  const footerLinks = [
    web ? `<a href="${e(web)}" style="color:${C.muted};text-decoration:underline">Открыть в браузере</a>` : null,
    pdf ? `<a href="${e(pdf)}" style="color:${C.muted};text-decoration:underline">Скачать PDF</a>` : null,
    unsubscribe ? `<a href="${e(unsubscribe)}" style="color:${C.muted};text-decoration:underline">Отписаться от писем</a>` : null,
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(content.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media only screen and (max-width:480px){
.kp-container{width:100%!important;max-width:100%!important}
.kp-px{padding-left:20px!important;padding-right:20px!important}
.kp-stack{display:block!important;width:100%!important;padding-right:0!important}
.kp-hide-mobile{display:none!important;max-height:0!important;overflow:hidden!important}
.kp-title{font-size:25px!important;line-height:31px!important}
.kp-outer{padding:0!important}
.kp-radius{border-radius:0!important}
}
@media (prefers-color-scheme:dark){
.kp-page{background:#070a18!important}
.kp-card{background:#10152b!important}
.kp-tint{background:#171e3d!important}
.kp-text{color:#d7dbee!important}
.kp-text-strong{color:#ffffff!important}
.kp-muted{color:#a3a8c3!important}
.kp-accent{color:#aab4ff!important}
.kp-line{border-color:#262d4f!important}
}
</style>
</head>
<body class="kp-page" style="margin:0;padding:0;background:${C.page}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${e(content.preheader)}${filler}</div>
<table role="presentation" class="kp-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
<tr><td class="kp-outer" align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="kp-container" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td class="kp-radius" bgcolor="${C.dark}" style="background:${C.dark};border-radius:20px 20px 0 0;padding:22px 40px" >
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${e(track(`${PROPOSAL_SITE_ORIGIN}/`))}" target="_blank"><img src="${e(logo)}" width="116" height="31" alt="WeSetup" style="display:block;width:116px;height:31px;border:0;outline:none;color:#ffffff;font-family:${FONT};font-size:20px;font-weight:700"></a></td>
<td valign="middle" align="right" style="font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#aab0cc">${e(content.eyebrow)}</td>
</tr></table>
</td></tr>
<tr><td class="kp-card kp-px" bgcolor="${C.card}" style="background:${C.card};padding:32px 40px 8px">
${content.addressee ? `<p class="kp-accent" style="margin:0 0 10px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;color:${C.accentDeep}">${e(content.addressee)}</p>` : ""}
<h1 class="kp-title kp-text-strong" style="margin:0;font-family:${FONT};font-size:30px;line-height:36px;font-weight:800;color:${C.ink}">${e(content.titleLead)} <span class="kp-accent" style="color:${C.accent}">${e(content.titleFor)}</span></h1>
${para(content.lead, "margin-top:14px")}
</td></tr>
<tr><td class="kp-card kp-px" bgcolor="${C.card}" style="background:${C.card};padding:28px 40px 4px">
${label("Как это работает")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${steps}</table>
${para(content.stepsNote, "font-size:14px;line-height:21px")}
</td></tr>
<tr><td class="kp-card kp-px" bgcolor="${C.card}" style="background:${C.card};padding:28px 40px 4px">
${label(content.benefitsTitle)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${benefits}</table>
</td></tr>
<tr><td class="kp-card kp-px" bgcolor="${C.card}" style="background:${C.card};padding:16px 40px 8px">
${label(content.journalsTitle)}
${content.journalsRequired.length ? `<p class="kp-accent" style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;color:${C.accentDeep}">Обязательные</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${journalList(content.journalsRequired, true)}</table>` : ""}
${content.journalsRecommended.length ? `<p class="kp-accent" style="margin:12px 0 4px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;color:${C.accentDeep}">Рекомендуем</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${journalList(content.journalsRecommended, false)}</table>` : ""}
${para(`${content.journalsMore ? `${content.journalsMore.charAt(0).toUpperCase()}${content.journalsMore.slice(1)}. ` : ""}${content.journalsTotal}`, "font-size:14px;line-height:21px;margin-top:10px")}
</td></tr>
<tr><td class="kp-card kp-px" bgcolor="${C.card}" style="background:${C.card};padding:24px 40px 28px">
<table role="presentation" class="kp-tint" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.tint2}" style="background:${C.tint2};border-radius:16px">
<tr><td style="padding:24px">
<p class="kp-accent" style="margin:0 0 16px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${C.accentDeep}">${e(content.offer.title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${offerRow(free, false)}
<tr><td colspan="2" class="kp-line" style="padding:0 0 16px;border-top:1px solid ${C.line};font-size:0;line-height:0">&nbsp;</td></tr>
${offerRow(team, true)}
</table>
${notes}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr>
<td valign="top">
<p class="kp-text-strong" style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:700;color:${C.ink}">${e(content.offer.howToEmail)}</p>
${button(cta, content.offer.ctaLabel)}
<p class="kp-text" style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${C.body}">${e(content.offer.payment)}</p>
</td>
${qrCell}
</tr></table>
</td></tr></table>
</td></tr>
${senderBlock}
<tr><td class="kp-card kp-radius kp-px" bgcolor="${C.card}" style="background:${C.card};border-radius:0 0 20px 20px;padding:0 40px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="kp-line" style="border-top:1px solid ${C.line};padding-top:16px">
${content.requisites ? `<p class="kp-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">${content.requisites.map((line) => e(line)).join("<br>")}</p>` : ""}
${footerLinks.length ? `<p class="kp-muted" style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">${footerLinks.join(" &nbsp;·&nbsp; ")}</p>` : ""}
</td></tr></table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  return {
    subject: content.subject,
    preheader: content.preheader,
    html,
    text: renderProposalEmailText(content, { cta, web, pdf, unsubscribe }),
  };
}

function renderProposalEmailText(
  content: ProposalContent,
  links: { cta: string; web: string | null; pdf: string | null; unsubscribe: string | null },
): string {
  const lines: string[] = [];
  if (content.addressee) lines.push(content.addressee, "");
  lines.push(content.title.toUpperCase(), "", content.lead, "");
  lines.push("КАК ЭТО РАБОТАЕТ");
  content.steps.forEach((step, index) => lines.push(`${index + 1}. ${step.title}. ${step.text}`));
  lines.push(content.stepsNote, "");
  lines.push(content.benefitsTitle.toUpperCase());
  for (const item of content.benefits) lines.push(`— ${item.title}. ${item.text}`);
  lines.push("");
  lines.push(content.journalsTitle.toUpperCase());
  if (content.journalsRequired.length) {
    lines.push("Обязательные:");
    for (const item of content.journalsRequired) lines.push(`• ${item.name}${item.note ? ` — ${item.note}` : ""}`);
  }
  if (content.journalsRecommended.length) {
    lines.push("Рекомендуем:");
    for (const item of content.journalsRecommended) lines.push(`• ${item.name}`);
  }
  if (content.journalsMore) lines.push(`${content.journalsMore.charAt(0).toUpperCase()}${content.journalsMore.slice(1)}.`);
  lines.push(content.journalsTotal, "");
  lines.push(content.offer.title.toUpperCase());
  for (const row of content.offer.rows) {
    const price = row.oldPrice ? `${row.price}${row.unit} вместо ${row.oldPrice}` : `${row.price}${row.unit}`;
    lines.push(`— ${row.title}: ${price}${row.badge ? ` (${row.badge})` : ""}. ${row.text}`);
  }
  for (const note of content.offer.notes) lines.push(note);
  lines.push("", content.offer.howToEmail, `${content.offer.ctaLabel}: ${links.cta}`, content.offer.payment, "");
  if (content.sender) {
    lines.push(content.sender.name);
    for (const line of content.sender.lines) lines.push(`${line.label}: ${line.value}`);
    lines.push("");
  }
  if (links.web) lines.push(`Открыть в браузере: ${links.web}`);
  if (links.pdf) lines.push(`Скачать PDF: ${links.pdf}`);
  if (content.requisites) lines.push("", ...content.requisites);
  if (links.unsubscribe) lines.push("", `Отписаться от писем: ${links.unsubscribe}`);
  return lines.join("\n").replace(/[\u00a0\u202f]/g, " ");
}
