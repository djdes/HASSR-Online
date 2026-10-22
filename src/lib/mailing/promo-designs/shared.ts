import { escapeHtml } from "@/lib/html-escape";
import type { PromoDesign } from "@/lib/mailing/kinds/promo-shared";

/**
 * Общее для пяти дизайнов письма «Акция»: данные для вёрстки, каркас
 * документа, кнопка, логотип, подвал.
 *
 * Правила те же, что у письма КП (`src/lib/proposal/email.ts`): таблицы,
 * стили инлайн, в `<style>` — только то, что без него не сделать (телефон,
 * тёмная схема, анимации); кнопка «пуленепробиваемая» (VML для Outlook);
 * картинки — абсолютные адреса боевого сайта с `alt`; прехедер скрытым
 * блоком; отписка — без учёта кликов. Анимации — прогрессивные: видны в
 * Apple Mail и iOS, остальные клиенты показывают ту же вёрстку статично.
 */

export const e = escapeHtml;

/** Всё, что нужно дизайну, чтобы нарисовать письмо; тексты уже подставлены. */
export type PromoMailView = {
  design: PromoDesign;
  /** Откуда почтовая программа тянет картинки (боевой домен или тестовый стенд). */
  origin: string;
  subject: string;
  preheader: string;
  headline: string;
  lead: string;
  /** Исходный текст лида — дизайн «Личное письмо» подсвечивает в нём предложение. */
  leadTemplate: string;
  buttonText: string;
  tariff: string;
  percent: number;
  durationDays: number;
  benefits: string[];
  prices: { oldRub: number; newRub: number; savingRub: number };
  code: string;
  /** Адрес кнопки: `/promo/<КОД>` через учёт кликов. */
  ctaUrl: string;
  unsubscribeUrl: string;
  /** Конец действия кода; null — без срока. */
  endsAt: Date | null;
  /** «21 ноября» или null. */
  endsLabel: string | null;
  /** «до 21 ноября» или «до конца акции». */
  until: string;
  /** Скидка остаётся и после первой оплаты. */
  lifetime: boolean;
  /** Имя и компания получателя как есть (без запасных значений) — или null. */
  name: string | null;
  company: string | null;
  now: Date;
  /** Подстановка величин акции и переменных получателя в произвольный текст. */
  fill: (text: string, override?: Partial<{ offer: string }>) => string;
};

export const FONT = "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
export const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

export const C = {
  indigo: "#5566f6",
  indigoHover: "#4a5bf0",
  indigoDeep: "#3848c7",
  violet: "#7a5cff",
  mint: "#7cf5c0",
  dark: "#0b1024",
  ink: "#0b1024",
  body: "#3c4053",
  muted: "#6f7282",
  faint: "#9b9fb3",
  line: "#ececf4",
  line2: "#dcdfed",
  tintA: "#f5f6ff",
  tintB: "#eef1ff",
  tintC: "#fafbff",
  page: "#f4f5fb",
} as const;

const NBSP = " ";

export function assetUrl(view: Pick<PromoMailView, "origin">, path: string): string {
  return `${view.origin.replace(/\/+$/, "")}${path}`;
}

/** Тёмный знак — для светлого фона, белый — для тёмного. Высота ~24 px при пропорциях 900 × 239. */
export function logo(view: PromoMailView, tone: "dark-on-light" | "white-on-dark", height = 24): string {
  const width = Math.round((height * 900) / 239);
  const dark = assetUrl(view, "/brand/wordmark-dark.png");
  const white = assetUrl(view, "/brand/wordmark.png");
  const img = (src: string, cls: string, extra: string) =>
    `<img class="${cls}" src="${e(src)}" width="${width}" height="${height}" alt="WeSetup" style="display:${extra ? "none" : "block"};width:${width}px;height:${height}px;border:0;outline:none${extra}">`;
  if (tone === "white-on-dark") return img(white, "logo-w", "");
  // Светлый дизайн: тёмный знак; при тёмной схеме (Apple Mail, iOS) — белый вместо него.
  return `${img(dark, "logo-l", "")}${img(white, "logo-d", ";mso-hide:all;max-height:0;overflow:hidden")}`;
}

export type ButtonOptions = {
  href: string;
  label: string;
  bg: string;
  /** Градиент поверх `bg` (в Outlook и клиентах без градиентов остаётся `bg`). */
  bgImage?: string;
  color?: string;
  height?: number;
  radius?: number;
  align?: "left" | "center";
  className?: string;
  /** Тень под кнопкой, например `0 10px 30px rgba(85,102,246,.45)`. */
  shadow?: string;
};

/** Кнопка: ячейка с заливкой + VML для Outlook; на телефоне — на всю ширину. */
export function button(o: ButtonOptions): string {
  const height = o.height ?? 52;
  const radius = o.radius ?? 14;
  const color = o.color ?? "#ffffff";
  const width = Math.min(520, Math.max(240, o.label.length * 10 + 72));
  const href = e(o.href);
  const label = e(o.label);
  const arc = Math.round((radius / height) * 100);
  const image = o.bgImage ? `background-image:${o.bgImage};background-repeat:no-repeat;` : "";
  const shadow = o.shadow ? `box-shadow:${o.shadow};` : "";
  return `<table role="presentation" class="m-full" cellpadding="0" cellspacing="0" border="0" align="${o.align ?? "left"}" style="border-collapse:separate">
<tr><td align="center" bgcolor="${o.bg}" style="border-radius:${radius}px;background-color:${o.bg};">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${height}px;v-text-anchor:middle;width:${width}px" arcsize="${arc}%" stroke="f" fillcolor="${o.bg}"><w:anchorlock/><center style="color:${color};font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="m-btn ${o.className ?? ""}" href="${href}" target="_blank" style="display:inline-block;height:${height}px;padding:0 32px;font-family:${FONT};font-size:16px;line-height:${height}px;font-weight:800;color:${color};text-decoration:none;text-align:center;border-radius:${radius}px;background-color:${o.bg};${image}${shadow}mso-hide:all">${label}</a><!--<![endif]-->
</td></tr></table>`;
}

/** Строка из пустого места: `<tr><td height>` — надёжнее margin в Outlook. */
export function spacer(px: number): string {
  return `<tr><td height="${px}" style="height:${px}px;font-size:1px;line-height:${px}px">&nbsp;</td></tr>`;
}

export type FooterTone = "dark" | "light";

/** Подвал: почему пришло письмо, отписка (без учёта кликов), строка о продукте. */
export function footer(view: PromoMailView, tone: FooterTone): string {
  const text = tone === "dark" ? "#7f86a8" : C.muted;
  const link = tone === "dark" ? "#a5b0ff" : C.indigoDeep;
  const cls = tone === "dark" ? "" : " d-muted";
  const linkCls = tone === "dark" ? "" : " d-link";
  return `<p class="ft-text${cls}" style="margin:0;font-family:${FONT};font-size:12px;line-height:19px;color:${text}">Вы получили письмо, потому что пользуетесь WeSetup или оставляли контакт.<br><a class="${linkCls.trim()}" href="${e(view.unsubscribeUrl)}" style="color:${link};text-decoration:underline">Отписаться</a></p>
<p class="ft-text${cls}" style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${text}">WeSetup${NBSP}— электронные журналы СанПиН и ХАССП</p>`;
}

/** Чип с промокодом: «Промокод CODE — применится сам». */
export function codeChip(view: PromoMailView, o: { bg: string; border: string; color: string; codeColor: string; cls?: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="border-collapse:separate"><tr><td class="${o.cls ?? ""}" bgcolor="${o.bg}" style="background:${o.bg};border:1px solid ${o.border};border-radius:999px;padding:9px 16px;font-family:${FONT};font-size:13px;line-height:18px;color:${o.color}">Промокод <span style="font-family:${MONO};font-weight:700;letter-spacing:.06em;color:${o.codeColor}">${e(view.code)}</span>${NBSP}— применится сам</td></tr></table>`;
}

/** Галочка в кружке — таблицей, чтобы кружок держался и в Outlook. */
export function checkDot(o: { size?: number; bg: string; color: string; cls?: string }): string {
  const size = o.size ?? 22;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="${o.cls ?? ""}" align="center" valign="middle" width="${size}" height="${size}" bgcolor="${o.bg}" style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${o.bg};font-family:Arial,sans-serif;font-size:${Math.round(size * 0.58)}px;line-height:${size}px;font-weight:700;color:${o.color}">&#10003;</td></tr></table>`;
}

const BASE_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic;border:0}
a{text-decoration:none}
.m-only{display:none}
@media only screen and (max-width:480px){
.m-w{width:100%!important;max-width:100%!important}
.m-px{padding-left:20px!important;padding-right:20px!important}
.m-stack{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box}
.m-full{width:100%!important}
.m-btn{display:block!important;width:auto!important;padding:0 16px!important}
.m-img{width:100%!important;height:auto!important}
.m-hide{display:none!important}
.m-only{display:block!important;max-height:none!important;overflow:visible!important}
.m-center{text-align:center!important}
.m-gap{padding:0 0 10px!important}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;

/** Тёмная схема светлых дизайнов (Apple Mail, iOS Mail, Outlook-приложения). */
const LIGHT_DARK_CSS = `
@media (prefers-color-scheme:dark){
body,.d-page{background:#0b1024!important}
.d-card{background:#141a36!important}
.d-soft{background:#1a2142!important;border-color:#2c3566!important}
.d-ink{color:#f2f3fb!important}
.d-body{color:#c7cbe0!important}
.d-muted{color:#9b9fb3!important}
.d-link{color:#a5b0ff!important}
.d-line{border-color:#2c3566!important}
.d-tint{background:#1d2650!important;color:#c9d1ff!important}
.logo-l{display:none!important}
.logo-d{display:block!important;max-height:none!important;overflow:visible!important}
}
`;

export type DocumentOptions = {
  view: PromoMailView;
  bodyBg: string;
  /** Светлый дизайн: добавить тёмную схему и класс `d-page`. */
  light: boolean;
  css: string;
  body: string;
  /** Ширина колонки, px (по умолчанию 600). */
  width?: number;
};

/** Полный HTML-документ: head, прехедер, колонка 600 px по центру. */
export function renderDocument(o: DocumentOptions): string {
  const { view } = o;
  const width = o.width ?? 600;
  const filler = "&#8199;&#65279;&#847;".repeat(40);
  return `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(view.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&amp;display=swap" rel="stylesheet">
<style>${BASE_CSS}${o.light ? LIGHT_DARK_CSS : ""}${o.css}</style>
</head>
<body bgcolor="${o.bodyBg}" style="margin:0;padding:0;background:${o.bodyBg}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${e(view.preheader)}${filler}</div>
<table role="presentation" class="${o.light ? "d-page" : ""}" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${o.bodyBg}" style="background:${o.bodyBg}">
<tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="m-w" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:${width}px">
${o.body}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
